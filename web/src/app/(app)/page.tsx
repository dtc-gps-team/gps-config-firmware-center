import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { DemoNote } from "@/components/demo/demo-note";
import { DEMO_DASHBOARD_ACTIVITY } from "@/lib/demo-data";
import { DashboardSummary } from "./dashboard-summary";

export const metadata = {
  title: "Dashboard | GPS Config Center",
};

/**
 * Dashboard — การ์ด "อุปกรณ์ทั้งหมด" (`GET /devices`) + "Config รออนุมัติ"
 * (`GET /config`, นับ status = testing) ต่อ API จริงแล้ว · การ์ด Campaign /
 * Incident + "กิจกรรมล่าสุด" (mockup ของ compliance AuditLog ผ่าน
 * `GET /audit-logs`, Sprint 3 checklist #27) ยังเป็นตัวอย่าง รอ endpoint —
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

      <Card>
        <CardHeader>
          <CardTitle>กิจกรรมล่าสุด</CardTitle>
          <CardDescription>เรียงจากล่าสุด</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <DemoNote endpoint="GET /audit-logs (ยังไม่มีใน spec)" />
          <ul className="flex flex-col gap-2 text-sm">
            {DEMO_DASHBOARD_ACTIVITY.map((item, i) => (
              <li key={i} className="flex gap-3">
                <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">
                  {item.time}
                </span>
                <span>{item.text}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
