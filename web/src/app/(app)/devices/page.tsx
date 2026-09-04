import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DemoNote } from "@/components/demo/demo-note";
import { DEMO_DEVICES, DEVICE_STATUS_TONE, pillClass } from "@/lib/demo-data";

export const metadata = {
  title: "Device Search | GPS Config Center",
};

/**
 * Scaffold — ตารางว่างรอต่อ endpoint ค้นหาอุปกรณ์ (ยังไม่มี GET /devices
 * แบบ list ในสเปคตอนนี้ มีแค่ GET /devices/{deviceId}/status — ดู
 * RBAC_Matrix.md ข้อ Gap)
 */
export default function DevicesPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Device Search</h1>
        <p className="text-sm text-muted-foreground">
          ทุก Role เข้าถึงได้ (Read-only)
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>ค้นหาอุปกรณ์</CardTitle>
          <CardDescription>ค้นด้วย Device ID หรือ SIM Number</CardDescription>
        </CardHeader>
        <CardContent>
          <Input placeholder="เช่น DEV-0001" className="max-w-sm" disabled />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3">
          <DemoNote endpoint="GET /devices (ยังไม่มีใน spec)" />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Device ID</TableHead>
                <TableHead>SIM Number</TableHead>
                <TableHead>รุ่น</TableHead>
                <TableHead>สถานะ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {DEMO_DEVICES.map((device) => (
                <TableRow key={device.deviceId}>
                  <TableCell className="font-mono text-sm">
                    <Link
                      href={`/devices/${device.deviceId}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {device.deviceId}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {device.sim}
                  </TableCell>
                  <TableCell>{device.model}</TableCell>
                  <TableCell>
                    <span
                      className={pillClass(DEVICE_STATUS_TONE[device.status])}
                    >
                      {device.status}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
