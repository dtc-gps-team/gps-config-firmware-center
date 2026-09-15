"use client";

import Link from "next/link";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { CAMPAIGN_STATUS_TONE, pillClass } from "@/lib/status-pill";
import { formatRelativeTime } from "@/lib/format-date";
import { useCampaigns } from "@/hooks/use-campaigns";

/** ตารางรายการแคมเปญ — ต่อ `GET /campaigns` จริง (Sprint 3 #21) ทุก Role
 * ที่ login แล้วดูได้ (resource `campaign` action `Read`) */
export function CampaignsTable() {
  const { data, isLoading, error, refetch } = useCampaigns();

  if (isLoading && !data) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        กำลังโหลดรายการแคมเปญ…
      </p>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          ลองใหม่
        </Button>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        ยังไม่มีแคมเปญ
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>ชื่อแคมเปญ</TableHead>
          <TableHead>จำนวนเป้าหมาย</TableHead>
          <TableHead>สถานะ</TableHead>
          <TableHead>สร้างเมื่อ</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((campaign) => (
          <TableRow key={campaign.id}>
            <TableCell className="font-medium">
              <Link
                href={`/campaigns/${campaign.id}`}
                className="hover:underline"
              >
                {campaign.name}
              </Link>
            </TableCell>
            <TableCell className="tabular-nums text-muted-foreground">
              {campaign.targetCount}
            </TableCell>
            <TableCell>
              <span className={pillClass(CAMPAIGN_STATUS_TONE[campaign.status])}>
                {campaign.status}
              </span>
            </TableCell>
            <TableCell className="text-muted-foreground">
              {formatRelativeTime(campaign.createdAt)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
