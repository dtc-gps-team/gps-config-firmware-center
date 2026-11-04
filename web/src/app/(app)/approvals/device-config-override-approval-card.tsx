"use client";

import type { DeviceConfigOverride } from "@/lib/device-config-override-api";
import { ApprovalQueueCard } from "./approval-queue-card";
import { DeviceConfigOverrideApprovalActions } from "./device-config-override-approval-actions";
import { OverrideFieldDiffList } from "./override-field-diff-list";

/**
 * คำขอ Per-device Config Override 1 รายการในคิว Approval Center (issue #223,
 * มติ 2026-09-24) — ค่าที่ขอแก้มักมีไม่กี่ค่า จึงแสดงรายการค่าไว้บนการ์ดใน
 * ส่วนสรุปด้วย (`fields` คือค่าสะสมของเครื่องนี้เอง ไม่ใช่ทั้งชุด Config)
 * พร้อมลิงก์ไปหน้ารายละเอียดเต็ม (แก้ครั้งที่ 94 — เครื่องจริงมีพารามิเตอร์
 * เยอะกว่านี้ กล่องเลื่อนเล็กๆ ไม่พอ)
 */
export function DeviceConfigOverrideApprovalCard({
  item,
  requesterName,
  canDecide,
  onDecided,
}: {
  item: DeviceConfigOverride;
  requesterName: string;
  canDecide: boolean;
  onDecided: (action: "approve" | "reject") => void;
}) {
  const fieldEntries = Object.entries(item.fields);

  return (
    <ApprovalQueueCard
      tag="Config Override"
      title={<span className="font-instrument">{item.deviceId}</span>}
      meta={`เวอร์ชัน #${item.versionNumber}`}
      queuedAt={item.overriddenAt}
      detailHref={`/approvals/config-override/${item.id}`}
      description={item.reason}
      requesterName={requesterName}
      summary={
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground">
            ค่าที่ขอแก้ ({fieldEntries.length})
          </span>
          {fieldEntries.length === 0 ? (
            <span className="text-muted-foreground">ไม่มีพารามิเตอร์</span>
          ) : (
            <OverrideFieldDiffList
              configId={item.configId}
              fields={item.fields}
              className="max-h-48 overflow-y-auto"
            />
          )}
        </div>
      }
      actions={
        <DeviceConfigOverrideApprovalActions
          id={item.id}
          deviceId={item.deviceId}
          canDecide={canDecide}
          onDecided={onDecided}
        />
      }
    />
  );
}
