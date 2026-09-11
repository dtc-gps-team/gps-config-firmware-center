"use client";

import Link from "next/link";

import { Button, buttonVariants } from "@/components/ui/button";
import { CAMPAIGN_STATUS_TONE, pillClass } from "@/lib/status-pill";
import { formatDateTime } from "@/lib/format-date";
import { useCampaign } from "@/hooks/use-campaign";
import { useConfig } from "@/hooks/use-config";

function InfoRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right break-words">{children}</span>
    </div>
  );
}

/**
 * รายละเอียดแคมเปญ 1 รายการ — ต่อ `GET /campaigns/{id}` จริง (Sprint 3 #21)
 *
 * ยังไม่แสดงรายชื่ออุปกรณ์เป้าหมาย/Task ที่สร้างไว้ (backend ยังไม่ embed —
 * ตั้งใจรอ Campaign Monitor #22 ที่จะโชว์ผล per-target พร้อม failure rate)
 * · `successCount`/`failureCount` ยังไม่มี logic อัปเดตตอนนี้ (0 เสมอ) เหมือน
 * ที่ระบุไว้ใน openapi.yaml
 */
export function CampaignDetailView({ campaignId }: { campaignId: string }) {
  const { data, isLoading, error, refetch } = useCampaign(campaignId);
  // resolve ชื่อ Config เอง (backend ไม่ embed) — pattern เดียวกับที่
  // config-review-panel resolve ชื่อผู้อนุมัติเอง
  const configQuery = useConfig(data?.configId ?? null);

  if (isLoading && !data) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        กำลังโหลดแคมเปญ…
      </p>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center gap-3 py-16">
        <p className="text-sm text-destructive">{error ?? "ไม่พบแคมเปญนี้"}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            ลองใหม่
          </Button>
          <Link
            href="/campaigns"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            กลับไปรายการ
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/campaigns"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← กลับไปรายการแคมเปญ
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{data.name}</h1>
          <span className={pillClass(CAMPAIGN_STATUS_TONE[data.status])}>
            {data.status}
          </span>
        </div>
        {data.description && (
          <p className="text-sm text-muted-foreground">{data.description}</p>
        )}
      </div>

      <div className="max-w-xl rounded-xl border bg-card p-5">
        <InfoRow label="Payload">
          {data.payloadType === "Config"
            ? (configQuery.data?.name ?? data.configId ?? "—")
            : (data.firmwareId ?? "—")}
        </InfoRow>
        <InfoRow label="จำนวนเป้าหมาย">{data.targetCount}</InfoRow>
        <InfoRow label="สำเร็จ / ล้มเหลว">
          {data.successCount} / {data.failureCount}{" "}
          <span className="text-xs text-muted-foreground">
            (ยังไม่มีระบบอัปเดตค่านี้ — รอ Campaign Monitor)
          </span>
        </InfoRow>
        <InfoRow label="สร้างเมื่อ">{formatDateTime(data.createdAt)}</InfoRow>
        <InfoRow label="แก้ไขล่าสุด">{formatDateTime(data.updatedAt)}</InfoRow>
      </div>
    </div>
  );
}
