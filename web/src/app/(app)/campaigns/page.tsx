import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CreateCampaignButton } from "./create-campaign-button";
import { CampaignsTable } from "./campaigns-table";

export const metadata = {
  title: "Campaign | GPS Config Center",
};

/**
 * รายการแคมเปญ — ต่อ `GET /campaigns` จริงแล้ว (Sprint 3 #21) · ปุ่มสร้างพา
 * ไป Campaign Wizard (`/campaigns/new`, Operation เท่านั้น) · Campaign
 * Monitor (ติดตาม Failure Rate จริง จาก successCount/failureCount) ยังไม่ทำ
 * ในรอบนี้ — รอ Sprint 3 #22
 */
export default function CampaignsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Campaign</h1>
          <p className="text-sm text-muted-foreground">
            สร้าง/ติดตามแคมเปญ · สร้างได้เฉพาะ Role Operation
          </p>
        </div>
        <CreateCampaignButton />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>รายการแคมเปญ</CardTitle>
          <CardDescription>ทุก Role ที่ login แล้วดูได้</CardDescription>
        </CardHeader>
        <CardContent>
          <CampaignsTable />
        </CardContent>
      </Card>
    </div>
  );
}
