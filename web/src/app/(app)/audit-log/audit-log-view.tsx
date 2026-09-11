"use client";

import { RoleGuard } from "@/components/auth/role-guard";
import { canAccessAuditLog } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
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
import { useAuditLogs } from "@/hooks/use-audit-logs";

/**
 * เนื้อหาจริงของหน้า Audit Log — แยกเป็น client component ต่างหากจาก
 * page.tsx (server component ที่ export metadata) เพราะ RoleGuard ต้องใช้
 * useAuth() ซึ่งเป็น client-only hook
 */
export function AuditLogView() {
  const { data, isLoading, error, refetch } = useAuditLogs();
  const rows = data ?? [];

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
            <CardTitle>
              ประวัติการทำงาน{" "}
              <span className="text-muted-foreground">({rows.length})</span>
            </CardTitle>
            <CardDescription>
              เรียงจากล่าสุด — เฉพาะการกระทำที่เปลี่ยนข้อมูล (สร้าง/แก้ไข/
              อนุมัติ/ปฏิเสธ/นำ Config ไปใช้) ไม่รวมการดูอย่างเดียว
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {isLoading && data === null ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                กำลังโหลด…
              </p>
            ) : error ? (
              <div className="flex flex-col items-center gap-3 py-8">
                <p className="text-sm text-destructive">{error}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void refetch()}
                >
                  ลองใหม่
                </Button>
              </div>
            ) : rows.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                ยังไม่มีประวัติการทำงาน
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>เวลา</TableHead>
                    <TableHead>
                      ผู้ทำรายการ (user id)
                    </TableHead>
                    <TableHead>โมดูล</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {new Date(row.createdAt).toLocaleString("th-TH")}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {row.actorName}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {row.auditModule}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {row.action}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </RoleGuard>
  );
}
