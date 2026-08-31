import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = {
  title: "Device Detail | GPS Config Center",
};

/** Scaffold — รอต่อ GET /devices/{deviceId}/status (มีในสเปคแล้ว) */
export default async function DeviceDetailPage({
  params,
}: {
  params: Promise<{ deviceId: string }>;
}) {
  const { deviceId } = await params;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Device Detail</h1>
        <p className="text-sm text-muted-foreground">Device ID: {deviceId}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>ข้อมูลอุปกรณ์</CardTitle>
          <CardDescription>ทุก Role เข้าถึงได้ (Read-only)</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          ยังไม่มีข้อมูล — รอต่อ API
        </CardContent>
      </Card>
    </div>
  );
}
