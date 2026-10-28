"use client";

import type { FieldApplyRequest } from "@/lib/field-apply-request-api";
import { ApprovalQueueCard } from "./approval-queue-card";
import { FieldApplyRequestApprovalActions } from "./field-apply-request-approval-actions";

/**
 * คำขอส่ง Config/Firmware เข้ากล่องจากหน้างาน 1 รายการในคิว Approval Center
 * (docs/25 §3.3–§3.4 · docs/27 B2 · docs/30 P1) — list endpoint ไม่คืนค่าจริง
 * ของ field (แค่ `fieldNames`) ข้อมูลครบพอแสดงในการ์ดเดียว จึงไม่มีหน้า
 * รายละเอียดแยก (`detailHref` ไม่ส่ง)
 */
export function FieldApplyRequestApprovalCard({
  item,
  requesterName,
  canDecide,
  onDecided,
}: {
  item: FieldApplyRequest;
  requesterName: string;
  canDecide: boolean;
  onDecided: (action: "approve" | "reject") => void;
}) {
  const isFirmware = item.kind === "firmware";

  return (
    <ApprovalQueueCard
      tag={isFirmware ? "Firmware" : "Config"}
      title={item.task.title || <span className="font-mono">{item.deviceId}</span>}
      meta={
        <>
          <span className="font-mono">{item.deviceId}</span>
          {isFirmware ? (
            <>
              {" "}
              · {item.fromFirmwareVersion ?? "?"} →{" "}
              {item.firmware?.version ?? "?"}
              {item.isDowngrade && (
                <span className="ml-1 text-amber-600">(ถอยเวอร์ชัน)</span>
              )}
            </>
          ) : (
            item.config && (
              <>
                {" "}
                · {item.config.name} ({item.config.deviceModel}/
                {item.config.protocol})
              </>
            )
          )}
        </>
      }
      queuedAt={item.requestedAt}
      description={item.note ?? undefined}
      requesterName={requesterName}
      extra={
        !isFirmware && item.configAssigner ? (
          <p className="text-xs text-muted-foreground">
            ผู้ผูก Config เข้างานนี้: {item.configAssigner.fullName}
          </p>
        ) : undefined
      }
      summary={
        <div className="flex flex-col gap-1">
          {item.override && (
            <span className="text-amber-600">
              ผูกกับคำขอแก้ค่าเฉพาะเครื่อง (Override) — อนุมัติคำขอนี้แล้ว
              Override จะถูกอนุมัติไปด้วย
            </span>
          )}
          {!isFirmware && (
            <>
              <span className="text-muted-foreground">
                field ที่จะส่ง ({item.fieldNames.length})
              </span>
              {item.fieldNames.length === 0 ? (
                <span className="text-muted-foreground">ไม่มีพารามิเตอร์</span>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {item.fieldNames.map((name) => (
                    <span
                      key={name}
                      className="rounded-md border px-1.5 py-0.5 font-mono text-muted-foreground"
                    >
                      {name}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      }
      actions={
        <FieldApplyRequestApprovalActions
          id={item.id}
          deviceId={item.deviceId}
          canDecide={canDecide}
          onDecided={onDecided}
        />
      }
    />
  );
}
