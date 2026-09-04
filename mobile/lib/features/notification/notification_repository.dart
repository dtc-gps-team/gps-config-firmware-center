import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/auth/auth_controller.dart'; // apiClientProvider
import '../../core/config/app_config.dart';

/// Reads the signed-in user's notifications and marks them read.
///
/// `GET /notifications` / `PATCH /notifications/{id}/read` are scoped to the
/// caller by the backend for every role (`NotificationService` filters by the
/// JWT `userId`), so — unlike tasks — no role gate is needed on the client.
abstract class NotificationRepository {
  Future<List<AppNotification>> list({bool? unread});
  Future<AppNotification> markRead(String id);
}

/// Talks to the real backend. Default outside `API_MOCK_MODE`.
class ApiNotificationRepository implements NotificationRepository {
  ApiNotificationRepository(this._api);

  final ApiClient _api;

  @override
  Future<List<AppNotification>> list({bool? unread}) =>
      _api.listNotifications(unread: unread);

  @override
  Future<AppNotification> markRead(String id) => _api.markNotificationRead(id);
}

/// In-memory fake for `API_MOCK_MODE` (dev without a backend).
class MockNotificationRepository implements NotificationRepository {
  final List<AppNotification> _items = [
    AppNotification(
      id: 'mock-noti-1',
      userId: 'mock-user',
      type: NotificationType.taskAssigned,
      payload: const {'taskId': 'mock-task-1'},
      read: false,
      createdAt: DateTime(2026, 9, 4, 8, 30),
    ),
    AppNotification(
      id: 'mock-noti-2',
      userId: 'mock-user',
      type: NotificationType.firmwareReady,
      payload: const {},
      read: false,
      createdAt: DateTime(2026, 9, 3, 17),
    ),
    AppNotification(
      id: 'mock-noti-3',
      userId: 'mock-user',
      type: NotificationType.configApproved,
      payload: const {},
      read: true,
      createdAt: DateTime(2026, 9, 2, 11),
    ),
  ];

  @override
  Future<List<AppNotification>> list({bool? unread}) async {
    await Future<void>.delayed(const Duration(milliseconds: 250));
    final all = List<AppNotification>.unmodifiable(_items);
    if (unread == true) return all.where((n) => !n.read).toList();
    return all;
  }

  @override
  Future<AppNotification> markRead(String id) async {
    await Future<void>.delayed(const Duration(milliseconds: 200));
    final index = _items.indexWhere((n) => n.id == id);
    if (index == -1) {
      throw ApiException('ไม่พบการแจ้งเตือนนี้', statusCode: 404);
    }
    final updated = _items[index].copyWith(read: true);
    _items[index] = updated;
    return updated;
  }
}

final notificationRepositoryProvider = Provider<NotificationRepository>((ref) {
  if (AppConfig.apiMockMode) return MockNotificationRepository();
  return ApiNotificationRepository(ref.watch(apiClientProvider));
});

/// Full notification list for the "รายการแจ้งเตือน" screen (newest first —
/// backend orders by `createdAt desc`).
final notificationListProvider =
    FutureProvider.autoDispose<List<AppNotification>>((ref) {
      final authed = ref.watch(
        authControllerProvider.select((s) => s.isAuthenticated),
      );
      if (!authed) return const <AppNotification>[];
      return ref.watch(notificationRepositoryProvider).list();
    });

/// Unread count for the Home bell badge (`GET /notifications?unread=true`).
final unreadNotificationCountProvider = FutureProvider.autoDispose<int>((
  ref,
) async {
  final authed = ref.watch(
    authControllerProvider.select((s) => s.isAuthenticated),
  );
  if (!authed) return 0;
  final unread = await ref
      .watch(notificationRepositoryProvider)
      .list(unread: true);
  return unread.length;
});
