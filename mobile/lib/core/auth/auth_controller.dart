import 'dart:async';

import 'package:flutter/foundation.dart' show debugPrint;
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/device_connection_test/recent_device_id_store.dart';
import '../../features/push_notification/push_notification_service.dart';
import '../api/api_client.dart';
import '../api/models.dart';
import '../config/app_config.dart';
import '../db/providers/database_provider.dart';
import '../sync/sync_providers.dart';
import 'auth_repository.dart';
import 'token_store.dart';

enum AuthStatus { unknown, unauthenticated, authenticating, authenticated }

class AuthState {
  const AuthState({
    this.status = AuthStatus.unknown,
    this.role,
    this.username,
    this.error,
  });

  final AuthStatus status;
  final UserRole? role;

  /// Username entered at login. The backend `LoginResponse` carries only
  /// `accessToken` + `role` (no display name, and there is no `/auth/me`
  /// endpoint yet), so this is the only identity string we can show.
  /// Persisted via [SessionProfileStore] alongside the token, so it — and
  /// [role] — survive a session restore (`AuthController._restore`), not just
  /// a fresh login.
  final String? username;
  final String? error;

  bool get isAuthenticated => status == AuthStatus.authenticated;
  bool get isBusy => status == AuthStatus.authenticating;

  AuthState copyWith({
    AuthStatus? status,
    UserRole? role,
    String? username,
    String? error,
    bool clearError = false,
    bool clearRole = false,
  }) {
    return AuthState(
      status: status ?? this.status,
      role: clearRole ? null : (role ?? this.role),
      username: username ?? this.username,
      error: clearError ? null : (error ?? this.error),
    );
  }
}

final apiClientProvider = Provider<ApiClient>((ref) => ApiClient());

final tokenStoreProvider = Provider<TokenStore>((ref) {
  return AppConfig.apiMockMode ? InMemoryTokenStore() : SecureTokenStore();
});

final sessionProfileStoreProvider = Provider<SessionProfileStore>((ref) {
  return AppConfig.apiMockMode
      ? InMemorySessionProfileStore()
      : SecureSessionProfileStore();
});

final authRepositoryProvider = Provider<AuthRepository>((ref) {
  if (AppConfig.apiMockMode) return MockAuthRepository();
  return RealAuthRepository(ref.watch(apiClientProvider));
});

final authControllerProvider = NotifierProvider<AuthController, AuthState>(
  AuthController.new,
);

/// Role ที่ใช้ได้เฉพาะ Web — แอปบล็อกตั้งแต่ login (และตอนคืน session)
/// SuperAdmin ตาม RBAC_Matrix.md Section 1 · Auditor/Admin ตามคำตอบ A ใน #303
/// ข้อ 2 (สองบทบาทนี้ก็เป็น "Web" ใน Section 1 เช่นกัน)
const webOnlyRoles = {UserRole.superAdmin, UserRole.auditor, UserRole.admin};

const webOnlyRoleError = 'บัญชีนี้ใช้ได้เฉพาะหน้าเว็บ';

class AuthController extends Notifier<AuthState> {
  @override
  AuthState build() {
    // UX audit #5 — 401 จากคำขอไหนก็ตาม (หน้าทั่วไปหรือคิว sync) มาจบที่
    // expireSession() จุดเดียว
    final client = ref.read(apiClientProvider);
    client.onUnauthorized = () => unawaited(expireSession());
    ref.onDispose(() => client.onUnauthorized = null);
    // Restore a persisted session without blocking first paint.
    Future.microtask(_restore);
    return const AuthState();
  }

  TokenStore get _tokenStore => ref.read(tokenStoreProvider);
  SessionProfileStore get _profileStore =>
      ref.read(sessionProfileStoreProvider);
  AuthRepository get _repository => ref.read(authRepositoryProvider);

  Future<void> _restore() async {
    try {
      final token = await _tokenStore.read();
      if (token == null) {
        state = state.copyWith(status: AuthStatus.unauthenticated);
        return;
      }
      ref.read(apiClientProvider).setAuthToken(token);
      final profile = await _profileStore.read();
      // session ที่ login ไว้ก่อน Role นี้ถูกบล็อก (เช่น Admin/Auditor ที่เคย
      // ใช้แอปได้) — ออกจากระบบแทนที่จะคืน session ให้
      if (webOnlyRoles.contains(profile?.role)) {
        await logout();
        state = const AuthState(
          status: AuthStatus.unauthenticated,
          error: webOnlyRoleError,
        );
        return;
      }
      state = state.copyWith(
        status: AuthStatus.authenticated,
        username: profile?.username,
        role: profile?.role,
      );
      // Fire-and-forget: the FCM token may have rotated while the app was
      // closed. Never blocks first paint / restore on push registration.
      unawaited(
        ref.read(pushNotificationServiceProvider).initializeAndRegister(),
      );
    } catch (_) {
      // Any failure reading the token/profile store (corrupted keystore,
      // a platform-channel error, ...) must not leave `state.status` stuck
      // at `AuthStatus.unknown` forever — `routerProvider` (app_router.dart)
      // holds the splash screen indefinitely while status is `unknown`, so
      // an unhandled error here would trap the user on a spinner instead of
      // falling back to the login screen.
      state = state.copyWith(status: AuthStatus.unauthenticated);
    }
  }

  Future<void> login(String username, String password) async {
    final trimmedUsername = username.trim();
    state = state.copyWith(status: AuthStatus.authenticating, clearError: true);
    try {
      final response = await _repository.login(trimmedUsername, password);
      final token = response.accessToken;
      if (token == null) {
        throw ApiException('เข้าสู่ระบบไม่สำเร็จ: ไม่ได้รับ token');
      }
      final role = response.role;
      // Role ที่ใช้ได้เฉพาะ Web (ดู [webOnlyRoles]) — บล็อกที่นี่แทนที่จะพึ่ง
      // ArgumentError จาก UserRole.fromWire() (enum รู้จักค่าเหล่านี้อยู่แล้ว
      // จึงไม่ throw) ต้องเช็คก่อน save token ลง token store เสมอ — ห้าม
      // persist token ของบัญชีเหล่านี้แม้ชั่วคราว
      if (webOnlyRoles.contains(role)) {
        state = const AuthState(
          status: AuthStatus.unauthenticated,
          error: webOnlyRoleError,
        );
        return;
      }
      // session ก่อนหน้าหมดอายุ ([expireSession] เก็บ profile + ข้อมูลในเครื่อง
      // ไว้) แล้วคนอื่นมา login ต่อ → ล้างข้อมูลของคนก่อนแบบเดียวกับ logout
      final previous = await _profileStore.read();
      if (previous != null && previous.username != trimmedUsername) {
        await _clearLocalUserData();
      }
      await _tokenStore.save(token);
      if (role != null) {
        await _profileStore.save(trimmedUsername, role);
      }
      ref.read(apiClientProvider).setAuthToken(token);
      state = AuthState(
        status: AuthStatus.authenticated,
        role: response.role,
        username: trimmedUsername,
      );
      // Fire-and-forget: push registration must never block/fail a login.
      unawaited(
        ref.read(pushNotificationServiceProvider).initializeAndRegister(),
      );
    } on ApiException catch (e) {
      state = AuthState(status: AuthStatus.unauthenticated, error: e.message);
    } on ArgumentError catch (_) {
      // UserRole.fromWire() throws this when the backend returns a role the
      // mobile enum doesn't know about yet. A clear message here beats the
      // generic catch-all below.
      state = AuthState(
        status: AuthStatus.unauthenticated,
        error: 'บัญชีนี้ไม่รองรับการใช้งานผ่านแอปมือถือ',
      );
    } catch (e) {
      state = AuthState(
        status: AuthStatus.unauthenticated,
        error: 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
      );
    }
  }

  Future<void> logout() async {
    // Best-effort unregister while the token is still valid for the
    // Authorization header — never throws (see PushNotificationService), so
    // this can't block logout.
    await ref.read(pushNotificationServiceProvider).unregisterAndStop();
    await _tokenStore.clear();
    await _profileStore.clear();
    await _clearLocalUserData();
    ref.read(apiClientProvider).setAuthToken(null);
    state = const AuthState(status: AuthStatus.unauthenticated);
  }

  /// ข้อความบนหน้า login หลัง token หมดอายุ (UX audit #5)
  static const sessionExpiredMessage = 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่';

  /// Token หมดอายุ (`ApiClient.onUnauthorized` — 401 ของคำขอที่แนบ token) →
  /// กลับหน้า login (router redirect ตาม status) พร้อม [sessionExpiredMessage]
  ///
  /// **ต่างจาก [logout]:** ไม่ล้าง Drift cache / คิว sync และไม่ล้าง session
  /// profile — รายการที่ช่างทำไว้ตอนออฟไลน์ต้องไม่หายเพราะ token หมดอายุ
  /// คนเดิม login กลับมา คิวจะถูกส่งต่อ (syncTriggersProvider flush ตอน
  /// authenticated) ส่วนคนอื่น login จะถูกล้างก่อนใน [login] · ไม่ทำอะไรถ้าไม่ได้
  /// authenticated อยู่ (กัน 401 หลายคำขอพร้อมกัน หรือ 401 ที่มาช้าหลัง logout)
  Future<void> expireSession() async {
    if (!state.isAuthenticated) return;
    ref.read(apiClientProvider).setAuthToken(null);
    state = const AuthState(
      status: AuthStatus.unauthenticated,
      error: sessionExpiredMessage,
    );
    await _tokenStore.clear();
  }

  /// ล้างข้อมูลในเครื่องของ user คนปัจจุบัน — ใช้ทั้ง [logout] และตอนคนอื่น
  /// login ต่อหลัง session หมดอายุ ([login])
  Future<void> _clearLocalUserData() async {
    // ล้างประวัติเลขเครื่องที่เคยทดสอบสัญญาณ (issue #204) — กันช่างคนถัดไปที่
    // login เข้าเครื่องเดียวกันเห็นประวัติของคนก่อนหน้า
    await ref.read(recentDeviceIdStoreProvider).clear();
    // ล้าง Drift cache (Task ที่เก็บไว้ออฟไลน์ + คิว sync ที่ยังค้าง) — กัน
    // user คนถัดไปบนเครื่องเดียวกันเห็น/ส่งข้อมูลของคนก่อนหน้า. ห้ามให้ความ
    // ล้มเหลวตรงนี้บล็อก logout (เหมือน step อื่นด้านบน)
    try {
      // Stop any in-flight sync first so a late response can't write the
      // previous user's task back into the cache after the wipe.
      await ref.read(syncQueueServiceProvider).stop();
      await ref.read(appDatabaseProvider).clearAllUserData();
      ref.read(syncAuthExpiredProvider.notifier).state = false;
    } catch (e) {
      debugPrint('logout: clearing local database failed: $e');
    }
  }
}
