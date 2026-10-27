import '../api/models.dart';

// ข้อความบนป้ายสถานะ (docs/22 §6) — รวมไว้ที่เดียว ไม่ให้แต่ละหน้าเขียนเอง
// · กติกา: มีคู่เทียบใน Web → ใช้คำเดียวกับ Web (อังกฤษตัวแรกพิมพ์ใหญ่ หรือไทยถ้า
// Web เป็นไทย) · ไม่มีคู่เทียบ → คงไทยเดิม · ใช้ switch ครบทุกค่าของ enum
//
// เพิ่มทีละกลุ่มตามหน้าที่ย้ายมา design system ใหม่ — กลุ่ม Incident (Batch 2),
// Task + Role (Batch 3), Device + payload (Batch 4)

/// docs/22 §6.1 — Web: `Open` / `Investigating` / `Resolved` อังกฤษ ·
/// `Rollback แล้ว` / `ไม่ต้องดำเนินการ` Web เป็นไทย คงตาม Web
String incidentStatusLabel(IncidentStatus status) => switch (status) {
  IncidentStatus.open => 'Open',
  IncidentStatus.investigating => 'Investigating',
  IncidentStatus.rolledBack => 'Rollback แล้ว',
  IncidentStatus.resolved => 'Resolved',
  IncidentStatus.dismissed => 'ไม่ต้องดำเนินการ',
};

/// docs/22 §6.1 — ตาม Web + ตัวแรกพิมพ์ใหญ่
String incidentSeverityLabel(IncidentSeverity severity) => switch (severity) {
  IncidentSeverity.critical => 'Critical',
  IncidentSeverity.high => 'High',
  IncidentSeverity.medium => 'Medium',
  IncidentSeverity.low => 'Low',
};

/// docs/22 §6.1 — Device lifecycle ตาม Web + ตัวแรกพิมพ์ใหญ่ (Batch 4)
String deviceLifecycleLabel(DeviceLifecycleStatus status) => switch (status) {
  DeviceLifecycleStatus.registered => 'Registered',
  DeviceLifecycleStatus.installed => 'Installed',
  DeviceLifecycleStatus.decommissioned => 'Decommissioned',
};

/// docs/22 §6.1 — payload status (`configStatus` / `firmwareStatus`) Web เป็นไทย
/// คงตาม Web · `pending` Web แยกคำตามชนิด payload ([firmware] = payload Firmware)
String devicePayloadLabel(
  DevicePayloadStatus status, {
  required bool firmware,
}) => switch (status) {
  DevicePayloadStatus.upToDate => 'เป็นปัจจุบัน',
  DevicePayloadStatus.pending =>
    firmware ? 'รอติดตั้ง Firmware' : 'รอรับ Config',
  DevicePayloadStatus.failed => 'ล้มเหลว',
  DevicePayloadStatus.unknown => 'ยังไม่เคยอยู่ใน Rollout',
};

/// docs/22 §6 — Task status ไม่มีคู่เทียบใน Web คงไทยเดิม (`TaskStatusStyle.label`
/// ของหน้าที่ยังไม่ย้ายเรียกฟังก์ชันนี้ ข้อความจึงตรงกันทุกหน้า)
/// docs/28 — ที่มาของงานในหน้า Task Detail
String taskSourceLabel(TaskSource source) => switch (source) {
  TaskSource.operation => 'Operation สั่ง',
  TaskSource.technician => 'เริ่มเองจากหน้ากล่อง',
};

String taskStatusLabel(TaskStatus status) => switch (status) {
  TaskStatus.pending => 'รอดำเนินการ',
  TaskStatus.inProgress => 'กำลังทำ',
  TaskStatus.completed => 'เสร็จแล้ว',
  TaskStatus.cancelled => 'ยกเลิก',
};

/// docs/25 §3.3 — สถานะคำขอส่ง Config ไม่มีคู่เทียบใน Web (การ์ด Approval Center
/// ยังไม่ทำ) ใช้ไทยตามตารางการ์ดในแผน
String configApplyRequestStatusLabel(
  ConfigApplyRequestStatus status, {
  FieldApplyKind kind = FieldApplyKind.config,
}) => switch (status) {
  ConfigApplyRequestStatus.pending => 'รอ Operation อนุมัติ',
  ConfigApplyRequestStatus.approved => 'อนุมัติแล้ว กดส่งเข้ากล่องได้',
  ConfigApplyRequestStatus.sending => 'กำลังส่งเข้ากล่อง รอกล่องยืนยัน',
  ConfigApplyRequestStatus.succeeded =>
    kind == FieldApplyKind.firmware
        ? 'กล่องติดตั้ง Firmware แล้ว'
        : 'กล่องรับ Config แล้ว',
  ConfigApplyRequestStatus.failed => 'ส่งไม่สำเร็จ',
  ConfigApplyRequestStatus.skippedOffline => 'กล่องออฟไลน์ ส่งไม่ถึง',
  ConfigApplyRequestStatus.rejected => 'Operation ปฏิเสธคำขอ',
  ConfigApplyRequestStatus.cancelled => 'ยกเลิกคำขอแล้ว',
  // หมดอายุได้ 2 แบบ (ไม่มีใครตัดสิน / อนุมัติแล้วไม่ได้กดส่ง) — เหตุผลจริง
  // แสดงจาก `resultDetail` ใต้หัวข้อ
  ConfigApplyRequestStatus.expired => 'คำขอหมดอายุ',
};

/// docs/22 §6.2 — ป้าย Role ใช้ชื่อเดียวกับ Web (`ST`, `Operation`) ส่วนคำอธิบาย
/// ไทยแยกเป็นบรรทัดย่อย ([roleDescription]) มติ B ข้อ 11 · แยกคำแบบ
/// `formatRoleLabel` ของ Web (`SuperAdmin` → `Super Admin`)
String roleLabel(UserRole role) => switch (role) {
  UserRole.superAdmin => 'Super Admin',
  _ => role.wireName,
};

/// บรรทัดย่อยใต้ชื่อผู้ใช้ในแผ่นบัญชีผู้ใช้ — `null` = ยังไม่รู้ role
String roleDescription(UserRole? role) => switch (role) {
  UserRole.st || UserRole.ot => 'ช่างภาคสนาม',
  UserRole.operation => 'ฝ่ายปฏิบัติการ',
  UserRole.auditor => 'ผู้ตรวจสอบ',
  UserRole.admin => 'ผู้ดูแลระบบ',
  UserRole.superAdmin => 'ผู้ดูแลระบบสูงสุด',
  null => 'ผู้ใช้งาน',
};
