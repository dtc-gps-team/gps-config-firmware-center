import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CreateCampaignButton } from "./create-campaign-button";
import { DemoNote } from "@/components/demo/demo-note";
import {
  DEMO_CAMPAIGNS,
  CAMPAIGN_STATUS_TONE,
  pillClass,
} from "@/lib/demo-data";

export const metadata = {
  title: "Campaign | GPS Config Center",
};

/**
 * Scaffold — รอต่อโมดูล `campaign` (ยังไม่มี endpoint ใน spec — ดู
 * RBAC_Matrix.md ตาราง 4.2) รวม Campaign Wizard (สร้าง) + Campaign Monitor
 * (ติดตาม Failure Rate) ไว้หน้าเดียวก่อน
 */
export default function CampaignsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Campaign</h1>
          <p className="text-sm text-muted-foreground">
            สร้าง/ติดตามแคมเปญ — สร้างได้เฉพาะ Role Operation
          </p>
        </div>
        <CreateCampaignButton />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>รายการแคมเปญ</CardTitle>
          <CardDescription>ทุก Role ที่ login แล้วดูได้</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <DemoNote endpoint="GET /campaigns (ยังไม่มีใน spec)" />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ชื่อแคมเปญ</TableHead>
                <TableHead>Config/Firmware เป้าหมาย</TableHead>
                <TableHead>Failure Rate</TableHead>
                <TableHead>สถานะ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {DEMO_CAMPAIGNS.map((campaign) => (
                <TableRow key={campaign.name}>
                  <TableCell className="font-medium">{campaign.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {campaign.target}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {campaign.failureRate}
                  </TableCell>
                  <TableCell>
                    <span
                      className={pillClass(
                        CAMPAIGN_STATUS_TONE[campaign.status],
                      )}
                    >
                      {campaign.status}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
