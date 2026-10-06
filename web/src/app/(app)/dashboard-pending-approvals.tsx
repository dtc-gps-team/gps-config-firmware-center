"use client";

import Link from "next/link";
import { ClipboardCheckIcon } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import {
  canDecideCampaignApproval,
  canDecideConfigApproval,
  canDecideDeviceConfigOverride,
  canDecideFirmwareOverride,
} from "@/lib/permissions";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EntityTypeTag } from "@/lib/status-pill";
import { usePendingApprovals } from "@/hooks/use-pending-approvals";
import { usePendingCampaignRollouts } from "@/hooks/use-pending-campaign-rollouts";
import { usePendingDeviceConfigOverrides } from "@/hooks/use-pending-device-config-overrides";
import { usePendingDeviceFirmwareOverrides } from "@/hooks/use-pending-device-firmware-overrides";
import { ApprovalActions } from "./approvals/approval-actions";
import { DeviceConfigOverrideApprovalActions } from "./approvals/device-config-override-approval-actions";
import { DeviceFirmwareOverrideApprovalActions } from "./approvals/device-firmware-override-approval-actions";

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
  | { kind: "override"; queuedAt: string; id: string; deviceId: string }
  | {
      kind: "firmware-override";
      queuedAt: string;
      id: string;
      deviceId: string;
    };

/**
 * Widget "รายการรออนุมัติ" บน Dashboard — ตามเอกสาร UX/UI Design ต้นฉบับ
 * (UIWEB-001) ที่มีตารางรออนุมัติพร้อมปุ่มอนุมัติ/ปฏิเสธอยู่ในหน้าแรกเลย
 * เป็นทางลัดไม่ต้องเปิด Approval Center ก่อน — ของจริงเดิมมีแต่ "กิจกรรม
 * ล่าสุด" ซึ่ง read-only (ดู `dashboard-activity.tsx`)
 *
 * **ไม่แสดง widget นี้เลยถ้า role ปัจจุบันอนุมัติอะไรไม่ได้สักอย่าง** (ทั้ง 3
 * ประเภทเป็นสิทธิ์ Operation เท่านั้นในระบบนี้) กัน noise ข้อความ "เฉพาะ
 * Operation เท่านั้น" เกะกะหน้า Dashboard ของ role อื่นที่ทำอะไรตรงนี้ไม่ได้
 * อยู่แล้ว
 *
 * **แยก `PendingApprovalsCard` ออกเป็น component ย่อยโดยตั้งใจ (review
 * comment B บน PR #251 ข้อ 1)** — เดิม hook ทั้ง 3 ตัวถูกเรียกใน component
 * เดียวกับที่เช็ค `canAnyDecide` (ต้องเรียกก่อน early return ตาม rules of
 * hooks) ทำให้ทุก role รวมถึง ST/OT/Auditor ที่เปิด Dashboard ยิง
 * `GET /config?status=testing`, `GET /users?role=Operation`, list rollouts
 * ทั้งระบบ + `listCampaigns`, list override ทุกครั้ง (ซ้ำตอน refocus ผ่าน
 * `useRefetchOnFocus` ด้วย) ทั้งที่ผลถูกทิ้งเพราะ widget ไม่แสดงให้เห็นอยู่ดี
 * — backend ยังคุมสิทธิ์จริงอยู่เสมอ (ไม่ใช่ช่องโหว่) แต่ผิดหลัก least
 * privilege ฝั่ง client สำหรับ role ที่ไม่เกี่ยวกับฟีเจอร์นี้เลย แยก
 * component แล้ว hook ทั้ง 3 จะถูกเรียกเฉพาะตอน render `PendingApprovalsCard`
 * ซึ่งเกิดขึ้นเฉพาะ role ที่ `canAnyDecide` เท่านั้น
 */
export function DashboardPendingApprovals() {
  const { session } = useAuth();
  const role = session?.role;
  const canAnyDecide =
    canDecideConfigApproval(role) ||
    canDecideCampaignApproval(role) ||
    canDecideDeviceConfigOverride(role) ||
    canDecideFirmwareOverride(role);

  if (!canAnyDecide) {
    return null;
  }

  return <PendingApprovalsCard role={role} />;
}

/**
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
 */
function PendingApprovalsCard({ role }: { role: string | undefined }) {
  const configs = usePendingApprovals();
  const rollouts = usePendingCampaignRollouts();
  const overrides = usePendingDeviceConfigOverrides();
  const firmwareOverrides = usePendingDeviceFirmwareOverrides();

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
    ...(firmwareOverrides.data ?? []).map(
      (o): Row => ({
        kind: "firmware-override",
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
    (overrides.data?.length ?? 0) +
    (firmwareOverrides.data?.length ?? 0);

  // #251 review comment B ข้อ 2 — เดิมเป็น AND ทั้ง 3 ตัว ถ้าคิวหนึ่งโหลด
  // เสร็จก่อน (ว่าง) อีกสองคิวยังโหลดอยู่ จะเห็น empty state โผล่มาชั่วขณะ
  // ก่อนเด้งเป็นมีรายการ — เปลี่ยนเป็น OR: "ยังโหลดอยู่" ถ้ามีคิวไหนก็ตามที่
  // ยังไม่เคยได้ข้อมูลรอบแรกเลย (data === null)
  const stillLoading =
    (configs.isLoading && configs.data === null) ||
    (rollouts.isLoading && rollouts.data === null) ||
    (overrides.isLoading && overrides.data === null) ||
    (firmwareOverrides.isLoading && firmwareOverrides.data === null);

  // #251 review comment B ข้อ 2 — เดิมไม่อ่าน .error ของ 3 hook เลย ถ้าโหลด
  // พัง widget จะโชว์ "ไม่มีรายการรออนุมัติ" ทำให้ Operation เข้าใจผิดว่าไม่มี
  // งานค้าง — รวม error ที่มีจริงมาโชว์แทน (อาจมีได้มากกว่า 1 คิวพังพร้อมกัน)
  const errors = [
    configs.error,
    rollouts.error,
    overrides.error,
    firmwareOverrides.error,
  ].filter((e): e is string => e !== null);

  function retryAll() {
    void configs.refetch();
    void rollouts.refetch();
    void overrides.refetch();
    void firmwareOverrides.refetch();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          รายการรออนุมัติ{" "}
          <span className="text-muted-foreground">({totalCount})</span>
        </CardTitle>
        <CardDescription>
          ทางลัดดูสิ่งที่รออนุมัติโดยไม่ต้องเปิด Approval Center — Config/คำขอ
          Override กดอนุมัติได้ตรงนี้เลย ส่วน Campaign Rollout ลิงก์ไปอนุมัติ
          ต่อ
        </CardDescription>
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
        ) : errors.length > 0 ? (
          <div className="flex flex-col items-center gap-3 py-8">
            {errors.map((e, i) => (
              <p key={i} className="text-sm text-destructive">
                {e}
              </p>
            ))}
            <Button variant="outline" size="sm" onClick={retryAll}>
              ลองใหม่
            </Button>
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
                {row.kind === "firmware-override" && (
                  <>
                    <div className="flex min-w-0 items-center gap-2">
                      <EntityTypeTag type="Override" />
                      <span className="truncate font-mono text-sm font-medium">
                        {row.deviceId}
                      </span>
                    </div>
                    <DeviceFirmwareOverrideApprovalActions
                      id={row.id}
                      deviceId={row.deviceId}
                      canDecide={canDecideFirmwareOverride(role)}
                      onDecided={() => void firmwareOverrides.refetch()}
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
