import { CampaignCreateView } from "../campaign-create-view";

export const metadata = {
  title: "สร้างกลุ่มอุปกรณ์ใหม่ | GPS Config Center",
};

/** สร้างกลุ่มอุปกรณ์ใหม่ — ชื่อ+สมาชิกเท่านั้น สร้างได้เฉพาะ Role Operation
 *  (gate ทั้งหน้าใน `CampaignCreateView`) — เลือก Config/Firmware มา push
 *  เข้ากลุ่มทำทีหลังผ่าน "Roll out ใหม่" ในหน้ารายละเอียดกลุ่ม (Campaign
 *  Monitor #22, แก้ไข 2026-09-24) */
export default function CampaignNewPage() {
  return <CampaignCreateView />;
}
