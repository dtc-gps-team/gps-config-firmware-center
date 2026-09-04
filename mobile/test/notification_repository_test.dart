import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/auth/auth_controller.dart';
import 'package:mobile/core/config/app_config.dart';
import 'package:mobile/features/notification/notification_repository.dart';

class _FakeAuthController extends AuthController {
  _FakeAuthController(this._status);

  final AuthStatus _status;

  @override
  AuthState build() => AuthState(status: _status);
}

class _RecordingRepo implements NotificationRepository {
  int listCalls = 0;
  bool? lastUnread;

  @override
  Future<List<AppNotification>> list({bool? unread}) async {
    listCalls++;
    lastUnread = unread;
    return const [];
  }

  @override
  Future<AppNotification> markRead(String id) => throw UnimplementedError();
}

void main() {
  group('notificationRepositoryProvider', () {
    test('picks the impl from API_MOCK_MODE', () {
      final container = ProviderContainer();
      addTearDown(container.dispose);
      final repo = container.read(notificationRepositoryProvider);
      if (AppConfig.apiMockMode) {
        expect(repo, isA<MockNotificationRepository>());
      } else {
        expect(repo, isA<ApiNotificationRepository>());
      }
    });
  });

  group('MockNotificationRepository', () {
    test('list() คืนทั้งหมด, list(unread: true) คืนเฉพาะ unread', () async {
      final repo = MockNotificationRepository();

      final all = await repo.list();
      final unread = await repo.list(unread: true);

      expect(all.length, greaterThan(unread.length));
      expect(unread.every((n) => !n.read), isTrue);
    });

    test('markRead อัปเดต read=true และสะท้อนใน list ถัดไป', () async {
      final repo = MockNotificationRepository();
      final target = (await repo.list(unread: true)).first;

      final updated = await repo.markRead(target.id);
      expect(updated.read, isTrue);

      final stillUnread = await repo.list(unread: true);
      expect(stillUnread.any((n) => n.id == target.id), isFalse);
    });

    test('markRead id ไม่รู้จัก -> ApiException 404', () async {
      await expectLater(
        MockNotificationRepository().markRead('nope'),
        throwsA(
          isA<ApiException>().having((e) => e.statusCode, 'statusCode', 404),
        ),
      );
    });
  });

  group('notificationListProvider / unreadNotificationCountProvider', () {
    ProviderContainer containerFor(
      AuthStatus status,
      NotificationRepository r,
    ) {
      final c = ProviderContainer(
        overrides: [
          authControllerProvider.overrideWith(
            () => _FakeAuthController(status),
          ),
          notificationRepositoryProvider.overrideWithValue(r),
        ],
      );
      addTearDown(c.dispose);
      return c;
    }

    test('ยังไม่ authenticated -> ไม่ยิง repo (list ว่าง, count 0)', () async {
      final repo = _RecordingRepo();
      final c = containerFor(AuthStatus.unauthenticated, repo);

      expect(await c.read(notificationListProvider.future), isEmpty);
      expect(await c.read(unreadNotificationCountProvider.future), 0);
      expect(repo.listCalls, 0);
    });

    test(
      'authenticated -> list() ไม่ส่ง unread, count เรียก unread:true',
      () async {
        final repo = _RecordingRepo();
        final c = containerFor(AuthStatus.authenticated, repo);

        await c.read(notificationListProvider.future);
        expect(repo.lastUnread, isNull);

        await c.read(unreadNotificationCountProvider.future);
        expect(repo.lastUnread, isTrue);
      },
    );
  });
}
