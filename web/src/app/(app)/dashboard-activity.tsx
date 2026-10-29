"use client";

import Link from "next/link";
import { motion } from "motion/react";
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
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { RelativeTime } from "@/components/relative-time";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/components/auth/auth-provider";
import { canAccessAuditLog } from "@/lib/permissions";
import { useAuditLogs } from "@/hooks/use-audit-logs";
import { listItem, staggerContainer } from "@/lib/motion";

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
 * ชื่อผู้ทำรายการ resolve จาก `GET /users` ใน `useAuditLogs` เอง (ดู
 * comment เหนือ `AuditLogRow` ใน `use-audit-logs.ts`)
 */
export function DashboardActivity() {
  const { session } = useAuth();
  // ConfigEngineer/FirmwareEngineer/QAEngineer เข้า Audit Log ไม่ได้ (403) —
  // ไม่แสดงแผงนี้เลย (มุมมองของ role เหล่านี้ก็ไม่มีแผงนี้อยู่แล้ว กันซ้ำที่นี่อีกชั้น)
  const allowed = canAccessAuditLog(session?.role);
  // ขอแค่ 5 แถวจาก backend ตรงๆ (เดิมดึงทุกแถวแล้ว slice ฝั่ง client)
  const { data, isLoading, error, refetch } = useAuditLogs({
    pageSize: 5,
    enabled: allowed,
  });
  if (!allowed) return null;
  const rows = data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">กิจกรรมล่าสุด</CardTitle>
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
              <Skeleton key={i} className="h-5" />
            ))}
          </div>
        ) : error ? (
          <ErrorState message={error} onRetry={() => void refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState icon={HistoryIcon} message="ยังไม่มีประวัติการทำงาน" />
        ) : (
          <motion.ul
            initial="hidden"
            animate="visible"
            variants={staggerContainer}
            className="flex flex-col divide-y text-sm"
          >
            {rows.map((row) => {
              const Icon = MODULE_ICON[row.auditModule] ?? HistoryIcon;
              const moduleLabel = MODULE_LABEL[row.auditModule] ?? row.auditModule;
              const actionLabel = ACTION_LABEL[row.action] ?? row.action;
              return (
                <motion.li
                  key={row.id}
                  variants={listItem}
                  className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0"
                >
                  <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{row.actorName}</span>{" "}
                    {actionLabel} {moduleLabel}
                  </span>
                  <RelativeTime
                    iso={row.createdAt}
                    className="shrink-0 text-xs whitespace-nowrap text-muted-foreground"
                  />
                </motion.li>
              );
            })}
          </motion.ul>
        )}
      </CardContent>
    </Card>
  );
}
