import { AuditLogView } from "./audit-log-view";

export const metadata = {
  title: "Audit Log | GPS Config Center",
};

/**
 * Scaffold — รอต่อโมดูล `audit` (ยังไม่มี endpoint ใน spec — ดู
 * RBAC_Matrix.md ตาราง 4.2) SW เป็น "-" ในหน้านี้ทั้งแถว ต่างจากหน้าอื่นที่
 * ทุก Role อ่านได้หมด — gate ทั้งหน้าผ่าน AuditLogView (ดูไฟล์นั้น)
 */
export default function AuditLogPage() {
  return <AuditLogView />;
}
