"use client";

import { useAuth } from "@/components/auth/auth-provider";
import { useIncidents } from "@/hooks/use-incidents";
import { usePendingApprovals } from "@/hooks/use-pending-approvals";
import { usePendingCampaignRollouts } from "@/hooks/use-pending-campaign-rollouts";
import { usePendingDeviceConfigOverrides } from "@/hooks/use-pending-device-config-overrides";
import { usePendingDeviceFirmwareOverrides } from "@/hooks/use-pending-device-firmware-overrides";
import { activeIncidentCount } from "@/lib/dashboard-metrics";
import {
  canDecideCampaignApproval,
  canDecideConfigApproval,
  canDecideDeviceConfigOverride,
  canDecideFirmwareOverride,
} from "@/lib/permissions";
import { cn } from "@/lib/utils";

/**
 * จำนวนงานค้างบนเมนู sidebar — **เฉพาะเมนูที่มี API จริง** (Approval Center,
 * Incident & Rollback) ไม่แสดงตัวเลขถ้าไม่มีงานค้าง · ข้อมูลมาจาก hook ชุด
 * เดียวกับ Dashboard (poll/refetch เองอยู่แล้ว) ไม่เพิ่ม endpoint ใหม่
 *
 * ApprovalNavBadge ยิง API ต่อเมื่อ role นั้นอนุมัติอะไรได้จริงเท่านั้น
 * (เงื่อนไขเดียวกับแถบแจ้งเตือนบน Dashboard) role อื่นจะไม่ถูกยิง 403
 */
function CountPill({
  count,
  label,
  compact,
}: {
  count: number;
  label: string;
  compact: boolean;
}) {
  if (count <= 0) return null;
  return (
    <span
      aria-label={`${label} ${count} รายการ`}
      data-tabular
      className={cn(
        "flex h-5 min-w-5 items-center justify-center rounded-full bg-warning px-1.5 text-[11px] leading-none font-semibold text-sidebar tabular-nums",
        compact ? "absolute -top-1 -right-1" : "ml-auto",
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

function ApprovalCount({ compact }: { compact: boolean }) {
  const configs = usePendingApprovals();
  const rollouts = usePendingCampaignRollouts();
  const overrides = usePendingDeviceConfigOverrides();
  const firmwareOverrides = usePendingDeviceFirmwareOverrides();
  const count =
    (configs.data?.length ?? 0) +
    (rollouts.data?.length ?? 0) +
    (overrides.data?.length ?? 0) +
    (firmwareOverrides.data?.length ?? 0);
  return <CountPill count={count} label="รออนุมัติ" compact={compact} />;
}

export function ApprovalNavBadge({ compact }: { compact: boolean }) {
  const { session } = useAuth();
  const role = session?.role;
  const canAnyDecide =
    canDecideConfigApproval(role) ||
    canDecideCampaignApproval(role) ||
    canDecideDeviceConfigOverride(role) ||
    canDecideFirmwareOverride(role);
  if (!canAnyDecide) return null;
  return <ApprovalCount compact={compact} />;
}

export function IncidentNavBadge({ compact }: { compact: boolean }) {
  const incidents = useIncidents();
  const count = incidents.data ? activeIncidentCount(incidents.data) : 0;
  return <CountPill count={count} label="ที่ยังต้องตาม" compact={compact} />;
}

/** เมนูที่มีตัวเลขงานค้าง (href → component) */
export const NAV_BADGES: Record<
  string,
  React.ComponentType<{ compact: boolean }>
> = {
  "/approvals": ApprovalNavBadge,
  "/incidents": IncidentNavBadge,
};
