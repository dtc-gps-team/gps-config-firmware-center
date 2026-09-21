import { DashboardSummary } from "./dashboard-summary";
import { DashboardActivity } from "./dashboard-activity";

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
 */
export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          ภาพรวมระบบ · ทุก Role เข้าถึงได้ (Read-only ทั้งหมด)
        </p>
      </div>

      <DashboardSummary />
      <DashboardActivity />
    </div>
  );
}
