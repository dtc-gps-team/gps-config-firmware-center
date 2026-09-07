import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApprovalActions } from "./approval-actions";
import { DemoNote } from "@/components/demo/demo-note";
import { DEMO_PENDING_APPROVALS, pillClass } from "@/lib/demo-data";

export const metadata = {
  title: "Approval Center | GPS Config Center",
};

/** Scaffold — รอต่อ POST /config/{configId}/approve และ /reject (Operation เท่านั้น)
 *  ตารางแสดง DEMO_PENDING_APPROVALS (ดู web/src/lib/demo-data.ts) สำหรับ demo */
export default function ApprovalsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Approval Center</h1>
        <p className="text-sm text-muted-foreground">
          อนุมัติ/ปฏิเสธ Config · Operation เท่านั้น
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>รออนุมัติ</CardTitle>
          <CardDescription>
            สถานะ Config = testing (ผ่าน simulation แล้ว)
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <DemoNote endpoint="GET /config?status=testing" />
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
              {DEMO_PENDING_APPROVALS.map((config) => (
                <TableRow key={config.id}>
                  <TableCell className="font-medium">{config.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {config.createdBy}
                  </TableCell>
                  <TableCell>
                    <span
                      className={pillClass(
                        config.simulation === "ผ่าน" ? "success" : "danger",
                      )}
                    >
                      {config.simulation}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <ApprovalActions />
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
