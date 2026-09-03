import 'package:flutter_riverpod/flutter_riverpod.dart';

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
  /// endpoint yet), so this is the only identity string we can show. It is not
  /// persisted, so it is `null` after a session is restored from a saved token.
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
  AuthRepository get _repository => ref.read(authRepositoryProvider);

  Future<void> _restore() async {
    final token = await _tokenStore.read();
    if (token == null) {
      state = state.copyWith(status: AuthStatus.unauthenticated);
      return;
    }
    ref.read(apiClientProvider).setAuthToken(token);
    state = state.copyWith(status: AuthStatus.authenticated);
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
      ref.read(apiClientProvider).setAuthToken(token);
      state = AuthState(
        status: AuthStatus.authenticated,
        role: response.role,
        username: trimmedUsername,
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
    await _tokenStore.clear();
    ref.read(apiClientProvider).setAuthToken(null);
    state = const AuthState(status: AuthStatus.unauthenticated);
  }
}
