import { CampaignWizardView } from "../campaign-wizard-view";

export const metadata = {
  title: "สร้างแคมเปญใหม่ | GPS Config Center",
};

/** สร้างแคมเปญใหม่ — wizard 4 ขั้น (เลือกเป้าหมาย / เลือก Payload /
 *  Rollout / ตรวจสอบ&ยืนยัน) สร้างได้เฉพาะ Role Operation (gate ทั้งหน้าใน
 *  `CampaignWizardView`) — สถานะเริ่มต้นเป็น pending_approval รอ Operation
 *  อีกคนอนุมัติ (Campaign Approval, แก้ครั้งที่ 39) */
export default function CampaignNewPage() {
  return <CampaignWizardView />;
}
