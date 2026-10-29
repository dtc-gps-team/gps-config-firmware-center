"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";

import { RoleGuard } from "@/components/auth/role-guard";
import { ErrorState } from "@/components/error-state";
import { PageHeader } from "@/components/page-header";
import { DetailSkeleton } from "@/components/skeleton/detail-skeleton";
import { useConfigDefinitions } from "@/hooks/use-config-definitions";
import { useDeviceModels } from "@/hooks/use-device-models";
import { canCreateFieldDefinition } from "@/lib/permissions";
import { ParameterCreateForm } from "../parameter-create-form";

/**
 * หน้าสร้าง Parameter — แยกจากหน้าคลัง (ไม่ฝังฟอร์มไว้เหนือตารางอีก) บันทึกแล้วกลับไป
 * คลังพร้อมเปิดรายละเอียดของ field ที่เพิ่งสร้าง (`?param=`) · ต้องโหลดรายการ field เดิม
 * (กันชื่อซ้ำ) และทะเบียนโมเดล (ตัวเลือกโมเดลที่รองรับ) ก่อนแสดงฟอร์ม
 */
function ParameterNewContent() {
  const router = useRouter();
  const definitions = useConfigDefinitions();
  const deviceModels = useDeviceModels();

  const existingNames = useMemo(
    () =>
      new Set((definitions.data ?? []).map((d) => d.fieldName.trim().toLowerCase())),
    [definitions.data],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="สร้าง Parameter ใหม่"
        description="กำหนดชื่อ ชนิดข้อมูล และโมเดลที่ใช้ เพื่อให้เลือกใส่ใน Config ได้"
        breadcrumb={[{ label: "สร้าง Parameter ใหม่" }]}
      />

      {definitions.error && definitions.data === null ? (
        <ErrorState
          message={definitions.error}
          onRetry={() => void definitions.refetch()}
        />
      ) : (definitions.isLoading && definitions.data === null) ||
        (deviceModels.isLoading && deviceModels.data === null) ? (
        <DetailSkeleton lines={6} />
      ) : (
        <ParameterCreateForm
          deviceModels={deviceModels.data ?? []}
          existingNames={existingNames}
          onCancel={() => router.push("/parameters")}
          onCreated={(fieldName) =>
            router.push(`/parameters?param=${encodeURIComponent(fieldName)}`)
          }
        />
      )}
    </div>
  );
}

export function ParameterNewView() {
  return (
    <RoleGuard allow={canCreateFieldDefinition}>
      <ParameterNewContent />
    </RoleGuard>
  );
}
