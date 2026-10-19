import { CampaignsTableCard } from "./campaigns-table";

export const metadata = {
  title: "Campaign | GPS Config Center",
};

/**
 * รายการแคมเปญ (กลุ่มอุปกรณ์) — ต่อ `GET /campaigns` จริง · ปุ่มสร้างพาไปหน้า
 * สร้างกลุ่ม (`/campaigns/new`, Operation เท่านั้น) — แก้ไข 2026-09-24
 * (Campaign Monitor #22): กลุ่มหนึ่ง push Config/Firmware เข้าได้หลายรอบผ่าน
 * "Roll out ใหม่" ในหน้ารายละเอียดกลุ่ม แต่ละรอบมี Failure Rate จริงต่อเครื่อง
 */
export default function CampaignsPage() {
  return (
    <CampaignsTableCard
      title="Campaign"
      description="จัดกลุ่มอุปกรณ์ แล้วปล่อย Config หรือ Firmware เป็นรอบ พร้อมติดตามผลรายเครื่อง"
    />
  );
}
