import { ApprovalCenterView } from "./approval-center-view";

export const metadata = {
  title: "Approval Center | GPS Config Center",
};

/**
 * Approval Center — คิว Config สถานะ `testing` (ผ่าน simulation + ConfigEngineer ปักผ่าน)
 * รอ Operation อนุมัติ/ปฏิเสธ · ทุก Role ดูคิวได้ (RBAC_Matrix.md §2) แต่
 * อนุมัติ/ปฏิเสธได้เฉพาะ Operation (Separation of Duty — ConfigEngineer อนุมัติของตัวเองไม่ได้)
 *
 * **แก้ไข 2026-09-24:** เพิ่ม Campaign Rollout เข้ามาแล้ว (คนละ section ใน
 * หน้าเดียวกัน ไม่ผสมกับ Config — เดิมหาปุ่มอนุมัติ Rollout ยาก ต้องคลิกลึก
 * เข้าไปในหน้ากลุ่ม) ตามที่ mockup เดิมตั้งใจไว้ตั้งแต่แรก · Firmware ยังไม่
 * รวม (คงอยู่หน้า Firmware Repository ของตัวเองต่อไป) — ดู docs/13 proposal
 */
export default function ApprovalsPage() {
  return <ApprovalCenterView />;
}
