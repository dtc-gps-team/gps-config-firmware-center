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
  // `configApproved`/`configRejected`/`firmwareReady` ไม่มี mock เลยโดย
  // ตั้งใจ — ตรวจไว้ใน PR #310 ว่า backend ไม่มีจุดส่ง 3 type นี้จริงใน
  // ระบบปัจจุบัน (legacy enum ไม่มี producer) ใส่ mock ให้จะไม่สะท้อนของจริง
  // · taskId/deviceId/incidentId ทุกตัวตรงกับ mock-task-1/DEV-xxxx/
  // mock-incident-x จริงใน repository อื่น ไม่ orphan
  final List<AppNotification> _items = [
    AppNotification(
      id: 'mock-noti-1',
      userId: 'mock-user',
      type: NotificationType.taskAssigned,
      payload: const {
        'taskId': 'mock-task-1',
        'title': 'ติดตั้งกล่อง GPS รถบรรทุก',
      },
      read: false,
      createdAt: DateTime(2026, 9, 9, 8, 30),
    ),
    AppNotification(
      id: 'mock-noti-2',
      userId: 'mock-user',
      type: NotificationType.incidentReportPending,
      payload: const {
        'incidentId': 'mock-incident-3',
        'deviceId': 'DEV-0231',
        'title': 'ปุ่ม SOS กดแล้วไม่ส่งแจ้งเตือน',
      },
      read: false,
      createdAt: DateTime(2026, 9, 8, 13, 1),
    ),
    AppNotification(
      id: 'mock-noti-3',
      userId: 'mock-user',
      type: NotificationType.configOverridePending,
      payload: const {
        'overrideId': 'mock-override-1',
        'deviceId': 'DEV-0410',
        'configId': 'mock-cfg-1',
      },
      read: false,
      createdAt: DateTime(2026, 9, 7, 10, 0),
    ),
    AppNotification(
      id: 'mock-noti-4',
      userId: 'mock-user',
      type: NotificationType.incidentReportPromoted,
      payload: const {
        'incidentId': 'mock-incident-2',
        'deviceId': 'DEV-0092',
        'reviewNote': 'ต้องอัปเดต Firmware จึงส่งต่อเป็น Campaign แล้ว',
      },
      read: true,
      createdAt: DateTime(2026, 9, 6, 10, 1),
    ),
    AppNotification(
      id: 'mock-noti-5',
      userId: 'mock-user',
      type: NotificationType.firmwareOverrideRejected,
      payload: const {
        'overrideId': 'mock-override-2',
        'deviceId': 'DEV-0117',
        'firmwareId': 'mock-fw-1',
        'rejectReason': 'เวอร์ชันนี้ยังไม่ผ่านการทดสอบกับรุ่นเครื่องนี้',
      },
      read: true,
      createdAt: DateTime(2026, 9, 5, 14, 20),
    ),
    AppNotification(
      id: 'mock-noti-6',
      userId: 'mock-user',
      type: NotificationType.incidentReportResolved,
      payload: const {
        'incidentId': 'mock-incident-4',
        'deviceId': 'DEV-0305',
        'reviewNote': 'ช่างเข้าไปขันสายใหม่แล้ว ใช้งานปกติ',
      },
      read: true,
      createdAt: DateTime(2026, 9, 4, 16, 46),
    ),
    AppNotification(
      id: 'mock-noti-7',
      userId: 'mock-user',
      type: NotificationType.incidentReportDismissed,
      payload: const {
        'incidentId': 'mock-incident-5',
        'deviceId': 'DEV-0410',
        'reviewNote': 'ซ้ำกับรายการเดิม',
      },
      read: true,
      createdAt: DateTime(2026, 9, 2, 11, 31),
    ),
    AppNotification(
      id: 'mock-noti-8',
      userId: 'mock-user',
      type: NotificationType.incidentAlert,
      payload: const {
        'configId': 'mock-cfg-2',
        'versionNumber': 3,
        'deviceModel': 'GT06N',
        'protocol': 'TCP',
        'attempts': 3,
        'lastError': 'connection timeout',
      },
      read: true,
      createdAt: DateTime(2026, 8, 29, 9, 1),
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
