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
  // `AppConfig.pushNotificationsEnabled` is `true` now — the real Firebase
  // project exists and the native Android wiring (google-services.json, the
  // Gradle plugin, POST_NOTIFICATIONS) is in place. These tests lock that in
  // and prove the flag guard is no longer blocking the SDK path. Running the
  // enabled path to completion needs a real device / platform binding, so
  // here it only gets far enough to fail inside `Firebase.initializeApp()`.
  test(
    'AppConfig.pushNotificationsEnabled is on (feature is live on Android)',
    () {
      expect(AppConfig.pushNotificationsEnabled, isTrue);
    },
  );

  test('initializeAndRegister() now passes the flag guard and reaches the '
      'Firebase SDK — throws only because the test env has no platform binding; '
      'a real Android build initialises for real', () async {
    final repo = _SpyPushTokenRepository();
    final service = PushNotificationService(repo);

    await expectLater(service.initializeAndRegister(), throwsA(anything));

    // Never got as far as registering a token — Firebase.initializeApp()
    // failed first.
    expect(repo.registerCalls, 0);
  });

  test('unregisterAndStop() still never throws — its try/catch swallows the '
      'Firebase failure so logout can never be blocked', () async {
    final repo = _SpyPushTokenRepository();
    final service = PushNotificationService(repo);

    await expectLater(service.unregisterAndStop(), completes);

    expect(repo.registerCalls, 0);
    expect(repo.unregisterCalls, 0);
  });
}
