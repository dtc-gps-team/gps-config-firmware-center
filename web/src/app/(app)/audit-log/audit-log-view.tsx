"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  HistoryIcon,
  SearchXIcon,
} from "lucide-react";

import { RoleGuard } from "@/components/auth/role-guard";
import { useAuth } from "@/components/auth/auth-provider";
import { canAccessAuditLog } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { useAuditLogs, type AuditLogRow } from "@/hooks/use-audit-logs";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useUrlParams } from "@/hooks/use-url-params";
import { dayRangeToIso } from "@/lib/audit-date-range";
import { listAuditLogs } from "@/lib/audit-api";
import { listUsers } from "@/lib/users-api";
import { downloadCsv, toCsv } from "@/lib/csv";
import { TableSkeleton } from "@/components/skeleton/table-skeleton";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { PageHeader } from "@/components/page-header";
import { RefreshControl } from "@/components/refresh-control";
import { AuditLogDetailSheet } from "./audit-log-detail-sheet";

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

/** ตัวกรองและหน้าที่เก็บใน URL (`?from=&to=&actor=&module=&action=&page=`) */
const URL_DEFAULTS = {
  from: "",
  to: "",
  actor: "",
  module: "",
  action: "",
  page: "1",
};

/** ส่งออกสูงสุดตามตัวกรองปัจจุบัน — กันดึงทั้งฐานข้อมูล */
const EXPORT_MAX_ROWS = 5000;
const EXPORT_PAGE_SIZE = 100;

/**
 * เนื้อหาจริงของหน้า Audit Log — แยกเป็น client component ต่างหากจาก
 * page.tsx (server component ที่ export metadata) เพราะ RoleGuard ต้องใช้
 * useAuth() ซึ่งเป็น client-only hook
 */
export function AuditLogView() {
  const { session } = useAuth();
  const { values, update, reset } = useUrlParams(URL_DEFAULTS);
  const [selected, setSelected] = useState<AuditLogRow | null>(null);
  const [exporting, setExporting] = useState(false);

  const page = Math.max(1, Number(values.page) || 1);
  const debouncedAction = useDebouncedValue(values.action.trim(), 300);
  const debouncedActor = useDebouncedValue(values.actor.trim(), 300);
  const range = dayRangeToIso(values.from, values.to);
  const hasFilter = Boolean(
    values.module ||
      debouncedAction ||
      debouncedActor ||
      values.from ||
      values.to,
  );
  const filters = {
    auditModule: values.module || undefined,
    action: debouncedAction || undefined,
    actorName: debouncedActor || undefined,
    from: range.from,
    to: range.to,
  };
  const { data, total, isLoading, error, refetch } = useAuditLogs({
    ...filters,
    // ช่วงวันที่ไม่ถูกต้อง: ไม่ยิง request (จะได้ 400) แสดงข้อความแทนตาราง
    enabled: !range.error,
    page,
    pageSize: PAGE_SIZE,
  });
  const rows = data ?? [];
  const totalPages = total ? Math.ceil(total / PAGE_SIZE) : 0;

  const firstRow = (page - 1) * PAGE_SIZE + 1;
  const lastRow = firstRow + rows.length - 1;

  /** เปลี่ยนตัวกรองแล้วกลับหน้า 1 เสมอ */
  function setFilter(patch: Partial<typeof URL_DEFAULTS>) {
    update({ ...patch, page: "1" });
  }

  /** ดึงทุกหน้าตามตัวกรองปัจจุบัน (สูงสุด EXPORT_MAX_ROWS) แล้วสร้าง CSV ฝั่ง client */
  async function exportCsv() {
    const token = session?.accessToken;
    if (!token || range.error) return;
    setExporting(true);
    try {
      const users = await listUsers(token).catch(() => []);
      const nameById = new Map(users.map((u) => [u.id, u.fullName]));
      const lines: string[][] = [];
      let count = Infinity;
      for (let p = 1; lines.length < Math.min(count, EXPORT_MAX_ROWS); p++) {
        const result = await listAuditLogs(token, {
          ...filters,
          page: p,
          pageSize: EXPORT_PAGE_SIZE,
        });
        count = result.total;
        if (result.items.length === 0) break;
        for (const log of result.items) {
          lines.push([
            log.createdAt,
            nameById.get(log.userId) ?? log.userId,
            log.auditModule,
            log.action,
            log.ipAddress ?? "",
            log.metadata ? JSON.stringify(log.metadata) : "",
          ]);
        }
      }
      downloadCsv(
        `audit-log-${new Date().toISOString().slice(0, 10)}.csv`,
        toCsv(
          ["createdAt", "actor", "module", "action", "ipAddress", "metadata"],
          lines,
        ),
      );
      toast.success(
        count > lines.length
          ? `ส่งออก ${lines.length.toLocaleString("th-TH")} จาก ${count.toLocaleString("th-TH")} รายการ (จำกัดสูงสุด ${EXPORT_MAX_ROWS.toLocaleString("th-TH")})`
          : `ส่งออก ${lines.length.toLocaleString("th-TH")} รายการ`,
      );
    } catch {
      toast.error("ส่งออก Audit Log ไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      setExporting(false);
    }
  }

  return (
    <RoleGuard allow={canAccessAuditLog}>
      <div className="flex flex-col gap-5">
        <PageHeader
          title="Audit Log"
          description="ประวัติการกระทำที่เปลี่ยนข้อมูลในระบบ ใครทำอะไร เมื่อไร กรองตามช่วงวันที่หรือผู้ทำรายการได้"
          actions={
            <>
              <RefreshControl />
              <Button
                variant="outline"
                onClick={() => void exportCsv()}
                loading={exporting}
                disabled={Boolean(range.error) || (total ?? 0) === 0}
              >
                <DownloadIcon />
                ส่งออก CSV
              </Button>
            </>
          }
        />

        <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="audit-date-from" className="text-xs">
              ตั้งแต่วันที่
            </Label>
            <Input
              id="audit-date-from"
              type="date"
              value={values.from}
              max={values.to || undefined}
              onChange={(e) => setFilter({ from: e.target.value })}
              className="h-8 w-40"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="audit-date-to" className="text-xs">
              ถึงวันที่
            </Label>
            <Input
              id="audit-date-to"
              type="date"
              value={values.to}
              min={values.from || undefined}
              onChange={(e) => setFilter({ to: e.target.value })}
              className="h-8 w-40"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="audit-actor" className="text-xs">
              ผู้ทำรายการ
            </Label>
            <Input
              id="audit-actor"
              value={values.actor}
              onChange={(e) => setFilter({ actor: e.target.value })}
              placeholder="พิมพ์ชื่อผู้ทำรายการ"
              className="h-8 w-48"
            />
          </div>
          <Select
            value={values.module}
            onValueChange={(value) => setFilter({ module: value ?? "" })}
          >
            <SelectTrigger className="h-8 max-w-48" aria-label="โมดูล">
              <SelectValue placeholder="โมดูล: ทั้งหมด">
                {(value: string) =>
                  AUDIT_MODULE_OPTIONS.find((m) => m.value === value)?.label ??
                  "โมดูล: ทั้งหมด"
                }
              </SelectValue>
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
            value={values.action}
            onChange={(e) => setFilter({ action: e.target.value })}
            placeholder="ค้นหา action เช่น create, approve, reject…"
            aria-label="Action"
            className="h-8 max-w-64"
          />
          {(values.module ||
            values.action ||
            values.actor ||
            values.from ||
            values.to) && (
            <Button variant="ghost" size="sm" onClick={reset}>
              ล้างตัวกรอง
            </Button>
          )}
          <span className="font-instrument ml-auto text-xs text-muted-foreground tabular-nums">
            {(total ?? 0).toLocaleString("th-TH")} รายการ
          </span>
        </div>

        {range.error && (
          <p role="alert" className="text-sm text-destructive">
            {range.error}
          </p>
        )}

        {range.error ? null : isLoading && data === null ? (
          <TableSkeleton columns={5} />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={hasFilter ? SearchXIcon : HistoryIcon}
            message={
              hasFilter
                ? "ไม่พบประวัติที่ตรงกับเงื่อนไข ลองเปลี่ยนหรือล้างตัวกรอง"
                : "ยังไม่มีประวัติการทำงาน จะแสดงเมื่อมีการสร้าง แก้ไข หรืออนุมัติข้อมูล"
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>เวลา</TableHead>
                  <TableHead>ผู้ทำรายการ</TableHead>
                  <TableHead>โมดูล</TableHead>
                  <TableHead>Action</TableHead>
                  {/* ipAddress เป็น null ในแถวเก่าและ flow อัตโนมัติ (openapi AuditLogEntry) */}
                  <TableHead>IP Address</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow
                    key={row.id}
                    tabIndex={0}
                    aria-label={`ดูรายละเอียด ${row.action} โดย ${row.actorName}`}
                    className="cursor-pointer focus-visible:bg-muted/60 focus-visible:outline-none"
                    onClick={() => setSelected(row)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelected(row);
                      }
                    }}
                  >
                    <TableCell className="font-instrument text-xs text-muted-foreground">
                      {new Date(row.createdAt).toLocaleString("th-TH")}
                    </TableCell>
                    <TableCell className="text-xs">{row.actorName}</TableCell>
                    <TableCell className="font-instrument text-xs">
                      {row.auditModule}
                    </TableCell>
                    <TableCell className="font-instrument text-xs">
                      {row.action}
                    </TableCell>
                    <TableCell className="font-instrument text-xs text-muted-foreground">
                      {row.ipAddress ?? "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {!range.error && totalPages > 1 && rows.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
            <span className="tabular-nums">
              แสดง {firstRow.toLocaleString("th-TH")}-
              {lastRow.toLocaleString("th-TH")} จาก{" "}
              {(total ?? 0).toLocaleString("th-TH")} รายการ
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => update({ page: String(page - 1) })}
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
                onClick={() => update({ page: String(page + 1) })}
                disabled={isLoading || page >= totalPages}
              >
                ถัดไป
                <ChevronRightIcon />
              </Button>
            </div>
          </div>
        )}
      </div>
      <AuditLogDetailSheet row={selected} onClose={() => setSelected(null)} />
    </RoleGuard>
  );
}
