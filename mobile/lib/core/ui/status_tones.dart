import '../api/models.dart';
import 'app_badge.dart';

// mapping สถานะ → tone ของ [AppBadge] (docs/22 §5.2) — ยึดตาราง `*_TONE` ใน
// `web/src/lib/status-pill.tsx` (tone `progress` ของ Web = `warning` ของ Badge)
// · ใช้ switch ครบทุกค่าของ enum ถ้า backend เพิ่มสถานะใหม่ compile จะไม่ผ่าน
// จนกว่าจะเลือก tone ให้ · ข้อความบนป้ายอยู่คนละไฟล์ (docs/22 §6)

/// ตาม `TASK_STATUS_TONE` ของ Web — `cancelled` = danger (มติ B docs/22 §3 ข้อ 18)
AppBadgeTone taskStatusTone(TaskStatus status) => switch (status) {
  TaskStatus.pending => AppBadgeTone.neutral,
  TaskStatus.inProgress => AppBadgeTone.warning,
  TaskStatus.completed => AppBadgeTone.success,
  TaskStatus.cancelled => AppBadgeTone.danger,
};

/// ความเร่งด่วนของงาน (§5.2): เลยกำหนด = danger, ใกล้ถึงกำหนด = warning ·
/// `none` ไม่แสดงป้าย — รับเป็น `bool` แทน enum `TaskUrgency` ที่อยู่ใน
/// features/task (core ไม่ import features)
AppBadgeTone taskUrgencyTone({required bool overdue}) =>
    overdue ? AppBadgeTone.danger : AppBadgeTone.warning;

/// คำขอส่ง Config (docs/25) — ไม่มีคู่เทียบใน Web · รอคน = warning, รอกล่อง =
/// info, สำเร็จ = success, ไม่สำเร็จที่ต้องทำอะไรต่อ = danger, ผู้ขอยกเลิกเอง =
/// neutral
AppBadgeTone configApplyRequestTone(ConfigApplyRequestStatus status) =>
    switch (status) {
      ConfigApplyRequestStatus.pending => AppBadgeTone.warning,
      ConfigApplyRequestStatus.sending => AppBadgeTone.info,
      ConfigApplyRequestStatus.succeeded => AppBadgeTone.success,
      ConfigApplyRequestStatus.failed => AppBadgeTone.danger,
      ConfigApplyRequestStatus.skippedOffline => AppBadgeTone.danger,
      ConfigApplyRequestStatus.rejected => AppBadgeTone.danger,
      ConfigApplyRequestStatus.cancelled => AppBadgeTone.neutral,
      ConfigApplyRequestStatus.expired => AppBadgeTone.warning,
    };

/// ตาม `INCIDENT_STATUS_TONE` ของ Web
AppBadgeTone incidentStatusTone(IncidentStatus status) => switch (status) {
  IncidentStatus.open => AppBadgeTone.danger,
  IncidentStatus.investigating => AppBadgeTone.warning,
  IncidentStatus.rolledBack => AppBadgeTone.info,
  IncidentStatus.resolved => AppBadgeTone.success,
  IncidentStatus.dismissed => AppBadgeTone.neutral,
};

/// ตาม `INCIDENT_SEVERITY_TONE` ของ Web
AppBadgeTone incidentSeverityTone(IncidentSeverity severity) =>
    switch (severity) {
      IncidentSeverity.critical => AppBadgeTone.danger,
      IncidentSeverity.high => AppBadgeTone.warning,
      IncidentSeverity.medium => AppBadgeTone.info,
      IncidentSeverity.low => AppBadgeTone.neutral,
    };

/// ตาม `DEVICE_STATUS_TONE` ของ Web
AppBadgeTone deviceLifecycleTone(DeviceLifecycleStatus status) =>
    switch (status) {
      DeviceLifecycleStatus.registered => AppBadgeTone.neutral,
      DeviceLifecycleStatus.installed => AppBadgeTone.success,
      DeviceLifecycleStatus.decommissioned => AppBadgeTone.danger,
    };

/// ตาม `DEVICE_PAYLOAD_STATUS_TONE` ของ Web (`lib/device-payload-status.ts`) ใช้ทั้ง
/// payload Config และ Firmware
AppBadgeTone devicePayloadTone(DevicePayloadStatus status) => switch (status) {
  DevicePayloadStatus.upToDate => AppBadgeTone.success,
  DevicePayloadStatus.pending => AppBadgeTone.warning,
  DevicePayloadStatus.failed => AppBadgeTone.danger,
  DevicePayloadStatus.unknown => AppBadgeTone.neutral,
};
