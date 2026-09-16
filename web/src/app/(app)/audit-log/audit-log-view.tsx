"use client";

import { useState } from "react";

import { RoleGuard } from "@/components/auth/role-guard";
import { canAccessAuditLog } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuditLogs } from "@/hooks/use-audit-logs";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

/** โมดูลที่เขียน AuditLog จริงตอนนี้ — mirror `AUDIT_MODULE` ของแต่ละ
 * service ฝั่ง backend (config/campaign/config-deletion/device/firmware
 * service.ts) · task/notification (โมดูล B) ยังไม่มี audit log */
const AUDIT_MODULE_OPTIONS = [
  { value: "config", label: "Config" },
  { value: "config-deletion", label: "Config Deletion" },
  { value: "campaign", label: "Campaign" },
  { value: "firmware", label: "Firmware" },
  { value: "device", label: "Device" },
];

/**
 * เนื้อหาจริงของหน้า Audit Log — แยกเป็น client component ต่างหากจาก
 * page.tsx (server component ที่ export metadata) เพราะ RoleGuard ต้องใช้
 * useAuth() ซึ่งเป็น client-only hook
 */
export function AuditLogView() {
  const [auditModule, setAuditModule] = useState("");
  const [action, setAction] = useState("");
  const debouncedAction = useDebouncedValue(action.trim(), 300);
  const { data, isLoading, error, refetch } = useAuditLogs({
    auditModule: auditModule || undefined,
    action: debouncedAction || undefined,
  });
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
            <div className="flex flex-wrap gap-2">
              <Select
                value={auditModule}
                onValueChange={(value) => setAuditModule(value ?? "")}
              >
                <SelectTrigger className="h-8 max-w-48">
                  <SelectValue placeholder="โมดูล: ทั้งหมด" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">โมดูล: ทั้งหมด</SelectItem>
                  {AUDIT_MODULE_OPTIONS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={action}
                onChange={(e) => setAction(e.target.value)}
                placeholder="ค้นหา action เช่น create, approve, reject…"
                className="h-8 max-w-64"
              />
            </div>

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
                {auditModule || debouncedAction
                  ? "ไม่พบประวัติที่ตรงกับเงื่อนไข"
                  : "ยังไม่มีประวัติการทำงาน"}
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
                    {/* ipAddress เป็น null เสมอตอนนี้ — openapi.yaml AuditLogEntry
                        ระบุว่ายังไม่มี endpoint ไหนส่งค่านี้มาจริง (nullable ไว้รอ) */}
                    <TableHead>IP Address</TableHead>
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
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {row.ipAddress ?? "-"}
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
