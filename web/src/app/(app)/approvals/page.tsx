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
  title: "Approval Center | GPS Config Center",
};

/** Scaffold — รอต่อ POST /config/{configId}/approve และ /reject (Operation เท่านั้น) */
export default function ApprovalsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Approval Center</h1>
        <p className="text-sm text-muted-foreground">
          อนุมัติ/ปฏิเสธ Config — Operation เท่านั้น
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>รออนุมัติ</CardTitle>
          <CardDescription>
            สถานะ Config = testing (ผ่าน simulation แล้ว)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ชื่อ Config</TableHead>
                <TableHead>ผู้สร้าง</TableHead>
                <TableHead>ผลทดสอบ</TableHead>
                <TableHead className="text-right">การดำเนินการ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell colSpan={3} className="text-sm text-muted-foreground">
                  ยังไม่มีข้อมูล — รอต่อ API
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" disabled>
                      ปฏิเสธ
                    </Button>
                    <Button size="sm" disabled>
                      อนุมัติ
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
