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
      case NotificationType.firmwareOverridePending:
      case NotificationType.firmwareOverrideApproved:
        final deviceId = text('deviceId');
        return [if (deviceId != null) 'อุปกรณ์: $deviceId'];
      // Field Incident Report (issue #236, PR #267) — payload
      // `{incidentId, deviceId, title}` ตอน pending (ส่งให้ Operation) ·
      // `{incidentId, deviceId, reviewNote}` ตอนตัดสินใจ · `deviceId` เป็น null
      // ได้ (report ไม่ผูกอุปกรณ์) — `text()` ข้ามค่าที่ไม่ใช่ string/ว่างอยู่แล้ว
      case NotificationType.incidentReportPending:
        final deviceId = text('deviceId');
        final title = text('title');
        return [
          if (deviceId != null) 'อุปกรณ์: $deviceId',
          if (title != null) 'หัวข้อ: $title',
        ];
      case NotificationType.incidentReportResolved:
      case NotificationType.incidentReportDismissed:
      case NotificationType.incidentReportPromoted:
        final deviceId = text('deviceId');
        final note = text('reviewNote');
        return [
          if (deviceId != null) 'อุปกรณ์: $deviceId',
          if (note != null) 'หมายเหตุ: $note',
        ];
      case NotificationType.configOverrideRejected:
      case NotificationType.firmwareOverrideRejected:
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
    NotificationType.firmwareOverridePending =>
      'มีคำขอ Firmware Override รออนุมัติ',
    NotificationType.firmwareOverrideApproved =>
      'คำขอ Firmware Override ได้รับการอนุมัติ',
    NotificationType.firmwareOverrideRejected =>
      'คำขอ Firmware Override ถูกปฏิเสธ',
    NotificationType.incidentReportPending => 'มีรายงานปัญหาหน้างานรอตัดสินใจ',
    NotificationType.incidentReportResolved =>
      'รายงานปัญหาของคุณถูกปิดแล้ว (แก้ไขแล้ว)',
    NotificationType.incidentReportDismissed =>
      'รายงานปัญหาของคุณไม่ถูกดำเนินการ (ไม่ใช่ปัญหา/ซ้ำ)',
    NotificationType.incidentReportPromoted =>
      'รายงานปัญหาของคุณถูกส่งต่อเป็น Campaign แก้ไข',
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
    NotificationType.firmwareOverridePending => Icons.system_update_alt,
    NotificationType.firmwareOverrideApproved => Icons.check_circle_outline,
    NotificationType.firmwareOverrideRejected => Icons.cancel_outlined,
    NotificationType.incidentReportPending => Icons.add_alert_outlined,
    NotificationType.incidentReportResolved => Icons.check_circle_outline,
    NotificationType.incidentReportDismissed => Icons.block_outlined,
    NotificationType.incidentReportPromoted => Icons.campaign_outlined,
  };
}
