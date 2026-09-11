import { CampaignWizardView } from "../campaign-wizard-view";

export const metadata = {
  title: "สร้างแคมเปญใหม่ | GPS Config Center",
};

/** สร้างแคมเปญใหม่ — wizard 4 ขั้น (เลือกเป้าหมาย+มอบหมาย / เลือก Payload /
 *  Rollout / ตรวจสอบ&ยืนยัน) สร้างได้เฉพาะ Role Operation (gate ทั้งหน้าใน
 *  `CampaignWizardView`) */
export default function CampaignNewPage() {
  return <CampaignWizardView />;
}
