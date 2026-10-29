import { PageHeader } from "@/components/page-header";
import { RefreshControl } from "@/components/refresh-control";
import { DashboardSummary } from "./dashboard-summary";

export const metadata = {
  title: "Dashboard | GPS Config Center",
};

/**
 * Dashboard — จัดเป็น 3 กลุ่มตาม docs/planning §12.1 (ดู comment เต็มที่
 * dashboard-summary.tsx): Device Overview / Deployment Overview / Risk
 * Dashboard — Customer Priority กับ Capacity ไม่มีตั้งใจ (ไม่เคยถูกออกแบบไว้
 * ในระบบนี้ / ตัดออกจาก scope งาน A แล้วตามลำดับ)
 *
 * "กิจกรรมล่าสุด" ต่อ `GET /audit-logs` จริงแล้ว (ดู dashboard-activity.tsx —
 * **คนละฟีเจอร์กับ Local Activity Log ที่ถูกยกเลิกไปแล้ว** (`docs/10`) ชื่อไทย
 * บังเอิญซ้ำกันเฉยๆ ไม่ต้องลบ/แก้อะไรเพิ่มจากเหตุการณ์นั้น
 *
 * งานรออนุมัติของ Operation อยู่ในการ์ด "งานที่ต้องดำเนินการ" (ทางลัดไป Approval Center
 * ไม่มีปุ่มอนุมัติในหน้านี้) หน้านี้จึงอ่านอย่างเดียว
 */
export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Dashboard" actions={<RefreshControl />} />

      <DashboardSummary />
    </div>
  );
}
