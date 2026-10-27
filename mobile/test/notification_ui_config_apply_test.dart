import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/router/app_router.dart';
import 'package:mobile/features/notification/notification_ui.dart';

// docs/25 §3.6 — notification ของคำขอส่ง Config: payload `{requestId, taskId,
// deviceId}` (+ `rejectReason` / `outcome` + `detail`)
AppNotification _n(NotificationType type, Map<String, dynamic> payload) =>
    AppNotification(
      id: 'n1',
      userId: 'u1',
      type: type,
      payload: payload,
      read: false,
      createdAt: DateTime.utc(2026, 10, 22),
    );

void main() {
  const base = {'requestId': 'car-1', 'taskId': 't1', 'deviceId': 'BOX-0001'};

  test(
    'ทุก type ใหม่มี label ไทย และ fromWire รู้จัก (ไม่ถูก skip ในรายการ)',
    () {
      for (final wire in [
        'config_apply_pending',
        'config_apply_rejected',
        'config_apply_succeeded',
        'config_apply_failed',
        'config_apply_expired',
      ]) {
        final type = NotificationType.fromWire(wire);
        expect(NotificationTypeStyle.label(type), isNotEmpty);
      }
    },
  );

  test('rejected -> อุปกรณ์ + เหตุผล', () {
    final details = NotificationTypeStyle.details(
      _n(NotificationType.configApplyRejected, {
        ...base,
        'rejectReason': 'ค่า APN ผิด',
      }),
    );
    expect(details, ['อุปกรณ์: BOX-0001', 'เหตุผล: ค่า APN ผิด']);
  });

  test('failed (รวมกล่องออฟไลน์) -> อุปกรณ์ + เหตุผลจาก detail', () {
    final details = NotificationTypeStyle.details(
      _n(NotificationType.configApplyFailed, {
        ...base,
        'outcome': 'skipped_offline',
        'detail': 'กล่องออฟไลน์',
      }),
    );
    expect(details, ['อุปกรณ์: BOX-0001', 'เหตุผล: กล่องออฟไลน์']);
  });

  test('ผลของคำขอแตะแล้วไปหน้างาน · pending (ของ Operation) ไม่นำทาง', () {
    for (final type in [
      NotificationType.configApplyRejected,
      NotificationType.configApplySucceeded,
      NotificationType.configApplyFailed,
      NotificationType.configApplyExpired,
    ]) {
      expect(
        NotificationTypeStyle.route(_n(type, base)),
        AppRoutes.taskDetail('t1'),
      );
    }
    expect(
      NotificationTypeStyle.route(
        _n(NotificationType.configApplyPending, base),
      ),
      isNull,
    );
  });

  test(
    'คำขอ Firmware (payload kind: firmware, docs/27 B3) -> label พูดถึง Firmware',
    () {
      final firmware = _n(NotificationType.configApplySucceeded, {
        ...base,
        'kind': 'firmware',
      });
      final config = _n(NotificationType.configApplySucceeded, base);

      expect(NotificationTypeStyle.labelOf(firmware), contains('Firmware'));
      expect(
        NotificationTypeStyle.labelOf(firmware),
        isNot(contains('Config')),
      );
      expect(
        NotificationTypeStyle.labelOf(config),
        NotificationTypeStyle.label(NotificationType.configApplySucceeded),
      );
    },
  );
}
