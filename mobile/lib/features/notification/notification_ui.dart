import 'package:flutter/material.dart';

import '../../core/api/models.dart';
import '../../core/router/app_router.dart';
import '../../core/theme/app_tokens.dart';

/// Thai labels + icons for [NotificationType]. [details] reads extra fields
/// out of `payload` for the types listed there (Config/Firmware Override,
/// Field Incident Report, `taskAssigned`); every other type shows just the
/// type label + timestamp.
/// ผลของแจ้งเตือนต่อผู้รับ ดู [NotificationTypeStyle.tone]
enum NotificationTone { action, success, failure, info }

/// หมวดของแจ้งเตือนสำหรับชิปกรองในหน้ารายการ
enum NotificationCategory {
  task('งาน'),
  apply('ส่งเข้ากล่อง'),
  override('Override'),
  incident('Incident'),
  other('อื่น ๆ');

  const NotificationCategory(this.label);

  final String label;
}

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
      // issue #296 (Mobile UX/UI audit) — payload จริงคือ `{taskId, title}`
      // (`task.service.ts` ส่งมาเสมอ) แค่ไม่เคย render title ตรงนี้มาก่อน
      case NotificationType.taskAssigned:
        final title = text('title');
        return [if (title != null) 'งาน: $title'];
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
      // docs/25 §3.6 — payload `{requestId, taskId, deviceId}` + `rejectReason`
      // ตอนปฏิเสธ / `detail` ตอนล้มเหลว
      case NotificationType.configApplyRejected:
        final deviceId = text('deviceId');
        final reason = text('rejectReason');
        return [
          if (deviceId != null) 'อุปกรณ์: $deviceId',
          if (reason != null) 'เหตุผล: $reason',
        ];
      case NotificationType.configApplyPending:
      case NotificationType.configApplyApproved:
      case NotificationType.configApplySucceeded:
        final deviceId = text('deviceId');
        return [if (deviceId != null) 'อุปกรณ์: $deviceId'];
      // หัวข้อสั้น ([shortLabelOf]) ตัดคำอธิบายในวงเล็บของ [label] ออก จึงย้าย
      // เหตุที่หมดอายุมาเป็นบรรทัดรายละเอียดแทน
      case NotificationType.configApplyExpired:
        final deviceId = text('deviceId');
        return [
          if (deviceId != null) 'อุปกรณ์: $deviceId',
          'ไม่มีใครตัดสิน หรือไม่ได้กดส่งภายใน 24 ชม.',
        ];
      case NotificationType.configApplyFailed:
        final deviceId = text('deviceId');
        final detail = text('detail');
        return [
          if (deviceId != null) 'อุปกรณ์: $deviceId',
          if (detail != null) 'เหตุผล: $detail',
        ];
      // docs/31 §3.5 — สาเหตุของรอบที่ล้ม + รอบที่ระบบกำลังจะลอง
      case NotificationType.configApplyRetrying:
        final deviceId = text('deviceId');
        final detail = text('detail');
        final next = _int(n.payload['nextAttemptNo']);
        final max = _int(n.payload['maxAttempts']);
        return [
          if (deviceId != null) 'อุปกรณ์: $deviceId',
          if (detail != null) 'เหตุผล: $detail',
          next != null && max != null
              ? 'กำลังลองใหม่ รอบ $next/$max'
              : 'ระบบกำลังลองส่งใหม่',
        ];
      default:
        return const [];
    }
  }

  /// หน้าที่ควร navigate ไปเมื่อแตะการ์ด (Mobile UX/UI audit report) — คืน
  /// `null` เมื่อ type ไม่มี id ที่นำทางได้แน่นอน (เช่น `configApproved`/
  /// `firmwareReady`/`incidentAlert` ที่ backend ไม่ได้ส่ง id มาด้วย หรือ
  /// `configDeletion*` ที่ Mobile ไม่มีหน้า Config ให้ไปอยู่แล้ว) — กรณีนั้น
  /// ผู้เรียกคง behavior เดิม (แค่ mark-as-read)
  static String? route(AppNotification n) {
    String? idOf(String key) {
      final v = n.payload[key];
      return v is String && v.trim().isNotEmpty ? v.trim() : null;
    }

    switch (n.type) {
      case NotificationType.taskAssigned:
      // docs/25 §3.6 — deep link ไป Task Detail ที่การ์ดแสดงสถานะคำขอ
      case NotificationType.configApplyApproved:
      case NotificationType.configApplyRejected:
      case NotificationType.configApplySucceeded:
      case NotificationType.configApplyFailed:
      case NotificationType.configApplyExpired:
      case NotificationType.configApplyRetrying:
        final taskId = idOf('taskId');
        return taskId == null ? null : AppRoutes.taskDetail(taskId);
      case NotificationType.configOverridePending:
      case NotificationType.configOverrideApproved:
      case NotificationType.configOverrideRejected:
      case NotificationType.firmwareOverridePending:
      case NotificationType.firmwareOverrideApproved:
      case NotificationType.firmwareOverrideRejected:
        final deviceId = idOf('deviceId');
        return deviceId == null ? null : AppRoutes.deviceDetail(deviceId);
      case NotificationType.incidentReportPending:
      case NotificationType.incidentReportResolved:
      case NotificationType.incidentReportDismissed:
      case NotificationType.incidentReportPromoted:
        final incidentId = idOf('incidentId');
        return incidentId == null ? null : AppRoutes.incidentDetail(incidentId);
      default:
        return null;
    }
  }

  /// [label] ของแจ้งเตือนหนึ่งรายการ — คำขอส่งเข้ากล่องที่เป็น Firmware (payload
  /// `kind: firmware`, docs/27 B2) เปลี่ยนคำว่า Config เป็น Firmware
  static String labelOf(AppNotification n) {
    final base = _retryTitle(n) ?? label(n.type);
    final isApplyRequest = switch (n.type) {
      NotificationType.configApplyPending ||
      NotificationType.configApplyApproved ||
      NotificationType.configApplyRejected ||
      NotificationType.configApplySucceeded ||
      NotificationType.configApplyFailed ||
      NotificationType.configApplyExpired ||
      NotificationType.configApplyRetrying => true,
      _ => false,
    };
    return isApplyRequest && n.payload['kind'] == 'firmware'
        ? base.replaceAll('Config', 'Firmware')
        : base;
  }

  /// หัวข้อสั้นบนการ์ดในหน้ารายการ (B 04/11/2026: ข้อความยาวอ่านยากเมื่อ
  /// รายการเยอะ) · [label] ฉบับเต็มยังใช้กับ push notification ที่ไม่มีบรรทัด
  /// รายละเอียดช่วยอธิบาย · คำขอส่งที่เป็น Firmware เปลี่ยน Config เป็น
  /// Firmware เหมือน [labelOf]
  static String shortLabelOf(AppNotification n) {
    final base = _retryTitle(n) ?? _shortLabel(n.type);
    return category(n.type) == NotificationCategory.apply &&
            n.payload['kind'] == 'firmware'
        ? base.replaceAll('Config', 'Firmware')
        : base;
  }

  static String _shortLabel(NotificationType type) => switch (type) {
    NotificationType.taskAssigned => 'ได้รับงานใหม่',
    NotificationType.configApproved => 'Config อนุมัติแล้ว',
    NotificationType.configRejected => 'Config ถูกปฏิเสธ',
    NotificationType.firmwareReady => 'Firmware พร้อมใช้งาน',
    NotificationType.incidentAlert => 'ระบบตรวจพบปัญหา',
    NotificationType.configDeletionPending => 'คำขอลบ Config รออนุมัติ',
    NotificationType.configDeletionGrace => 'Config ของคุณถูกเสนอลบ',
    NotificationType.configOverridePending => 'Override รออนุมัติ',
    NotificationType.configOverrideApproved => 'Override อนุมัติแล้ว',
    NotificationType.configOverrideRejected => 'Override ถูกปฏิเสธ',
    NotificationType.firmwareOverridePending => 'Firmware Override รออนุมัติ',
    NotificationType.firmwareOverrideApproved =>
      'Firmware Override อนุมัติแล้ว',
    NotificationType.firmwareOverrideRejected => 'Firmware Override ถูกปฏิเสธ',
    NotificationType.incidentReportPending => 'มีรายงานปัญหาใหม่',
    NotificationType.incidentReportResolved => 'ปัญหาที่คุณแจ้ง แก้ไขแล้ว',
    NotificationType.incidentReportDismissed =>
      'ปัญหาที่คุณแจ้ง ไม่ต้องดำเนินการ',
    NotificationType.incidentReportPromoted =>
      'ปัญหาที่คุณแจ้ง ส่งต่อเป็น Campaign',
    NotificationType.configApplyPending => 'คำขอส่ง Config รออนุมัติ',
    NotificationType.configApplyApproved => 'อนุมัติแล้ว กดส่ง Config ได้เลย',
    NotificationType.configApplyRejected => 'คำขอส่ง Config ถูกปฏิเสธ',
    NotificationType.configApplySucceeded => 'ส่ง Config เข้ากล่องสำเร็จ',
    NotificationType.configApplyFailed => 'ส่ง Config เข้ากล่องไม่สำเร็จ',
    NotificationType.configApplyExpired => 'คำขอส่ง Config หมดอายุ',
    NotificationType.configApplyRetrying => 'ส่ง Config ไม่สำเร็จ กำลังลองใหม่',
  };

  /// ผลของเรื่องนี้ต่อผู้รับ ใช้เลือกสีวงไอคอนและป้าย "ต้องดำเนินการ"
  static NotificationTone tone(NotificationType type) => switch (type) {
    NotificationType.taskAssigned ||
    NotificationType.configDeletionPending ||
    NotificationType.configDeletionGrace ||
    NotificationType.configOverridePending ||
    NotificationType.firmwareOverridePending ||
    NotificationType.incidentReportPending ||
    NotificationType.configApplyPending ||
    NotificationType.configApplyApproved => NotificationTone.action,
    NotificationType.configApproved ||
    NotificationType.firmwareReady ||
    NotificationType.configOverrideApproved ||
    NotificationType.firmwareOverrideApproved ||
    NotificationType.incidentReportResolved ||
    NotificationType.configApplySucceeded => NotificationTone.success,
    NotificationType.configRejected ||
    NotificationType.incidentAlert ||
    NotificationType.configOverrideRejected ||
    NotificationType.firmwareOverrideRejected ||
    NotificationType.configApplyRejected ||
    NotificationType.configApplyFailed ||
    NotificationType.configApplyExpired => NotificationTone.failure,
    NotificationType.incidentReportDismissed ||
    NotificationType.incidentReportPromoted ||
    // docs/31 — ระบบลองใหม่เอง ช่างไม่ต้องทำอะไร จึงไม่ใช้ action (ป้าย "ต้องดำเนินการ")
    NotificationType.configApplyRetrying => NotificationTone.info,
  };

  static NotificationCategory category(NotificationType type) => switch (type) {
    NotificationType.taskAssigned => NotificationCategory.task,
    NotificationType.configApplyPending ||
    NotificationType.configApplyApproved ||
    NotificationType.configApplyRejected ||
    NotificationType.configApplySucceeded ||
    NotificationType.configApplyFailed ||
    NotificationType.configApplyExpired ||
    NotificationType.configApplyRetrying => NotificationCategory.apply,
    NotificationType.configOverridePending ||
    NotificationType.configOverrideApproved ||
    NotificationType.configOverrideRejected ||
    NotificationType.firmwareOverridePending ||
    NotificationType.firmwareOverrideApproved ||
    NotificationType.firmwareOverrideRejected => NotificationCategory.override,
    NotificationType.incidentAlert ||
    NotificationType.incidentReportPending ||
    NotificationType.incidentReportResolved ||
    NotificationType.incidentReportDismissed ||
    NotificationType.incidentReportPromoted => NotificationCategory.incident,
    _ => NotificationCategory.other,
  };

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
    NotificationType.configApplyPending =>
      'มีคำขอส่ง Config เข้าเครื่องรออนุมัติ',
    NotificationType.configApplyApproved =>
      'คำขอส่ง Config อนุมัติแล้ว — กดส่งเข้ากล่องได้',
    NotificationType.configApplyRejected => 'คำขอส่ง Config ของคุณถูกปฏิเสธ',
    NotificationType.configApplySucceeded => 'กล่องรับ Config ที่คุณขอส่งแล้ว',
    NotificationType.configApplyFailed =>
      'ส่ง Config ที่คุณขอเข้าเครื่องไม่สำเร็จ',
    NotificationType.configApplyExpired =>
      'คำขอส่ง Config ของคุณหมดอายุ (ไม่มีใครตัดสิน หรือไม่ได้กดส่งใน 24 ชม.)',
    NotificationType.configApplyRetrying =>
      'ส่ง Config เข้ากล่องไม่สำเร็จ ระบบกำลังลองใหม่',
  };

  /// หัวข้อของ `configApplyRetrying` ที่บอกรอบ (docs/31 §3.5 "ส่ง Config รอบ 1/3 ไม่สำเร็จ")
  /// · payload ไม่ครบ = null ให้ใช้หัวข้อทั่วไป
  static String? _retryTitle(AppNotification n) {
    if (n.type != NotificationType.configApplyRetrying) return null;
    final attempt = _int(n.payload['attemptNo']);
    final max = _int(n.payload['maxAttempts']);
    return attempt != null && max != null
        ? 'ส่ง Config รอบ $attempt/$max ไม่สำเร็จ'
        : null;
  }

  static int? _int(Object? v) => v is int
      ? v
      : v is num
      ? v.toInt()
      : null;

  /// เรื่องด่วน (Mobile UI Roadmap Phase 1) — incident ใหม่ที่ยังไม่มีใครจัดการ
  /// (`incidentReportPending` ส่งให้ Operation ตอนมี report ใหม่) หรือ
  /// auto-detect alert (`incidentAlert`) เท่านั้น ที่ถือว่าด่วน — type อื่นที่
  /// เกี่ยวกับ incident แต่เป็นการปิดเรื่องที่จัดการไปแล้ว
  /// (`incidentReportResolved`/`Dismissed`/`Promoted`) หรือเรื่องทั่วไป
  /// (override, task) ไม่ถือว่าด่วน
  static bool isUrgent(NotificationType type) => switch (type) {
    NotificationType.incidentReportPending => true,
    NotificationType.incidentAlert => true,
    _ => false,
  };

  /// `(background, foreground)` ของวงไอคอนตาม [tone] (B 04/11/2026): สีบอก
  /// ผลให้กวาดตาแยกเรื่องที่สำเร็จ / ไม่สำเร็จ / ต้องทำต่อได้โดยไม่ต้องอ่าน
  /// · [isUrgent] ยังใช้โทน danger เด่นที่สุดเหมือนเดิม
  static (Color, Color) iconColors(NotificationType type) => isUrgent(type)
      ? (AppColors.dangerSubtle, AppColors.destructive)
      : switch (tone(type)) {
          NotificationTone.action => (
            AppColors.warningSubtle,
            AppColors.warning,
          ),
          NotificationTone.success => (
            AppColors.successSubtle,
            AppColors.success,
          ),
          NotificationTone.failure => (
            AppColors.dangerSubtle,
            AppColors.destructive,
          ),
          NotificationTone.info => (
            AppColors.secondary,
            AppColors.mutedForeground,
          ),
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
    NotificationType.configApplyPending => Icons.send_outlined,
    NotificationType.configApplyApproved => Icons.task_alt,
    NotificationType.configApplyRejected => Icons.cancel_outlined,
    NotificationType.configApplySucceeded => Icons.check_circle_outline,
    NotificationType.configApplyFailed => Icons.error_outline,
    NotificationType.configApplyExpired => Icons.timer_off_outlined,
    NotificationType.configApplyRetrying => Icons.autorenew,
  };
}
