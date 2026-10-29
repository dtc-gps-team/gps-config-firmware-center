import { RoleGuard } from "@/components/auth/role-guard";
import { canReadFirmware } from "@/lib/permissions";
import { FirmwareTableCard } from "./firmware-table";

export const metadata = {
  title: "Firmware Repository | GPS Config Center",
};

/**
 * Firmware Repository — list Firmware จาก `GET /firmware` จริง + คลิกแถวไป
 * หน้ารายละเอียดเต็ม `/firmware/{id}` (แก้ Compatibility Tag + ทดสอบ) · ปุ่ม
 * "อัปโหลด Firmware" เป็น Dialog ในตัว (แก้ครั้งที่ 71 — ไม่มี route
 * `/firmware/upload` แยกอีกต่อไป) — อัปโหลด/แก้ Compatibility Tag ได้เฉพาะ
 * Role FirmwareEngineer, ทดสอบได้
 * FirmwareEngineer/QAEngineer/Operation/ST/OT, อ่านได้ทุก Role ยกเว้น ConfigEngineer
 * (ซ่อนเมนูและปิดหน้านี้ — RBAC_Matrix.md Section 2)
 */
export default function FirmwarePage() {
  return (
    <RoleGuard allow={canReadFirmware}>
      <FirmwareTableCard
        title="Firmware Repository"
        description="เก็บ Firmware แต่ละเวอร์ชัน ระบุโมเดลที่ใช้ได้ และส่งให้ QA ตรวจก่อนนำไปติดตั้ง คลิกแถวเพื่อดูรายละเอียด"
      />
    </RoleGuard>
  );
}
