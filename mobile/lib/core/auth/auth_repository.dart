import '../api/api_client.dart';
import '../api/models.dart';

/// Authenticates a user and returns the token + role.
abstract class AuthRepository {
  Future<LoginResponse> login(String username, String password);
}

/// Calls the real backend (`POST /auth/login`).
class RealAuthRepository implements AuthRepository {
  RealAuthRepository(this._api);

  final ApiClient _api;

  @override
  Future<LoginResponse> login(String username, String password) {
    return _api.login(LoginRequest(username: username, password: password));
  }
}

/// Fake used when `API_MOCK_MODE=true`, so the app runs before `[A]` ships the
/// real auth service. The username prefix selects the role, e.g. `op.somchai`
/// logs in as [UserRole.operation]; anything unmatched falls back to
/// [UserRole.st].
class MockAuthRepository implements AuthRepository {
  static const _rolesByPrefix = <String, UserRole>{
    'sw': UserRole.sw,
    'op': UserRole.operation,
    'st': UserRole.st,
    'ot': UserRole.ot,
    'audit': UserRole.auditor,
    'admin': UserRole.admin,
  };

  @override
  Future<LoginResponse> login(String username, String password) async {
    await Future<void>.delayed(const Duration(milliseconds: 300));
    if (username.isEmpty || password.isEmpty) {
      throw ApiException('Username/Password ไม่ถูกต้อง', statusCode: 401);
    }
    final prefix = username.split(RegExp(r'[.@]')).first.toLowerCase();
    final role = _rolesByPrefix[prefix] ?? UserRole.st;
    return LoginResponse(
      accessToken:
          'mock-token.${role.wireName}.${DateTime.now().millisecondsSinceEpoch}',
      role: role,
    );
  }
}
