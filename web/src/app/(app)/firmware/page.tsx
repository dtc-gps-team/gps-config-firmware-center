import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata = {
  title: "Firmware Repository | GPS Config Center",
};

/** Scaffold — รอต่อ endpoint firmware (ดู docs/api/openapi.yaml) */
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
        <Button disabled>+ อัปโหลด Firmware</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>รายการ Firmware</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>เวอร์ชัน</TableHead>
                <TableHead>รุ่นอุปกรณ์ที่รองรับ</TableHead>
                <TableHead>อัปโหลดเมื่อ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell
                  colSpan={3}
                  className="text-center text-sm text-muted-foreground"
                >
                  ยังไม่มีข้อมูล — รอต่อ API
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
