import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/push_notification/push_notification_service.dart';
import '../api/api_client.dart';
import '../api/models.dart';
import '../config/app_config.dart';
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

class AuthController extends Notifier<AuthState> {
  @override
  AuthState build() {
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
      await _tokenStore.save(token);
      final role = response.role;
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
    ref.read(apiClientProvider).setAuthToken(null);
    state = const AuthState(status: AuthStatus.unauthenticated);
  }
}
