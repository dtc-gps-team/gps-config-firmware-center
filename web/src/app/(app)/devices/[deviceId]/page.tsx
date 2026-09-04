import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DemoNote } from "@/components/demo/demo-note";
import {
  DEMO_DEVICE_DETAIL,
  DEVICE_STATUS_TONE,
  pillClass,
} from "@/lib/demo-data";

export const metadata = {
  title: "Device Detail | GPS Config Center",
};

/** Scaffold — รอต่อ GET /devices/{deviceId}/status · แสดง DEMO_DEVICE_DETAIL
 *  สำหรับ demo (ค่าเดียวกันทุก id) */
export default async function DeviceDetailPage({
  params,
}: {
  params: Promise<{ deviceId: string }>;
}) {
  const { deviceId } = await params;
  const rows: [string, string][] = [
    ["SIM Number", DEMO_DEVICE_DETAIL.sim],
    [
      "รุ่น / โปรโตคอล",
      `${DEMO_DEVICE_DETAIL.model} / ${DEMO_DEVICE_DETAIL.protocol}`,
    ],
    ["สถานะ Config", DEMO_DEVICE_DETAIL.configStatus],
    ["เวอร์ชัน Firmware", DEMO_DEVICE_DETAIL.firmwareVersion],
    ["เช็คอินล่าสุด", DEMO_DEVICE_DETAIL.lastCheckIn],
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Device Detail</h1>
        <p className="text-sm text-muted-foreground">Device ID: {deviceId}</p>
        <DemoNote endpoint="GET /devices/{deviceId}/status" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            ข้อมูลอุปกรณ์
            <span
              className={pillClass(
                DEVICE_STATUS_TONE[DEMO_DEVICE_DETAIL.status],
              )}
            >
              {DEMO_DEVICE_DETAIL.status}
            </span>
          </CardTitle>
          <CardDescription>ทุก Role เข้าถึงได้ (Read-only)</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 sm:grid-cols-2">
            {rows.map(([label, value]) => (
              <div key={label} className="flex flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="text-sm font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
