import { AuditLogView } from "./audit-log-view";

export const metadata = {
  title: "Audit Log | GPS Config Center",
};

/**
 * ต่อ `GET /audit-logs` จริงแล้ว (Sprint 3 #27 — ดู RBAC_Matrix.md ตาราง 4.1)
 * SW เป็น "-" ในหน้านี้ทั้งแถว ต่างจากหน้าอื่นที่ทุก Role อ่านได้หมด — gate
 * ทั้งหน้าผ่าน AuditLogView (ดูไฟล์นั้น)
 */
export default function AuditLogPage() {
  return <AuditLogView />;
}
