"use client";

import Link from "next/link";
import {
  BoxIcon,
  CpuIcon,
  HistoryIcon,
  MegaphoneIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
  type LucideIcon,
} from "lucide-react";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuditLogs } from "@/hooks/use-audit-logs";
import { formatDateTime, formatRelativeTime } from "@/lib/format-date";

const MODULE_ICON: Record<string, LucideIcon> = {
  config: SlidersHorizontalIcon,
  "config-deletion": Trash2Icon,
  campaign: MegaphoneIcon,
  firmware: CpuIcon,
  device: BoxIcon,
};

const MODULE_LABEL: Record<string, string> = {
  config: "Config",
  "config-deletion": "คำขอลบ Config",
  campaign: "Campaign",
  firmware: "Firmware",
  device: "อุปกรณ์",
};

/** action string จาก backend (ดู audit-api.ts) → คำกริยาภาษาไทย · action ที่
 * ไม่อยู่ใน map (ยังไม่เจอจริง หรือเพิ่มใหม่ทีหลัง) โชว์ค่าดิบแทน ไม่ error */
const ACTION_LABEL: Record<string, string> = {
  create: "สร้าง",
  update: "แก้ไข",
  approve: "อนุมัติ",
  reject: "ปฏิเสธ",
  delete: "ลบ",
  decide: "ส่งผลทดสอบของ",
  "apply-config": "นำไปใช้กับ",
  keep: "คงสถานะ",
};

/**
 * กิจกรรมล่าสุดบน Dashboard — ต่อ `GET /audit-logs` จริงแล้ว (เดิมเป็น
 * DEMO_DASHBOARD_ACTIVITY + DemoNote ที่บอกว่า endpoint ยังไม่มีใน spec ซึ่ง
 * ผิดไปแล้ว — หน้า Audit Log เต็มต่อ endpoint นี้จริงมาก่อนหน้านี้แล้ว)
 *
 * แสดงแค่ 5 รายการล่าสุด ไม่มี filter (ดูทั้งหมด/filter ได้ที่ `/audit-log`) ·
 * ไม่มีชื่อผู้ทำรายการมาให้ตรงๆ จาก backend (แค่ userId ดิบ mirror
 * audit-log-view.tsx เดิม) เลยโชว์ userId ไปก่อนเหมือนกัน
 */
export function DashboardActivity() {
  const { data, isLoading, error, refetch } = useAuditLogs();
  const rows = (data ?? []).slice(0, 5);

  return (
    <Card>
      <CardHeader>
        <CardTitle>กิจกรรมล่าสุด</CardTitle>
        <CardDescription>เรียงจากล่าสุด · 5 รายการ</CardDescription>
        <CardAction>
          <Link
            href="/audit-log"
            className="text-sm text-primary hover:underline"
          >
            ดูทั้งหมด →
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent>
        {isLoading && data === null ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-5 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              ลองใหม่
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <HistoryIcon className="size-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              ยังไม่มีประวัติการทำงาน
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3 text-sm">
            {rows.map((row) => {
              const Icon = MODULE_ICON[row.auditModule] ?? HistoryIcon;
              const moduleLabel = MODULE_LABEL[row.auditModule] ?? row.auditModule;
              const actionLabel = ACTION_LABEL[row.action] ?? row.action;
              return (
                <li key={row.id} className="flex items-start gap-3">
                  <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="font-mono text-xs text-muted-foreground">
                      {row.actorName}
                    </span>{" "}
                    {actionLabel} {moduleLabel}
                  </span>
                  <span
                    className="shrink-0 text-xs whitespace-nowrap text-muted-foreground"
                    title={formatDateTime(row.createdAt)}
                  >
                    {formatRelativeTime(row.createdAt)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
