import 'dart:async';

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

class _FakeTokenGateway implements FcmTokenGateway {
  _FakeTokenGateway({this.token = 'fcm-token-1', this.deleteFails = false});

  final String? token;
  final bool deleteFails;
  final List<String> calls = [];

  @override
  Future<String?> getToken() async {
    calls.add('getToken');
    return token;
  }

  @override
  Future<void> deleteToken() async {
    calls.add('deleteToken');
    if (deleteFails) throw Exception('no network');
  }
}

/// `deleteToken()` that never completes — simulates Firebase hanging offline.
class _HangingTokenGateway implements FcmTokenGateway {
  final List<String> calls = [];

  @override
  Future<String?> getToken() async => 'fcm-token-1';

  @override
  Future<void> deleteToken() {
    calls.add('deleteToken');
    return Completer<void>().future;
  }
}

class _FailingUnregisterRepository extends _SpyPushTokenRepository {
  @override
  Future<void> unregister(String token) async {
    unregisterCalls++;
    throw Exception('offline');
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

  test('initializeAndRegister() now never throws — Firebase.initializeApp() '
      'fails in the test env (no platform binding), but the whole body is '
      'wrapped in try/catch so login/restore session can never be blocked '
      'by a push registration failure', () async {
    final repo = _SpyPushTokenRepository();
    final service = PushNotificationService(repo);

    await expectLater(service.initializeAndRegister(), completes);

    // Never got as far as registering a token — Firebase.initializeApp()
    // failed first, and that failure was swallowed.
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

  group('unregisterAndStop() with a token', () {
    test(
      'unregisters with the backend first, then deletes the FCM token',
      () async {
        final repo = _SpyPushTokenRepository();
        final gateway = _FakeTokenGateway();
        final service = PushNotificationService(repo, tokenGateway: gateway);

        await service.unregisterAndStop();

        expect(repo.unregisterCalls, 1);
        expect(gateway.calls, ['getToken', 'deleteToken']);
      },
    );

    test(
      'backend unregister fails (offline) -> deleteToken still runs',
      () async {
        final repo = _FailingUnregisterRepository();
        final gateway = _FakeTokenGateway();
        final service = PushNotificationService(repo, tokenGateway: gateway);

        await expectLater(service.unregisterAndStop(), completes);

        expect(repo.unregisterCalls, 1);
        expect(gateway.calls, contains('deleteToken'));
      },
    );

    test('deleteToken throws -> logout still completes', () async {
      final service = PushNotificationService(
        _SpyPushTokenRepository(),
        tokenGateway: _FakeTokenGateway(deleteFails: true),
      );
      await expectLater(service.unregisterAndStop(), completes);
    });

    testWidgets(
      'deleteToken ค้าง (ออฟไลน์) -> logout จบภายใน 5 วินาที ไม่ค้าง',
      (tester) async {
        final gateway = _HangingTokenGateway();
        final service = PushNotificationService(
          _SpyPushTokenRepository(),
          tokenGateway: gateway,
        );

        var done = false;
        final logout = service.unregisterAndStop().then((_) => done = true);

        await tester.pump(const Duration(seconds: 4));
        expect(gateway.calls, ['deleteToken']);
        expect(done, isFalse); // ยังรอ deleteToken อยู่ (ยังไม่ครบ 5 วิ)

        await tester.pump(const Duration(seconds: 2)); // เกิน 5 วิ
        await logout;
        expect(done, isTrue);
      },
    );

    test(
      'no token -> nothing to unregister but deleteToken still called',
      () async {
        final repo = _SpyPushTokenRepository();
        final gateway = _FakeTokenGateway(token: null);
        final service = PushNotificationService(repo, tokenGateway: gateway);

        await service.unregisterAndStop();

        expect(repo.unregisterCalls, 0);
        expect(gateway.calls, contains('deleteToken'));
      },
    );
  });
}
