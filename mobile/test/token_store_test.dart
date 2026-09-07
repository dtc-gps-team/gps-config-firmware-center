import 'package:flutter_secure_storage_platform_interface/flutter_secure_storage_platform_interface.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/auth/token_store.dart';

/// In-memory stand-in for the platform channel `flutter_secure_storage`
/// talks to, so [SecureSessionProfileStore] can be exercised without a real
/// device/keystore. `FlutterSecureStorage` always routes through
/// `FlutterSecureStoragePlatform.instance` — swapping that instance is the
/// pattern the package itself documents for testing.
class _FakeSecureStoragePlatform extends FlutterSecureStoragePlatform {
  final Map<String, String> _values = {};

  @override
  Future<void> write({
    required String key,
    required String value,
    required Map<String, String> options,
  }) async => _values[key] = value;

  @override
  Future<String?> read({
    required String key,
    required Map<String, String> options,
  }) async => _values[key];

  @override
  Future<bool> containsKey({
    required String key,
    required Map<String, String> options,
  }) async => _values.containsKey(key);

  @override
  Future<void> delete({
    required String key,
    required Map<String, String> options,
  }) async => _values.remove(key);

  @override
  Future<Map<String, String>> readAll({
    required Map<String, String> options,
  }) async => Map.of(_values);

  @override
  Future<void> deleteAll({required Map<String, String> options}) async =>
      _values.clear();
}

void main() {
  late _FakeSecureStoragePlatform fakePlatform;

  setUp(() {
    fakePlatform = _FakeSecureStoragePlatform();
    FlutterSecureStoragePlatform.instance = fakePlatform;
  });

  group('SecureSessionProfileStore', () {
    test('save then read round-trips username + role', () async {
      final store = SecureSessionProfileStore();

      await store.save('st.test', UserRole.st);
      final profile = await store.read();

      expect(profile?.username, 'st.test');
      expect(profile?.role, UserRole.st);
    });

    test('nothing saved -> read returns null', () async {
      final store = SecureSessionProfileStore();
      expect(await store.read(), isNull);
    });

    test('corrupted role string in storage -> read() returns null instead of '
        'throwing (regression test: UserRole.fromWire throws ArgumentError for '
        'an unknown value — e.g. secure storage surviving an Android '
        'backup/restore, or a role renamed/removed server-side after being '
        'cached — this used to escape _restore()\'s Future.microtask in '
        'AuthController.build() as an unhandled error and leave the app stuck '
        'on the splash screen at cold start)', () async {
      fakePlatform._values['session_username'] = 'st.test';
      fakePlatform._values['session_role'] = 'NOT_A_REAL_ROLE';
      final store = SecureSessionProfileStore();

      final profile = await store.read();

      expect(profile, isNull);
    });

    test('clear removes both keys', () async {
      final store = SecureSessionProfileStore();
      await store.save('st.test', UserRole.st);

      await store.clear();

      expect(await store.read(), isNull);
      expect(fakePlatform._values, isEmpty);
    });
  });
}
