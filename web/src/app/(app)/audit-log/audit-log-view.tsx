"use client";

import { useState } from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  HistoryIcon,
  RefreshCwIcon,
  SearchXIcon,
} from "lucide-react";

import { RoleGuard } from "@/components/auth/role-guard";
import { canAccessAuditLog } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardAction,
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
import { TableSkeleton } from "@/components/skeleton/table-skeleton";
import { EmptyState } from "@/components/empty-state";

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

/** แถวต่อหน้า — ตรงกับ default `pageSize` ของ backend (`GET /audit-logs`) */
const PAGE_SIZE = 20;

/**
 * เนื้อหาจริงของหน้า Audit Log — แยกเป็น client component ต่างหากจาก
 * page.tsx (server component ที่ export metadata) เพราะ RoleGuard ต้องใช้
 * useAuth() ซึ่งเป็น client-only hook
 */
export function AuditLogView() {
  const [auditModule, setAuditModule] = useState("");
  const [action, setAction] = useState("");
  // ไม่ต้องกันกรณีหน้าปัจจุบันเกินจำนวนหน้าจริง — AuditLog เพิ่มอย่างเดียว
  // ไม่มีการลบแถว และเปลี่ยน filter แล้วกลับไปหน้า 1 เสมอ
  const [page, setPage] = useState(1);
  const debouncedAction = useDebouncedValue(action.trim(), 300);
  const { data, total, isLoading, error, refetch } = useAuditLogs({
    auditModule: auditModule || undefined,
    action: debouncedAction || undefined,
    page,
    pageSize: PAGE_SIZE,
  });
  const rows = data ?? [];
  const totalPages = total ? Math.ceil(total / PAGE_SIZE) : 0;

  const firstRow = (page - 1) * PAGE_SIZE + 1;
  const lastRow = firstRow + rows.length - 1;

  return (
    <RoleGuard allow={canAccessAuditLog}>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold">Audit Log</h1>
          <p className="text-sm text-muted-foreground">
            ดูได้อย่างเดียวทุก Role ยกเว้น
            ConfigEngineer/FirmwareEngineer/QAEngineer
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>
              ประวัติการทำงาน{" "}
              <span className="text-muted-foreground">
                ({(total ?? 0).toLocaleString("th-TH")})
              </span>
            </CardTitle>
            <CardDescription>
              เรียงจากล่าสุด เฉพาะการกระทำที่เปลี่ยนข้อมูล (สร้าง/แก้ไข/
              อนุมัติ/ปฏิเสธ/นำ Config ไปใช้) ไม่รวมการดูอย่างเดียว
            </CardDescription>
            {/* useAuditLogs ดึงล่าสุดให้เองแล้วตอนกลับมาโฟกัสแท็บ (useRefetchOnFocus)
                ปุ่มนี้เผื่อกรณีอยากดึงทันทีโดยไม่ต้องสลับแท็บไปมา */}
            <CardAction>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void refetch()}
                disabled={isLoading}
              >
                <RefreshCwIcon className={isLoading ? "animate-spin" : ""} />
                รีเฟรช
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <Select
                value={auditModule}
                onValueChange={(value) => {
                  setAuditModule(value ?? "");
                  setPage(1);
                }}
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
                onChange={(e) => {
                  setAction(e.target.value);
                  setPage(1);
                }}
                placeholder="ค้นหา action เช่น create, approve, reject…"
                className="h-8 max-w-64"
              />
            </div>

            {isLoading && data === null ? (
              <TableSkeleton columns={4} />
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
              <EmptyState
                icon={
                  auditModule || debouncedAction ? SearchXIcon : HistoryIcon
                }
                message={
                  auditModule || debouncedAction
                    ? "ไม่พบประวัติที่ตรงกับเงื่อนไข"
                    : "ยังไม่มีประวัติการทำงาน"
                }
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>เวลา</TableHead>
                    <TableHead>ผู้ทำรายการ</TableHead>
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
                      <TableCell className="text-xs">{row.actorName}</TableCell>
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

            {totalPages > 1 && rows.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm text-muted-foreground">
                <span className="tabular-nums">
                  แสดง {firstRow.toLocaleString("th-TH")}-
                  {lastRow.toLocaleString("th-TH")} จาก{" "}
                  {(total ?? 0).toLocaleString("th-TH")} รายการ
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => p - 1)}
                    disabled={isLoading || page <= 1}
                  >
                    <ChevronLeftIcon />
                    ก่อนหน้า
                  </Button>
                  <span className="tabular-nums">
                    หน้า {page} / {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={isLoading || page >= totalPages}
                  >
                    ถัดไป
                    <ChevronRightIcon />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </RoleGuard>
  );
}
