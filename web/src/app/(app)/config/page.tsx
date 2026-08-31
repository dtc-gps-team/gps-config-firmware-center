import {
  Card,
  CardContent,
  CardDescription,
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
  title: "Config Editor | GPS Config Center",
};

/** Scaffold — รอต่อ GET/POST /config (โมดูล Config CRUD คือ #26) */
export default function ConfigPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Config Editor</h1>
          <p className="text-sm text-muted-foreground">
            สร้าง/แก้ Draft — สร้างได้เฉพาะ Role SW
          </p>
        </div>
        <Button disabled>+ สร้าง Config ใหม่</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>รายการ Config</CardTitle>
          <CardDescription>ทุก Role ที่ login แล้วดูได้</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ชื่อ Config</TableHead>
                <TableHead>อุปกรณ์เป้าหมาย</TableHead>
                <TableHead>สถานะ</TableHead>
                <TableHead>แก้ไขล่าสุด</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="text-center text-sm text-muted-foreground"
                >
                  ยังไม่มีข้อมูล — รอต่อ API (#26)
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
