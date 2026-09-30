import 'package:flutter/material.dart';

import '../../core/api/models.dart';

/// Thai labels + icons for [NotificationType]. Only the three Config Override
/// types read into `payload` (see [details]); every other type shows just the
/// type label + timestamp.
class NotificationTypeStyle {
  const NotificationTypeStyle._();

  /// Extra lines under the label for the Config Override types (issue #226):
  /// `deviceId`, plus `rejectReason` on a rejection. Missing/blank fields are
  /// skipped — the payload is free-form JSON, so never assume a key exists.
  static List<String> details(AppNotification n) {
    String? text(String key) {
      final v = n.payload[key];
      return v is String && v.trim().isNotEmpty ? v.trim() : null;
    }

    switch (n.type) {
      case NotificationType.configOverridePending:
      case NotificationType.configOverrideApproved:
        final deviceId = text('deviceId');
        return [if (deviceId != null) 'อุปกรณ์: $deviceId'];
      case NotificationType.configOverrideRejected:
        final deviceId = text('deviceId');
        final reason = text('rejectReason');
        return [
          if (deviceId != null) 'อุปกรณ์: $deviceId',
          if (reason != null) 'เหตุผล: $reason',
        ];
      default:
        return const [];
    }
  }

  static String label(NotificationType type) => switch (type) {
    NotificationType.taskAssigned => 'มอบหมายงานใหม่',
    NotificationType.configApproved => 'อนุมัติ Config แล้ว',
    NotificationType.configRejected => 'Config ถูกปฏิเสธ',
    NotificationType.firmwareReady => 'เฟิร์มแวร์พร้อมใช้งาน',
    NotificationType.incidentAlert => 'แจ้งเตือนเหตุการณ์',
    NotificationType.configDeletionPending => 'มีคำขอลบ Config รออนุมัติ',
    NotificationType.configDeletionGrace =>
      'Config ของคุณถูกเสนอลบ — กด "เก็บไว้" ถ้ายังต้องใช้',
    NotificationType.configOverridePending => 'มีคำขอ Override รออนุมัติ',
    NotificationType.configOverrideApproved => 'คำขอ Override ได้รับการอนุมัติ',
    NotificationType.configOverrideRejected => 'คำขอ Override ถูกปฏิเสธ',
  };

  static IconData icon(NotificationType type) => switch (type) {
    NotificationType.taskAssigned => Icons.assignment_outlined,
    NotificationType.configApproved => Icons.check_circle_outline,
    NotificationType.configRejected => Icons.cancel_outlined,
    NotificationType.firmwareReady => Icons.system_update_alt,
    NotificationType.incidentAlert => Icons.report_problem_outlined,
    NotificationType.configDeletionPending => Icons.delete_outline,
    NotificationType.configDeletionGrace => Icons.warning_amber_outlined,
    NotificationType.configOverridePending => Icons.edit_note_outlined,
    NotificationType.configOverrideApproved => Icons.check_circle_outline,
    NotificationType.configOverrideRejected => Icons.cancel_outlined,
  };
}
