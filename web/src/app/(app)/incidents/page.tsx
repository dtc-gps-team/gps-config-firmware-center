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
import { IncidentActions } from "./incident-actions";
import { DemoNote } from "@/components/demo/demo-note";
import { DEMO_INCIDENTS } from "@/lib/demo-data";

export const metadata = {
  title: "Incident & Rollback | GPS Config Center",
};

/**
 * Scaffold — รอต่อโมดูล `incident` (ยังไม่มี endpoint ใน spec — ดู
 * RBAC_Matrix.md ตาราง 4.2) SW เห็นเฉพาะ Incident ที่ระบบสร้างอัตโนมัติ
 */
export default function IncidentsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Incident & Rollback</h1>
        <p className="text-sm text-muted-foreground">
          Operation สั่ง Rollback · ST แก้ไขเชิงเทคนิค
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>รายการ Incident</CardTitle>
          <CardDescription>สร้างอัตโนมัติจากระบบ</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <DemoNote endpoint="GET /incidents (ยังไม่มีใน spec)" />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>อุปกรณ์</TableHead>
                <TableHead>รายละเอียด</TableHead>
                <TableHead>เกิดเมื่อ</TableHead>
                <TableHead className="text-right">การดำเนินการ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {DEMO_INCIDENTS.map((incident) => (
                <TableRow key={incident.device + incident.occurredAt}>
                  <TableCell className="font-mono text-sm">
                    {incident.device}
                  </TableCell>
                  <TableCell>{incident.detail}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {incident.occurredAt}
                  </TableCell>
                  <TableCell className="text-right">
                    <IncidentActions />
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
