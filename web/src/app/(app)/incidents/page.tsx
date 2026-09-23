import { IncidentsView } from "./incidents-view";

export const metadata = {
  title: "Incident & Rollback | GPS Config Center",
};

/**
 * ต่อ `GET /incidents` จริงแล้ว (read-only rollout, Sprint 2 — ดู
 * RBAC_Matrix.md §2 "Incident & Rollback" = R ทุก Role ไม่มี Role ไหนถูกกัน
 * ออก จึงไม่ต้อง RoleGuard ครอบทั้งหน้าเหมือน Audit Log) — เนื้อหาจริงอยู่ที่
 * IncidentsView (ดูไฟล์นั้น)
 */
export default function IncidentsPage() {
  return <IncidentsView />;
}
