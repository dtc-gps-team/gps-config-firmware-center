import { ApprovalCenterView } from "./approval-center-view";

export const metadata = {
  title: "Approval Center | GPS Config Center",
};

/**
 * Approval Center — คิว Config สถานะ `testing` (ผ่าน simulation + SW ปักผ่าน)
 * รอ Operation อนุมัติ/ปฏิเสธ · ทุก Role ดูคิวได้ (RBAC_Matrix.md §2) แต่
 * อนุมัติ/ปฏิเสธได้เฉพาะ Operation (Separation of Duty — SW อนุมัติของตัวเองไม่ได้)
 *
 * รอบนี้รองรับเฉพาะ Config · Firmware / Campaign approval (ตาม mockup) เป็น
 * เฟสถัดไป — ดู docs/13 proposal
 */
export default function ApprovalsPage() {
  return <ApprovalCenterView />;
}
