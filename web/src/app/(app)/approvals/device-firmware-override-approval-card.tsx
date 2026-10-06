"use client";

import { Card } from "@/components/ui/card";
import { EntityTypeTag, StalePendingBadge } from "@/lib/status-pill";
import { formatDateTime, stalePendingLabel } from "@/lib/format-date";
import { useFirmware } from "@/hooks/use-firmware";
import type { DeviceFirmwareOverride } from "@/lib/device-firmware-override-api";
import { DeviceFirmwareOverrideApprovalActions } from "./device-firmware-override-approval-actions";

/**
 * คำขอ Firmware Override รายเครื่อง 1 รายการในคิว Approval Center (Sprint 3
 * แถวที่ 24) — mirror `device-config-override-approval-card.tsx` แต่เรียบง่าย
 * กว่า เพราะ Firmware ไม่มี `fields` ให้แสดง (เป็นเวอร์ชันเดียวทั้งก้อน ไม่ใช่
 * key-value แบบ Config) — resolve ชื่อเวอร์ชัน firmware เองผ่าน `useFirmware`
 * (backend ไม่ embed) ตาม pattern เดียวกับที่อื่นในหน้า campaign
 */
export function DeviceFirmwareOverrideApprovalCard({
  item,
  canDecide,
  onDecided,
}: {
  item: DeviceFirmwareOverride;
  canDecide: boolean;
  onDecided: (action: "approve" | "reject") => void;
}) {
  const firmwareQuery = useFirmware(item.firmwareId);
  const staleLabel = stalePendingLabel(item.overriddenAt);

  return (
    <Card className={staleLabel ? "border-l-4 border-l-amber-500" : undefined}>
      <div className="flex flex-wrap items-start justify-between gap-4 px-4">
        <div className="min-w-0 flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <EntityTypeTag type="Override" />
            <span className="font-mono font-medium">{item.deviceId}</span>
            <span className="text-xs text-muted-foreground">
              เวอร์ชัน #{item.versionNumber}
            </span>
            {staleLabel && <StalePendingBadge label={staleLabel} />}
          </div>
          <p className="text-sm">
            ขอติดตั้ง Firmware{" "}
            <span className="font-mono">
              {firmwareQuery.data
                ? `v${firmwareQuery.data.version}`
                : item.firmwareId}
            </span>
          </p>
          <p className="text-sm text-muted-foreground">{item.reason}</p>
          <p className="text-xs text-muted-foreground">
            ผู้ส่งคำขอ (ST) <span className="font-mono">{item.overriddenBy}</span>{" "}
            · ส่งเมื่อ {formatDateTime(item.overriddenAt)}
          </p>
        </div>
        <DeviceFirmwareOverrideApprovalActions
          id={item.id}
          deviceId={item.deviceId}
          canDecide={canDecide}
          onDecided={onDecided}
        />
      </div>
    </Card>
  );
}
