"use client";

import Link from "next/link";

import { Card } from "@/components/ui/card";
import { EntityTypeTag, StalePendingBadge } from "@/lib/status-pill";
import { formatDateTime, stalePendingLabel } from "@/lib/format-date";

/**
 * โครงกลางของการ์ด 1 รายการในคิว Approval Center — ทุกประเภทคำขอ (Config,
 * Campaign Rollout, Config Override, Firmware Override) ใช้ตัวนี้ เพื่อให้
 * ตำแหน่งข้อมูลและปุ่มตรงกันทุกการ์ด เดิมแต่ละประเภทวางเอง ปุ่มบ้างอยู่บนขวา
 * บ้างอยู่ล่าง ผู้ส่งคำขอบ้างเป็นชื่อบ้างเป็น UUID
 *
 * ลำดับ: ป้ายประเภท + ชื่อเรื่อง + ข้อมูลสั้น (ลิงก์ดูรายละเอียดบนขวาถ้ามี)
 * -> คำอธิบาย/เหตุผล -> ผู้ส่งคำขอและเวลา -> ข้อมูลสรุปเฉพาะประเภท -> ปุ่ม
 */
export function ApprovalQueueCard({
  tag,
  title,
  meta,
  queuedAt,
  detailHref,
  description,
  requesterLabel = "ผู้ส่งคำขอ",
  requesterName,
  extra,
  summary,
  actions,
}: {
  tag: string;
  title: React.ReactNode;
  /** ข้อมูลสั้นข้างชื่อเรื่อง เช่น โมเดลและโปรโตคอล หรือจำนวนเครื่อง */
  meta?: React.ReactNode;
  /** เวลาเข้าคิว ใช้ทั้งแสดงผลและคำนวณป้าย "ค้างมา X วัน" */
  queuedAt: string;
  /** ไม่ส่ง = ประเภทนี้ยังไม่มีหน้ารายละเอียด */
  detailHref?: string;
  description?: React.ReactNode;
  requesterLabel?: string;
  requesterName: string;
  /** ป้ายเสริมใต้บรรทัดผู้ส่งคำขอ เช่น "เจาะจงถึง" */
  extra?: React.ReactNode;
  /** ข้อมูลสรุปเฉพาะประเภท เช่น จำนวนค่าที่เปลี่ยน หรือค่าที่ขอแก้ */
  summary?: React.ReactNode;
  actions: React.ReactNode;
}) {
  const staleLabel = stalePendingLabel(queuedAt);

  return (
    // ทุกการ์ดมีขอบซ้าย 4px เท่ากัน (การ์ดปกติขอบโปร่งใส) เนื้อหาจะตรงแนวกัน
    // ทั้งคิว เดิมเฉพาะการ์ดที่ค้างมีขอบ ทำให้เนื้อหาเยื้องไปขวา 4px
    <Card
      className={`gap-3 border-l-4 ${staleLabel ? "border-l-amber-500" : "border-l-transparent"}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4 px-4">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <EntityTypeTag type={tag} />
            <span className="font-medium">{title}</span>
            {meta && (
              <span className="text-xs text-muted-foreground">{meta}</span>
            )}
            {staleLabel && <StalePendingBadge label={staleLabel} />}
          </div>
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
          <p className="text-xs text-muted-foreground">
            {requesterLabel} {requesterName} ส่งเมื่อ {formatDateTime(queuedAt)}
          </p>
          {extra}
        </div>
        {detailHref && (
          <Link
            href={detailHref}
            className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            ดูรายละเอียด →
          </Link>
        )}
      </div>

      {summary && <div className="px-4 text-xs">{summary}</div>}

      <div className="px-4">{actions}</div>
    </Card>
  );
}
