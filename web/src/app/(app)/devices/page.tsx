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
        <CardContent>
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
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="text-center text-sm text-muted-foreground"
                >
                  ยังไม่มีข้อมูล — รอต่อ API
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ตัวอย่าง entry point ไปหน้า Device Detail — ใช้ id ปลอมไว้ก่อน */}
      <Link
        href="/devices/example-device-id"
        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        ดูตัวอย่างหน้า Device Detail (dev only)
      </Link>
    </div>
  );
}
