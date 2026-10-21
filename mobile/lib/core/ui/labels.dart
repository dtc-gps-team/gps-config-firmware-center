import '../api/models.dart';

// ข้อความบนป้ายสถานะ (docs/22 §6) — รวมไว้ที่เดียว ไม่ให้แต่ละหน้าเขียนเอง
// · กติกา: มีคู่เทียบใน Web → ใช้คำเดียวกับ Web (อังกฤษตัวแรกพิมพ์ใหญ่ หรือไทยถ้า
// Web เป็นไทย) · ไม่มีคู่เทียบ → คงไทยเดิม · ใช้ switch ครบทุกค่าของ enum
//
// เพิ่มทีละกลุ่มตามหน้าที่ย้ายมา design system ใหม่ — กลุ่ม Incident (Batch 2),
// Task + Role (Batch 3) · หน้าที่ยังไม่ย้าย (เช่น Field Report) ยังใช้
// `IncidentStyle` เดิม

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

/// docs/22 §6 — Task status ไม่มีคู่เทียบใน Web คงไทยเดิม (`TaskStatusStyle.label`
/// ของหน้าที่ยังไม่ย้ายเรียกฟังก์ชันนี้ ข้อความจึงตรงกันทุกหน้า)
String taskStatusLabel(TaskStatus status) => switch (status) {
  TaskStatus.pending => 'รอดำเนินการ',
  TaskStatus.inProgress => 'กำลังทำ',
  TaskStatus.completed => 'เสร็จแล้ว',
  TaskStatus.cancelled => 'ยกเลิก',
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
