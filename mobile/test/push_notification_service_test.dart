import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/config/app_config.dart';
import 'package:mobile/features/push_notification/push_notification_service.dart';
import 'package:mobile/features/push_notification/push_token_repository.dart';

class _SpyPushTokenRepository implements PushTokenRepository {
  int registerCalls = 0;
  int unregisterCalls = 0;

  @override
  Future<void> register({
    required String token,
    required String platform,
  }) async {
    registerCalls++;
  }

  @override
  Future<void> unregister(String token) async {
    unregisterCalls++;
  }
}

void main() {
  // AppConfig.pushNotificationsEnabled is hardcoded `false` right now (see
  // its docstring — no Firebase project exists yet). These tests assert the
  // guard actually holds: neither public method may reach the token
  // repository (a stand-in for "reach the Firebase SDK") while the flag is
  // off. If this ever fails, either the flag flipped to `true` without
  // native Firebase config being wired, or the guard clause was removed.
  test(
    'AppConfig.pushNotificationsEnabled is off (no Firebase project yet)',
    () {
      expect(AppConfig.pushNotificationsEnabled, isFalse);
    },
  );

  test(
    'initializeAndRegister() is a no-op while pushNotificationsEnabled=false '
    '— never touches PushTokenRepository (stand-in for the Firebase SDK)',
    () async {
      final repo = _SpyPushTokenRepository();
      final service = PushNotificationService(repo);

      await service.initializeAndRegister();

      expect(repo.registerCalls, 0);
      expect(repo.unregisterCalls, 0);
    },
  );

  test('unregisterAndStop() is a no-op while pushNotificationsEnabled=false — '
      'never touches PushTokenRepository, never throws', () async {
    final repo = _SpyPushTokenRepository();
    final service = PushNotificationService(repo);

    await expectLater(service.unregisterAndStop(), completes);

    expect(repo.registerCalls, 0);
    expect(repo.unregisterCalls, 0);
  });
}
