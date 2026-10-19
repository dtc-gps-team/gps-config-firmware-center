import '../api/models.dart';
import 'app_badge.dart';

// mapping สถานะ → tone ของ [AppBadge] (docs/22 §5.2) — ยึดตาราง `*_TONE` ใน
// `web/src/lib/status-pill.tsx` (tone `progress` ของ Web = `warning` ของ Badge)
// · ใช้ switch ครบทุกค่าของ enum ถ้า backend เพิ่มสถานะใหม่ compile จะไม่ผ่าน
// จนกว่าจะเลือก tone ให้ · ข้อความบนป้ายอยู่คนละไฟล์ (docs/22 §6)
//
// Task urgency (`TaskUrgency`) อยู่ใน features/task ยังไม่ย้ายมา — ทำตอน
// Batch 3 ที่รื้อหน้าแรก (overdue = danger, dueSoon = warning ตาม §5.2)

/// ตาม `TASK_STATUS_TONE` ของ Web — `cancelled` = danger (มติ B docs/22 §3 ข้อ 18)
AppBadgeTone taskStatusTone(TaskStatus status) => switch (status) {
  TaskStatus.pending => AppBadgeTone.neutral,
  TaskStatus.inProgress => AppBadgeTone.warning,
  TaskStatus.completed => AppBadgeTone.success,
  TaskStatus.cancelled => AppBadgeTone.danger,
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
