import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage_platform_interface/flutter_secure_storage_platform_interface.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/auth/auth_controller.dart';
import 'package:mobile/core/auth/auth_repository.dart';
import 'package:mobile/core/auth/token_store.dart';
import 'package:mobile/features/push_notification/push_notification_service.dart';

class _NoopAuthRepository implements AuthRepository {
  @override
  Future<LoginResponse> login(String username, String password) =>
      throw UnimplementedError();
}

/// Spy standing in for `PushNotificationService` — lets these tests assert
/// `AuthController` actually calls into it on login/logout/restore, and keeps
/// the real service (which now hits the Firebase SDK, since
/// `AppConfig.pushNotificationsEnabled` is `true`) out of every test in this
/// file. The flag-gating itself is covered separately in
/// `push_notification_service_test.dart`.
class _FakePushNotificationService implements PushNotificationService {
  int initializeAndRegisterCalls = 0;
  int unregisterAndStopCalls = 0;

  @override
  Future<void> initializeAndRegister() async {
    initializeAndRegisterCalls++;
  }

  @override
  Future<void> unregisterAndStop() async {
    unregisterAndStopCalls++;
  }
}

/// Same fake as `token_store_test.dart` (kept local — these test files don't
/// import each other), used here to exercise `SecureSessionProfileStore`
/// (not just the in-memory test double) through a real `AuthController`
/// restore, so the fix is proven end-to-end and not just at the store layer.
class _FakeSecureStoragePlatform extends FlutterSecureStoragePlatform {
  final Map<String, String> values = {};

  @override
  Future<void> write({
    required String key,
    required String value,
    required Map<String, String> options,
  }) async => values[key] = value;

  @override
  Future<String?> read({
    required String key,
    required Map<String, String> options,
  }) async => values[key];

  @override
  Future<bool> containsKey({
    required String key,
    required Map<String, String> options,
  }) async => values.containsKey(key);

  @override
  Future<void> delete({
    required String key,
    required Map<String, String> options,
  }) async => values.remove(key);

  @override
  Future<Map<String, String>> readAll({
    required Map<String, String> options,
  }) async => Map.of(values);

  @override
  Future<void> deleteAll({required Map<String, String> options}) async =>
      values.clear();
}

ProviderContainer _container({String? token, SessionProfile? profile}) {
  final container = ProviderContainer(
    overrides: [
      authRepositoryProvider.overrideWithValue(_NoopAuthRepository()),
      tokenStoreProvider.overrideWithValue(InMemoryTokenStore(token)),
      sessionProfileStoreProvider.overrideWithValue(
        InMemorySessionProfileStore(profile),
      ),
      // Keep the real Firebase-backed service out of restore/login/logout in
      // these tests — `pushNotificationsEnabled` is `true` now, so the real
      // one would call `Firebase.initializeApp()` and fail with no binding.
      pushNotificationServiceProvider.overrideWithValue(
        _FakePushNotificationService(),
      ),
    ],
  );
  addTearDown(container.dispose);
  return container;
}

void main() {
  test(
    'restoring a session with no saved token stays unauthenticated',
    () async {
      final container = _container();

      // Reading the provider triggers build(), which schedules `_restore()`.
      container.read(authControllerProvider);
      await pumpEventQueue();

      final state = container.read(authControllerProvider);
      expect(state.status, AuthStatus.unauthenticated);
      expect(state.username, isNull);
      expect(state.role, isNull);
    },
  );

  test('restoring a session with a saved token but no cached profile leaves '
      'username/role null (pre-fix behaviour, still valid if profile was never '
      'saved e.g. an older install upgrading)', () async {
    final container = _container(token: 'saved-token');

    container.read(authControllerProvider);
    await pumpEventQueue();

    final state = container.read(authControllerProvider);
    expect(state.status, AuthStatus.authenticated);
    expect(state.username, isNull);
    expect(state.role, isNull);
  });

  test('corrupted role cached in secure storage -> _restore() does not throw, '
      'lands on authenticated with no profile instead of hanging on cold '
      'start (regression test: SecureSessionProfileStore.read() used to let '
      "UserRole.fromWire's ArgumentError escape as an unhandled error out of "
      "AuthController.build()'s Future.microtask(_restore), leaving the app "
      'stuck on the splash screen)', () async {
    final fakePlatform = _FakeSecureStoragePlatform()
      ..values['session_username'] = 'st.test'
      ..values['session_role'] = 'NOT_A_REAL_ROLE';
    FlutterSecureStoragePlatform.instance = fakePlatform;

    final container = ProviderContainer(
      overrides: [
        authRepositoryProvider.overrideWithValue(_NoopAuthRepository()),
        tokenStoreProvider.overrideWithValue(InMemoryTokenStore('saved-token')),
        sessionProfileStoreProvider.overrideWithValue(
          SecureSessionProfileStore(),
        ),
        pushNotificationServiceProvider.overrideWithValue(
          _FakePushNotificationService(),
        ),
      ],
    );
    addTearDown(container.dispose);

    // Would previously throw synchronously out of the microtask instead
    // of returning — asserting no throw here is the point of this test.
    container.read(authControllerProvider);
    await pumpEventQueue();

    final state = container.read(authControllerProvider);
    expect(state.status, AuthStatus.authenticated);
    expect(state.username, isNull);
    expect(state.role, isNull);
  });

  test('restoring a session with a saved token AND cached profile restores '
      'username and role (regression test for the cold-start bug found on '
      '7 กันยายน 2569: Home showed "สวัสดี, ผู้ใช้งาน" and hid the task section '
      'after Android killed and relaunched the app)', () async {
    final container = _container(
      token: 'saved-token',
      profile: const SessionProfile('st.test', UserRole.st),
    );

    container.read(authControllerProvider);
    await pumpEventQueue();

    final state = container.read(authControllerProvider);
    expect(state.status, AuthStatus.authenticated);
    expect(state.username, 'st.test');
    expect(state.role, UserRole.st);
  });

  test(
    'login persists username + role so a later restore recovers them',
    () async {
      final fakeRepo = _FakeAuthRepository(
        const LoginResponse(accessToken: 'fresh-token', role: UserRole.ot),
      );
      final tokenStore = InMemoryTokenStore();
      final profileStore = InMemorySessionProfileStore();
      final container = ProviderContainer(
        overrides: [
          authRepositoryProvider.overrideWithValue(fakeRepo),
          tokenStoreProvider.overrideWithValue(tokenStore),
          sessionProfileStoreProvider.overrideWithValue(profileStore),
          pushNotificationServiceProvider.overrideWithValue(
            _FakePushNotificationService(),
          ),
        ],
      );
      addTearDown(container.dispose);

      await container
          .read(authControllerProvider.notifier)
          .login('ot.test', 'password123');

      // Simulate a cold start in a fresh container backed by the same stores.
      final restoredContainer = ProviderContainer(
        overrides: [
          authRepositoryProvider.overrideWithValue(_NoopAuthRepository()),
          tokenStoreProvider.overrideWithValue(tokenStore),
          sessionProfileStoreProvider.overrideWithValue(profileStore),
          pushNotificationServiceProvider.overrideWithValue(
            _FakePushNotificationService(),
          ),
        ],
      );
      addTearDown(restoredContainer.dispose);

      restoredContainer.read(authControllerProvider);
      await pumpEventQueue();

      final restored = restoredContainer.read(authControllerProvider);
      expect(restored.status, AuthStatus.authenticated);
      expect(restored.username, 'ot.test');
      expect(restored.role, UserRole.ot);
    },
  );

  test(
    'logout clears the cached profile so a later restore stays anonymous',
    () async {
      final tokenStore = InMemoryTokenStore('saved-token');
      final profileStore = InMemorySessionProfileStore(
        const SessionProfile('st.test', UserRole.st),
      );
      final container = ProviderContainer(
        overrides: [
          authRepositoryProvider.overrideWithValue(_NoopAuthRepository()),
          tokenStoreProvider.overrideWithValue(tokenStore),
          sessionProfileStoreProvider.overrideWithValue(profileStore),
          pushNotificationServiceProvider.overrideWithValue(
            _FakePushNotificationService(),
          ),
        ],
      );
      addTearDown(container.dispose);

      await container.read(authControllerProvider.notifier).logout();

      expect(await tokenStore.read(), isNull);
      expect(await profileStore.read(), isNull);
    },
  );

  group('push notification hook', () {
    test('login success calls PushNotificationService.initializeAndRegister() '
        'once, fire-and-forget (does not block login completing)', () async {
      final fakeRepo = _FakeAuthRepository(
        const LoginResponse(accessToken: 'fresh-token', role: UserRole.ot),
      );
      final fakePush = _FakePushNotificationService();
      final container = ProviderContainer(
        overrides: [
          authRepositoryProvider.overrideWithValue(fakeRepo),
          tokenStoreProvider.overrideWithValue(InMemoryTokenStore()),
          sessionProfileStoreProvider.overrideWithValue(
            InMemorySessionProfileStore(),
          ),
          pushNotificationServiceProvider.overrideWithValue(fakePush),
        ],
      );
      addTearDown(container.dispose);

      await container
          .read(authControllerProvider.notifier)
          .login('ot.test', 'password123');
      await pumpEventQueue();

      expect(fakePush.initializeAndRegisterCalls, 1);
    });

    test(
      'logout awaits PushNotificationService.unregisterAndStop() once',
      () async {
        final fakePush = _FakePushNotificationService();
        final container = ProviderContainer(
          overrides: [
            authRepositoryProvider.overrideWithValue(_NoopAuthRepository()),
            tokenStoreProvider.overrideWithValue(
              InMemoryTokenStore('saved-token'),
            ),
            sessionProfileStoreProvider.overrideWithValue(
              InMemorySessionProfileStore(
                const SessionProfile('st.test', UserRole.st),
              ),
            ),
            pushNotificationServiceProvider.overrideWithValue(fakePush),
          ],
        );
        addTearDown(container.dispose);

        await container.read(authControllerProvider.notifier).logout();

        expect(fakePush.unregisterAndStopCalls, 1);
      },
    );

    test(
      'restoring a session with a saved token also calls '
      'initializeAndRegister() (token may have rotated while app was closed)',
      () async {
        final fakePush = _FakePushNotificationService();
        final container = ProviderContainer(
          overrides: [
            authRepositoryProvider.overrideWithValue(_NoopAuthRepository()),
            tokenStoreProvider.overrideWithValue(
              InMemoryTokenStore('saved-token'),
            ),
            sessionProfileStoreProvider.overrideWithValue(
              InMemorySessionProfileStore(
                const SessionProfile('st.test', UserRole.st),
              ),
            ),
            pushNotificationServiceProvider.overrideWithValue(fakePush),
          ],
        );
        addTearDown(container.dispose);

        container.read(authControllerProvider);
        await pumpEventQueue();

        expect(fakePush.initializeAndRegisterCalls, 1);
      },
    );

    test(
      'restoring with no saved token does not call initializeAndRegister()',
      () async {
        final fakePush = _FakePushNotificationService();
        final container = ProviderContainer(
          overrides: [
            authRepositoryProvider.overrideWithValue(_NoopAuthRepository()),
            tokenStoreProvider.overrideWithValue(InMemoryTokenStore()),
            sessionProfileStoreProvider.overrideWithValue(
              InMemorySessionProfileStore(),
            ),
            pushNotificationServiceProvider.overrideWithValue(fakePush),
          ],
        );
        addTearDown(container.dispose);

        container.read(authControllerProvider);
        await pumpEventQueue();

        expect(fakePush.initializeAndRegisterCalls, 0);
      },
    );
  });
}

class _FakeAuthRepository implements AuthRepository {
  _FakeAuthRepository(this.response);

  final LoginResponse response;

  @override
  Future<LoginResponse> login(String username, String password) async =>
      response;
}
