"use client";

import Link from "next/link";
import { ExternalLinkIcon, ServerCrashIcon } from "lucide-react";

import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import type { Incident } from "@/lib/incident-api";
import {
  failedDeviceSample,
  incidentImpact,
  incidentRolloutHref,
  incidentSampleErrors,
} from "@/lib/incident-display";

/**
 * ผลกระทบของ Incident จาก Rollout ในหน้ารายละเอียด: จำนวนเครื่อง รายการ
 * เครื่องที่ล้มเหลว (backend เก็บรหัสไว้สูงสุด 20 เครื่อง) ข้อผิดพลาดตัวอย่าง
 * และลิงก์ไปหน้า Rollout ต้นทาง · ไม่ใช่ Incident จาก Rollout (หรือไม่มี
 * ข้อมูลเลย) ไม่แสดงการ์ดนี้
 */
export function RolloutImpactCard({ incident }: { incident: Incident }) {
  const impact = incidentImpact(incident);
  const sample = failedDeviceSample(incident);
  const errors = incidentSampleErrors(incident);
  const href = incidentRolloutHref(incident);

  if (!impact && !sample && errors.length === 0 && !href) return null;

  return (
    <Card className="p-4" aria-label="ผลกระทบ">
      <h2 className="mb-2 flex items-center gap-1.5 text-sm font-medium">
        <ServerCrashIcon className="size-4" />
        ผลกระทบ
      </h2>

      {impact && (
        <div className="flex flex-col gap-0.5 text-sm">
          <span>{impact.summary}</span>
          {impact.detail && (
            <span className="text-muted-foreground">{impact.detail}</span>
          )}
        </div>
      )}

      {sample && (
        <div className="mt-3 border-t pt-3">
          <p className="mb-1.5 text-xs text-muted-foreground">
            เครื่องที่ล้มเหลว
          </p>
          <ul className="flex flex-wrap gap-x-3 gap-y-1">
            {sample.shown.map((deviceId) => (
              <li key={deviceId}>
                <Link
                  href={`/devices/${encodeURIComponent(deviceId)}`}
                  className="font-instrument text-sm underline-offset-2 hover:underline"
                >
                  {deviceId}
                </Link>
              </li>
            ))}
          </ul>
          {sample.remaining > 0 && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              และอีก {sample.remaining} เครื่อง (ดูรายชื่อทั้งหมดที่หน้า Rollout)
            </p>
          )}
        </div>
      )}

      {errors.length > 0 && (
        <div className="mt-3 border-t pt-3">
          <p className="mb-1.5 text-xs text-muted-foreground">
            ข้อผิดพลาดตัวอย่าง
          </p>
          <ul className="flex flex-col gap-1">
            {errors.map((message, i) => (
              <li key={i} className="font-instrument text-xs">
                {message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {href && (
        <div className="mt-3 border-t pt-3">
          <Link
            href={href}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <ExternalLinkIcon />
            ดู Rollout ต้นทาง
          </Link>
        </div>
      )}
    </Card>
  );
}
