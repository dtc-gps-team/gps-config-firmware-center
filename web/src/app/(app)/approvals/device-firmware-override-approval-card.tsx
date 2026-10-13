"use client";

import { useFirmware } from "@/hooks/use-firmware";
import type { DeviceFirmwareOverride } from "@/lib/device-firmware-override-api";
import { ApprovalQueueCard } from "./approval-queue-card";
import { DeviceFirmwareOverrideApprovalActions } from "./device-firmware-override-approval-actions";

/**
 * คำขอ Firmware Override รายเครื่อง 1 รายการในคิว Approval Center (Sprint 3
 * แถวที่ 24) — Firmware ไม่มี `fields` ให้แสดง (เป็นเวอร์ชันเดียวทั้งก้อน)
 * จึงสรุปแค่เวอร์ชันที่ขอ · resolve ชื่อเวอร์ชัน firmware เองผ่าน `useFirmware`
 * (backend ไม่ embed) · ยังไม่มีหน้ารายละเอียดของคำขอนี้ จึงไม่มีลิงก์
 */
export function DeviceFirmwareOverrideApprovalCard({
  item,
  requesterName,
  canDecide,
  onDecided,
}: {
  item: DeviceFirmwareOverride;
  requesterName: string;
  canDecide: boolean;
  onDecided: (action: "approve" | "reject") => void;
}) {
  const firmwareQuery = useFirmware(item.firmwareId);

  return (
    <ApprovalQueueCard
      tag="Firmware Override"
      title={<span className="font-mono">{item.deviceId}</span>}
      meta={`เวอร์ชัน #${item.versionNumber}`}
      queuedAt={item.overriddenAt}
      description={item.reason}
      requesterName={requesterName}
      summary={
        <span>
          ขอติดตั้ง Firmware{" "}
          <span className="font-mono">
            {firmwareQuery.data
              ? `v${firmwareQuery.data.version}`
              : item.firmwareId}
          </span>
        </span>
      }
      actions={
        <DeviceFirmwareOverrideApprovalActions
          id={item.id}
          deviceId={item.deviceId}
          canDecide={canDecide}
          onDecided={onDecided}
        />
      }
    />
  );
}
