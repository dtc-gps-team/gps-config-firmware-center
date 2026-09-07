import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/auth/auth_controller.dart';
import 'package:mobile/core/auth/auth_repository.dart';
import 'package:mobile/core/auth/token_store.dart';

class _NoopAuthRepository implements AuthRepository {
  @override
  Future<LoginResponse> login(String username, String password) =>
      throw UnimplementedError();
}

ProviderContainer _container({String? token, SessionProfile? profile}) {
  final container = ProviderContainer(
    overrides: [
      authRepositoryProvider.overrideWithValue(_NoopAuthRepository()),
      tokenStoreProvider.overrideWithValue(InMemoryTokenStore(token)),
      sessionProfileStoreProvider.overrideWithValue(
        InMemorySessionProfileStore(profile),
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
        ],
      );
      addTearDown(container.dispose);

      await container.read(authControllerProvider.notifier).logout();

      expect(await tokenStore.read(), isNull);
      expect(await profileStore.read(), isNull);
    },
  );
}

class _FakeAuthRepository implements AuthRepository {
  _FakeAuthRepository(this.response);

  final LoginResponse response;

  @override
  Future<LoginResponse> login(String username, String password) async =>
      response;
}
