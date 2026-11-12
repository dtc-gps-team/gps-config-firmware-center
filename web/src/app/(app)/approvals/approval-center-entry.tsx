"use client";

import { useAuth } from "@/components/auth/auth-provider";
import { RoleGuard } from "@/components/auth/role-guard";
import { canViewApprovalCenter } from "@/lib/permissions";
import { ApprovalCenterView } from "./approval-center-view";
import { FirmwareReviewView } from "./firmware-review-view";

/**
 * Approval Center ของแต่ละ Role: QAEngineer ไม่มีสิทธิ์อ่าน Config/Campaign (seed.ts)
 * จึงเห็นเฉพาะคิว "ตรวจคุณภาพ Firmware" ที่ตัวเองตัดสินใจได้ · Role อื่นเห็นคิวเดิม
 * แยกเป็นสอง component (ไม่ใช่ซ่อนทีละส่วน) เพื่อไม่ให้ hook ของ Config/Campaign
 * ยิง API ที่ QA ไม่มีสิทธิ์ · FirmwareEngineer ไม่เห็นหน้านี้เลย (403 ผ่าน `RoleGuard` แม้เข้า URL ตรง)
 *
 * เลือกหน้าด้วย role QAEngineer ตรงๆ ไม่ใช้ `canDecideFirmwareApproval` เพราะฟังก์ชันนั้น
 * รวม SuperAdmin ด้วย (PR #418) ทำให้ SuperAdmin เคยเห็นแค่คิว Firmware ตอนนี้
 * SuperAdmin ใช้ `ApprovalCenterView` ที่มีทุกหมวดรวมแท็บตรวจคุณภาพ Firmware
 */
export function ApprovalCenterEntry() {
  const { isReady, session } = useAuth();
  if (!isReady) return null;
  return (
    <RoleGuard allow={canViewApprovalCenter}>
      {session?.role === "QAEngineer" ? (
        <FirmwareReviewView />
      ) : (
        <ApprovalCenterView />
      )}
    </RoleGuard>
  );
}
