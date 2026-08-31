import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";

export const metadata = {
  title: "Dashboard | GPS Config Center",
};

const SUMMARY_CARDS = [
  { label: "อุปกรณ์ทั้งหมด", value: "—" },
  { label: "Config รออนุมัติ", value: "—" },
  { label: "Campaign กำลังทำงาน", value: "—" },
  { label: "Incident ที่ยังไม่ปิด", value: "—" },
];

/** Scaffold — ยังไม่ต่อ API จริง เลขสรุปเป็น placeholder ทั้งหมด */
export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          ภาพรวมระบบ — ทุก Role เข้าถึงได้ (Read-only ทั้งหมด)
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {SUMMARY_CARDS.map((card) => (
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
          <CardDescription>รอต่อ API จริง</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          ยังไม่มีข้อมูล
        </CardContent>
      </Card>
    </div>
  );
}
