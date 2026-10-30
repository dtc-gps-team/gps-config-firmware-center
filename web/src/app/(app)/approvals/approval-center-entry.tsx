"use client";

import { useAuth } from "@/components/auth/auth-provider";
import { canDecideFirmwareApproval } from "@/lib/permissions";
import { ApprovalCenterView } from "./approval-center-view";
import { FirmwareReviewView } from "./firmware-review-view";

/**
 * Approval Center ของแต่ละ Role: QAEngineer ไม่มีสิทธิ์อ่าน Config/Campaign (seed.ts)
 * จึงเห็นเฉพาะคิว "ตรวจคุณภาพ Firmware" ที่ตัวเองตัดสินใจได้ · Role อื่นเห็นคิวเดิม
 * แยกเป็นสอง component (ไม่ใช่ซ่อนทีละส่วน) เพื่อไม่ให้ hook ของ Config/Campaign
 * ยิง API ที่ QA ไม่มีสิทธิ์
 */
export function ApprovalCenterEntry() {
  const { isReady, session } = useAuth();
  if (!isReady) return null;
  return canDecideFirmwareApproval(session?.role) ? (
    <FirmwareReviewView />
  ) : (
    <ApprovalCenterView />
  );
}
