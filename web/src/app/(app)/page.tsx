import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { DemoNote } from "@/components/demo/demo-note";
import {
  DEMO_DASHBOARD_SUMMARY,
  DEMO_DASHBOARD_ACTIVITY,
} from "@/lib/demo-data";

export const metadata = {
  title: "Dashboard | GPS Config Center",
};

/** Scaffold — ยังไม่ต่อ API จริง เลขสรุป + กิจกรรมเป็น DEMO_* สำหรับ demo
 *  (ดู web/src/lib/demo-data.ts) */
export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          ภาพรวมระบบ · ทุก Role เข้าถึงได้ (Read-only ทั้งหมด)
        </p>
        <DemoNote endpoint="หลาย endpoint (config / campaign / incident)" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {DEMO_DASHBOARD_SUMMARY.map((card) => (
          <Card key={card.label}>
            <CardHeader>
              <CardDescription>{card.label}</CardDescription>
              <CardTitle className="text-3xl">{card.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>กิจกรรมล่าสุด</CardTitle>
          <CardDescription>เรียงจากล่าสุด</CardDescription>
        </CardHeader>
        <CardContent>
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
