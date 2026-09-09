"use client";

import Link from "next/link";

import { RoleGuard } from "@/components/auth/role-guard";
import { canCreateConfig, canUpdateConfig } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { useConfig } from "@/hooks/use-config";
import { ConfigWizard } from "./config-wizard";

/**
 * หน้า wizard สร้าง/แก้ Config (route เต็ม `/config/new`, `/config/{id}/edit`) —
 * gate ทั้งหน้าด้วย RoleGuard (SW เท่านั้น) · โหมดแก้โหลด Config เดิมมา prefill
 * ก่อน แล้วเช็คว่าสถานะ `draft` เท่านั้นที่แก้ได้ (เงื่อนไขเดียวกับ backend)
 */
export function ConfigWizardView(
  props: { mode: "create" } | { mode: "edit"; configId: string },
) {
  return (
    <RoleGuard allow={props.mode === "create" ? canCreateConfig : canUpdateConfig}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Link
            href="/config"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← กลับไปรายการ Config
          </Link>
          <h1 className="text-2xl font-semibold">
            {props.mode === "create" ? "สร้าง Config ใหม่" : "แก้ไข Config"}
          </h1>
        </div>

        {props.mode === "create" ? (
          <ConfigWizard mode={{ kind: "create" }} />
        ) : (
          <EditWizard configId={props.configId} />
        )}
      </div>
    </RoleGuard>
  );
}

function EditWizard({ configId }: { configId: string }) {
  const { data, isLoading, error, refetch } = useConfig(configId);

  if (isLoading && !data) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        กำลังโหลด Config…
      </p>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center gap-3 py-16">
        <p className="text-sm text-destructive">
          {error ?? "ไม่พบ Config นี้"}
        </p>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          ลองใหม่
        </Button>
      </div>
    );
  }

  if (data.status !== "draft") {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Config นี้อยู่สถานะ <strong>{data.status}</strong> — แก้ไขได้เฉพาะสถานะ
        draft เท่านั้น
      </div>
    );
  }

  return <ConfigWizard mode={{ kind: "edit", config: data }} />;
}
