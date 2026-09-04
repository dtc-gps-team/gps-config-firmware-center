"use client";

import { RoleGuard } from "@/components/auth/role-guard";
import { canAccessAuditLog } from "@/lib/permissions";
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
import { DemoNote } from "@/components/demo/demo-note";
import { DEMO_AUDIT } from "@/lib/demo-data";

/**
 * เนื้อหาจริงของหน้า Audit Log — แยกเป็น client component ต่างหากจาก
 * page.tsx (server component ที่ export metadata) เพราะ RoleGuard ต้องใช้
 * useAuth() ซึ่งเป็น client-only hook
 */
export function AuditLogView() {
  return (
    <RoleGuard allow={canAccessAuditLog}>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold">Audit Log</h1>
          <p className="text-sm text-muted-foreground">
            ดูได้อย่างเดียวทุก Role ยกเว้น SW (RBAC_Matrix.md Section 2)
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>ประวัติการทำงาน</CardTitle>
            <CardDescription>เรียงจากล่าสุด</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <DemoNote endpoint="GET /audit-logs (ยังไม่มีใน spec)" />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>เวลา</TableHead>
                  <TableHead>ผู้ทำรายการ</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>รายละเอียด</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {DEMO_AUDIT.map((entry, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {entry.time}
                    </TableCell>
                    <TableCell>{entry.actor}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {entry.action}
                    </TableCell>
                    <TableCell>{entry.detail}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </RoleGuard>
  );
}
