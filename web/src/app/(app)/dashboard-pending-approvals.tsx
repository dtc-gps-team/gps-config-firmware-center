"use client";

import Link from "next/link";
import { BellIcon } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import {
  canDecideCampaignApproval,
  canDecideConfigApproval,
  canDecideDeviceConfigOverride,
  canDecideFirmwareOverride,
} from "@/lib/permissions";
import { usePendingApprovals } from "@/hooks/use-pending-approvals";
import { usePendingCampaignRollouts } from "@/hooks/use-pending-campaign-rollouts";
import { usePendingDeviceConfigOverrides } from "@/hooks/use-pending-device-config-overrides";
import { usePendingDeviceFirmwareOverrides } from "@/hooks/use-pending-device-firmware-overrides";

/**
 * แถบแจ้งเตือน "มีรายการรออนุมัติ" บน Dashboard — **ไม่ใช่ worklist เต็มรูปแบบ
 * เหมือนก่อนหน้านี้แล้ว** (แก้ครั้งที่ 69 — ลดขอบเขตลง) เดิม component นี้มี
 * ตารางรายการ + ปุ่มอนุมัติ/ปฏิเสธ inline ยืมมาจาก `ApprovalActions`/
 * `DeviceConfigOverrideApprovalActions`/`DeviceFirmwareOverrideApprovalActions`
 * ตรงๆ อ้างอิง comment เดิมว่า "ตาม mockup UX/UI Design ต้นฉบับ (UIWEB-001)"
 * — **ตรวจสอบกับ PDF ต้นฉบับ (`pdftotext`) แล้วไม่พบ "UIWEB-001" ที่ไหนในไฟล์
 * เลย และ §12.1 Dashboard ระบุไว้แค่ 5 กลุ่ม (Device Overview/Deployment
 * Overview/Risk Dashboard/Customer Priority/Capacity) ไม่มีส่วนอนุมัติอยู่
 * เลย — Approval Workflow มีสเปกแยกเป็น §13.2 ต่างหาก** comment เดิมเป็น
 * ข้อมูลที่เขียนผิดไว้ใน session ก่อนหน้า ไม่ใช่ข้อเท็จจริงจาก PDF
 *
 * Dashboard ตามสเปกจริงคือหน้าภาพรวม read-only ล้วน ฟังก์ชันนี้เลยเหลือแค่
 * "แจ้งว่ามีอะไรรออยู่ที่ Approval Center" ไม่มีปุ่มอนุมัติ/ปฏิเสธ inline ใน
 * หน้านี้อีกต่อไป (ทำงานจริงที่ `/approvals` เท่านั้น) — **ไม่แสดงอะไรเลยถ้า
 * ไม่มีรายการรอ** (ต่างจาก widget เดิมที่โชว์ empty state เสมอ) เพราะเป็นแค่
 * notification ไม่ใช่ worklist ที่ต้องยืนยันว่า "เช็คแล้วไม่มีอะไร"
 *
 * ยังคง gate ด้วย role เดิม (ทั้ง 3 ประเภทเป็นสิทธิ์ Operation เท่านั้นใน
 * ระบบนี้) กัน noise ให้ role อื่นที่อนุมัติอะไรไม่ได้เลย — least privilege
 * ฝั่ง client เดิม (#251) ยังใช้หลักการเดียวกัน
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

  return <PendingApprovalsBanner />;
}

function PendingApprovalsBanner() {
  const configs = usePendingApprovals();
  const rollouts = usePendingCampaignRollouts();
  const overrides = usePendingDeviceConfigOverrides();
  const firmwareOverrides = usePendingDeviceFirmwareOverrides();

  // ไม่แยก loading/error ต่อคิวเหมือนเดิมแล้ว (widget เดิมมี logic ซับซ้อน
  // กว่านี้มากเพราะต้องโชว์ skeleton/error ให้ worklist ที่ผู้ใช้พึ่งพาได้) —
  // ตอนนี้เป็นแค่ตัวเลขแจ้งเตือน พลาดไปบ้างระหว่างโหลด (นับ 0 ชั่วคราว) ไม่ใช่
  // ปัญหาจริง เพราะ `/approvals` คือที่ที่ทำงานจริงและมี error handling เต็ม
  // รูปแบบอยู่แล้ว
  const totalCount =
    (configs.data?.length ?? 0) +
    (rollouts.data?.length ?? 0) +
    (overrides.data?.length ?? 0) +
    (firmwareOverrides.data?.length ?? 0);

  if (totalCount === 0) {
    return null;
  }

  return (
    <Link
      href="/approvals"
      className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 transition-colors hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200 dark:hover:bg-amber-900"
    >
      <BellIcon className="size-4 shrink-0" />
      <span className="flex-1">
        มี <strong className="tabular-nums">{totalCount}</strong> รายการรออนุมัติ
      </span>
      <span className="shrink-0 underline-offset-2 hover:underline">
        ไปที่ Approval Center →
      </span>
    </Link>
  );
}
