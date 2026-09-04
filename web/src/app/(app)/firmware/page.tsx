import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UploadFirmwareButton } from "./upload-firmware-button";
import { DemoNote } from "@/components/demo/demo-note";
import { DEMO_FIRMWARE } from "@/lib/demo-data";

export const metadata = {
  title: "Firmware Repository | GPS Config Center",
};

/** Scaffold — รอต่อ endpoint firmware · ตารางแสดง DEMO_FIRMWARE สำหรับ demo */
export default function FirmwarePage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Firmware Repository</h1>
          <p className="text-sm text-muted-foreground">
            อัปโหลด + Compatibility Tag — สร้างได้เฉพาะ Role SW
          </p>
        </div>
        <UploadFirmwareButton />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>รายการ Firmware</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <DemoNote endpoint="GET /firmware" />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>เวอร์ชัน</TableHead>
                <TableHead>รุ่นอุปกรณ์ที่รองรับ</TableHead>
                <TableHead>อัปโหลดเมื่อ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {DEMO_FIRMWARE.map((fw) => (
                <TableRow key={fw.version}>
                  <TableCell className="font-mono text-sm">
                    {fw.version}
                  </TableCell>
                  <TableCell>{fw.models}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {fw.uploadedAt}
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
