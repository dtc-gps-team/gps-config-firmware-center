"use client";

import Link from "next/link";
import { ClipboardCheckIcon } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import {
  canDecideCampaignApproval,
  canDecideConfigApproval,
  canDecideDeviceConfigOverride,
} from "@/lib/permissions";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EntityTypeTag } from "@/lib/status-pill";
import { usePendingApprovals } from "@/hooks/use-pending-approvals";
import { usePendingCampaignRollouts } from "@/hooks/use-pending-campaign-rollouts";
import { usePendingDeviceConfigOverrides } from "@/hooks/use-pending-device-config-overrides";
import { ApprovalActions } from "./approvals/approval-actions";
import { DeviceConfigOverrideApprovalActions } from "./approvals/device-config-override-approval-actions";

const MAX_ITEMS = 5;

type Row =
  | { kind: "config"; queuedAt: string; id: string; name: string }
  | {
      kind: "campaign";
      queuedAt: string;
      campaignId: string;
      rolloutId: string;
      campaignName: string;
    }
  | { kind: "override"; queuedAt: string; id: string; deviceId: string };

/**
 * Widget "รายการรออนุมัติ" บน Dashboard — ตามเอกสาร UX/UI Design ต้นฉบับ
 * (UIWEB-001) ที่มีตารางรออนุมัติพร้อมปุ่มอนุมัติ/ปฏิเสธอยู่ในหน้าแรกเลย
 * เป็นทางลัดไม่ต้องเปิด Approval Center ก่อน — ของจริงเดิมมีแต่ "กิจกรรม
 * ล่าสุด" ซึ่ง read-only (ดู `dashboard-activity.tsx`)
 *
 * **ไม่ได้เขียน logic อนุมัติ/ปฏิเสธใหม่เลย** — ยืม `ApprovalActions`/
 * `DeviceConfigOverrideApprovalActions` ตัวเดียวกับที่ Approval Center ใช้
 * ตรงๆ (ผ่านการทดสอบมาแล้วทั้งคู่) component นี้แค่รวม 3 คิวที่มีอยู่แล้ว
 * (`usePendingApprovals`/`usePendingCampaignRollouts`/
 * `usePendingDeviceConfigOverrides`) มาเรียงตามเวลาเข้าคิวแล้วโชว์ 5
 * รายการล่าสุด — ดูเพิ่มเติม/ที่เหลือทั้งหมดต้องไปที่ `/approvals`
 *
 * Campaign Rollout ไม่มีปุ่มอนุมัติ inline ในนี้ (ต่างจาก Config/Override)
 * เพราะ `CampaignRolloutApprovalPanel` เดิมมีข้อความอธิบาย SoD ยาวกว่ามาก
 * ใส่ในแถวสั้นๆ แล้วจะดูไม่สมดุลกับอีก 2 ประเภท — ลิงก์ตรงไปหน้า Rollout
 * แทน (ซึ่งมีปุ่มอนุมัติเต็มรูปแบบรออยู่แล้ว)
 *
 * **ไม่แสดง widget นี้เลยถ้า role ปัจจุบันอนุมัติอะไรไม่ได้สักอย่าง** (ทั้ง 3
 * ประเภทเป็นสิทธิ์ Operation เท่านั้นในระบบนี้) กัน noise ข้อความ "เฉพาะ
 * Operation เท่านั้น" เกะกะหน้า Dashboard ของ role อื่นที่ทำอะไรตรงนี้ไม่ได้
 * อยู่แล้ว
 */
export function DashboardPendingApprovals() {
  const { session } = useAuth();
  const role = session?.role;
  const canAnyDecide =
    canDecideConfigApproval(role) ||
    canDecideCampaignApproval(role) ||
    canDecideDeviceConfigOverride(role);

  const configs = usePendingApprovals();
  const rollouts = usePendingCampaignRollouts();
  const overrides = usePendingDeviceConfigOverrides();

  if (!canAnyDecide) {
    return null;
  }

  const rows: Row[] = [
    ...(configs.data ?? []).map(
      (c): Row => ({ kind: "config", queuedAt: c.queuedAt, id: c.id, name: c.name }),
    ),
    ...(rollouts.data ?? []).map(
      (r): Row => ({
        kind: "campaign",
        queuedAt: r.rollout.createdAt,
        campaignId: r.rollout.campaignId,
        rolloutId: r.rollout.id,
        campaignName: r.campaignName,
      }),
    ),
    ...(overrides.data ?? []).map(
      (o): Row => ({
        kind: "override",
        queuedAt: o.overriddenAt,
        id: o.id,
        deviceId: o.deviceId,
      }),
    ),
  ]
    .sort((a, b) => b.queuedAt.localeCompare(a.queuedAt))
    .slice(0, MAX_ITEMS);

  const totalCount =
    (configs.data?.length ?? 0) +
    (rollouts.data?.length ?? 0) +
    (overrides.data?.length ?? 0);
  const stillLoading =
    configs.isLoading &&
    rollouts.isLoading &&
    overrides.isLoading &&
    configs.data === null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          รายการรออนุมัติ{" "}
          <span className="text-muted-foreground">({totalCount})</span>
        </CardTitle>
        <CardDescription>ทางลัดอนุมัติ/ปฏิเสธโดยไม่ต้องเปิด Approval Center</CardDescription>
        <CardAction>
          <Link
            href="/approvals"
            className="text-sm text-primary hover:underline"
          >
            ดูทั้งหมด →
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent>
        {stillLoading ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <ClipboardCheckIcon className="size-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              ไม่มีรายการรออนุมัติตอนนี้
            </p>
          </div>
        ) : (
          <ul className="flex flex-col divide-y">
            {rows.map((row) => (
              <li
                key={`${row.kind}-${row.kind === "campaign" ? row.rolloutId : row.id}`}
                className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                {row.kind === "config" && (
                  <>
                    <div className="flex min-w-0 items-center gap-2">
                      <EntityTypeTag type="Config" />
                      <span className="truncate text-sm font-medium">
                        {row.name}
                      </span>
                    </div>
                    <ApprovalActions
                      configId={row.id}
                      configName={row.name}
                      canDecide={canDecideConfigApproval(role)}
                      onDecided={() => void configs.refetch()}
                    />
                  </>
                )}
                {row.kind === "campaign" && (
                  <>
                    <div className="flex min-w-0 items-center gap-2">
                      <EntityTypeTag type="Campaign" />
                      <span className="truncate text-sm font-medium">
                        {row.campaignName}
                      </span>
                    </div>
                    <Link
                      href={`/campaigns/${row.campaignId}/rollouts/${row.rolloutId}`}
                      className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    >
                      ไปอนุมัติ →
                    </Link>
                  </>
                )}
                {row.kind === "override" && (
                  <>
                    <div className="flex min-w-0 items-center gap-2">
                      <EntityTypeTag type="Override" />
                      <span className="truncate font-mono text-sm font-medium">
                        {row.deviceId}
                      </span>
                    </div>
                    <DeviceConfigOverrideApprovalActions
                      id={row.id}
                      deviceId={row.deviceId}
                      canDecide={canDecideDeviceConfigOverride(role)}
                      onDecided={() => void overrides.refetch()}
                    />
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
