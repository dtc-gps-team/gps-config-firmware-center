import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../api/models.dart';

/// Persists the access token. Abstracted so tests (and mock mode) can swap in
/// an in-memory implementation without the platform plugin.
abstract class TokenStore {
  Future<void> save(String token);
  Future<String?> read();
  Future<void> clear();
}

/// Production implementation backed by the OS keystore / keychain.
class SecureTokenStore implements TokenStore {
  SecureTokenStore([FlutterSecureStorage? storage])
    : _storage = storage ?? const FlutterSecureStorage();

  static const _key = 'access_token';
  final FlutterSecureStorage _storage;

  @override
  Future<void> save(String token) => _storage.write(key: _key, value: token);

  @override
  Future<String?> read() => _storage.read(key: _key);

  @override
  Future<void> clear() => _storage.delete(key: _key);
}

/// In-memory store for tests and `API_MOCK_MODE`.
class InMemoryTokenStore implements TokenStore {
  InMemoryTokenStore([this._token]);

  String? _token;

  @override
  Future<void> save(String token) async => _token = token;

  @override
  Future<String?> read() async => _token;

  @override
  Future<void> clear() async => _token = null;
}

/// The identity captured at login (`username` entered + `role` returned by
/// `POST /auth/login`).
class SessionProfile {
  const SessionProfile(this.username, this.role);

  final String username;
  final UserRole role;
}

/// Persists [SessionProfile] alongside the access token, so a session
/// restored from a saved token (`AuthController._restore`) can show the same
/// identity as a fresh login. The backend has no `/auth/me` endpoint to
/// re-fetch this from (see `RealAuthRepository.login`), so it has to be
/// cached locally — same storage pattern as [TokenStore], kept as a separate
/// class so the token save/read/clear logic above stays untouched.
abstract class SessionProfileStore {
  Future<void> save(String username, UserRole role);
  Future<SessionProfile?> read();
  Future<void> clear();
}

/// Production implementation backed by the OS keystore / keychain.
class SecureSessionProfileStore implements SessionProfileStore {
  SecureSessionProfileStore([FlutterSecureStorage? storage])
    : _storage = storage ?? const FlutterSecureStorage();

  static const _usernameKey = 'session_username';
  static const _roleKey = 'session_role';
  final FlutterSecureStorage _storage;

  @override
  Future<void> save(String username, UserRole role) async {
    await _storage.write(key: _usernameKey, value: username);
    await _storage.write(key: _roleKey, value: role.wireName);
  }

  @override
  Future<SessionProfile?> read() async {
    final username = await _storage.read(key: _usernameKey);
    final roleWire = await _storage.read(key: _roleKey);
    if (username == null || roleWire == null) return null;
    try {
      return SessionProfile(username, UserRole.fromWire(roleWire));
    } on ArgumentError {
      // roleWire doesn't match any known UserRole (e.g. storage corrupted by
      // an Android backup/restore, or the role was renamed/removed
      // server-side since it was cached). Treat it the same as "no cached
      // profile" — AuthController._restore() already has an authenticated-
      // but-no-profile path for this — rather than letting it escape as an
      // unhandled error out of the Future.microtask(_restore) in build(),
      // which would leave the app stuck on AuthState.unknown at cold start.
      return null;
    }
  }

  @override
  Future<void> clear() async {
    await _storage.delete(key: _usernameKey);
    await _storage.delete(key: _roleKey);
  }
}

/// In-memory store for tests and `API_MOCK_MODE`.
class InMemorySessionProfileStore implements SessionProfileStore {
  InMemorySessionProfileStore([this._profile]);

  SessionProfile? _profile;

  @override
  Future<void> save(String username, UserRole role) async {
    _profile = SessionProfile(username, role);
  }

  @override
  Future<SessionProfile?> read() async => _profile;

  @override
  Future<void> clear() async => _profile = null;
}
