import { DashboardSummary } from "./dashboard-summary";
import { DashboardPendingApprovals } from "./dashboard-pending-approvals";
import { DashboardConfigStatusChart } from "./dashboard-config-status-chart";
import { DashboardActivity } from "./dashboard-activity";
import { DashboardLoadedAt } from "./dashboard-loaded-at";

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
 * **"รายการรออนุมัติ" (เพิ่มทีหลัง — เทียบกับ mockup UX/UI Design ต้นฉบับ
 * UIWEB-001 ที่มี widget นี้ตั้งแต่แรก):** ทางลัดอนุมัติ/ปฏิเสธจากหน้าแรกโดย
 * ไม่ต้องเปิด Approval Center ก่อน — เฉพาะ role ที่อนุมัติอะไรได้จริงถึงจะ
 * เห็น (ดู `dashboard-pending-approvals.tsx`) หน้านี้เลยไม่ใช่ "Read-only
 * ทั้งหมด" อีกต่อไปสำหรับ Operation
 */
export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          ภาพรวมระบบ · ทุก Role เข้าถึงได้ · Operation อนุมัติรายการด้านล่างได้
          โดยตรงจากหน้านี้
        </p>
        <DashboardLoadedAt />
      </div>

      <DashboardPendingApprovals />
      <DashboardSummary />
      <DashboardConfigStatusChart />
      <DashboardActivity />
    </div>
  );
}
