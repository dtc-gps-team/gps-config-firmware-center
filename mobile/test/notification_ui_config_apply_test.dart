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

  // docs/31 — ระบบลองส่งใหม่เอง
  group('config_apply_retrying', () {
    final retrying = _n(NotificationType.configApplyRetrying, {
      ...base,
      'kind': 'firmware',
      'attemptNo': 1,
      'maxAttempts': 3,
      'nextAttemptNo': 2,
      'errorCode': 'DEVICE_DISCONNECTED',
      'detail': 'กล่องหลุดการเชื่อมต่อ',
      'nextRetryAt': '2026-11-05T10:00:30.000Z',
    });

    test('fromWire รู้จัก (หน้ารายการไม่พังเมื่อ backend ส่ง type นี้)', () {
      expect(
        NotificationType.fromWire('config_apply_retrying'),
        NotificationType.configApplyRetrying,
      );
    });

    test('หัวข้อบอกรอบและชนิด: "ส่ง Firmware รอบ 1/3 ไม่สำเร็จ"', () {
      expect(
        NotificationTypeStyle.shortLabelOf(retrying),
        'ส่ง Firmware รอบ 1/3 ไม่สำเร็จ',
      );
      expect(
        NotificationTypeStyle.labelOf(retrying),
        'ส่ง Firmware รอบ 1/3 ไม่สำเร็จ',
      );
    });

    test('payload ไม่ครบ -> หัวข้อทั่วไป', () {
      final bare = _n(NotificationType.configApplyRetrying, base);
      expect(
        NotificationTypeStyle.shortLabelOf(bare),
        'ส่ง Config ไม่สำเร็จ กำลังลองใหม่',
      );
      expect(NotificationTypeStyle.details(bare).last, 'ระบบกำลังลองส่งใหม่');
    });

    test('รายละเอียด: อุปกรณ์ สาเหตุ และรอบที่กำลังลอง', () {
      expect(NotificationTypeStyle.details(retrying), [
        'อุปกรณ์: BOX-0001',
        'เหตุผล: กล่องหลุดการเชื่อมต่อ',
        'กำลังลองใหม่ รอบ 2/3',
      ]);
    });

    test(
      'แตะไปหน้างาน · หมวดส่งเข้ากล่อง · ไม่ใช่เรื่องที่ช่างต้องทำ (ไม่ขึ้นป้าย ต้องดำเนินการ)',
      () {
        expect(
          NotificationTypeStyle.route(retrying),
          AppRoutes.taskDetail('t1'),
        );
        expect(
          NotificationTypeStyle.category(NotificationType.configApplyRetrying),
          NotificationCategory.apply,
        );
        expect(
          NotificationTypeStyle.tone(NotificationType.configApplyRetrying),
          isNot(NotificationTone.action),
        );
      },
    );
  });
}
