import '../api/models.dart';

// ข้อความบนป้ายสถานะ (docs/22 §6) — รวมไว้ที่เดียว ไม่ให้แต่ละหน้าเขียนเอง
// · กติกา: มีคู่เทียบใน Web → ใช้คำเดียวกับ Web (อังกฤษตัวแรกพิมพ์ใหญ่ หรือไทยถ้า
// Web เป็นไทย) · ไม่มีคู่เทียบ → คงไทยเดิม · ใช้ switch ครบทุกค่าของ enum
//
// เพิ่มทีละกลุ่มตามหน้าที่ย้ายมา design system ใหม่ — ตอนนี้มีกลุ่ม Incident
// (Batch 2) · หน้าที่ยังไม่ย้าย (เช่น Field Report) ยังใช้ `IncidentStyle` เดิม

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
