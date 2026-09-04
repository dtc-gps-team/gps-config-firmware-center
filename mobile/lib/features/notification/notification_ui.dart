import 'package:flutter/material.dart';

import '../../core/api/models.dart';

/// Thai labels + icons for [NotificationType]. Phase 1 does not read into
/// `payload`, so the list shows only the type label + timestamp.
class NotificationTypeStyle {
  const NotificationTypeStyle._();

  static String label(NotificationType type) => switch (type) {
    NotificationType.taskAssigned => 'มอบหมายงานใหม่',
    NotificationType.configApproved => 'อนุมัติ Config แล้ว',
    NotificationType.configRejected => 'Config ถูกปฏิเสธ',
    NotificationType.firmwareReady => 'เฟิร์มแวร์พร้อมใช้งาน',
    NotificationType.incidentAlert => 'แจ้งเตือนเหตุการณ์',
  };

  static IconData icon(NotificationType type) => switch (type) {
    NotificationType.taskAssigned => Icons.assignment_outlined,
    NotificationType.configApproved => Icons.check_circle_outline,
    NotificationType.configRejected => Icons.cancel_outlined,
    NotificationType.firmwareReady => Icons.system_update_alt,
    NotificationType.incidentAlert => Icons.report_problem_outlined,
  };
}
