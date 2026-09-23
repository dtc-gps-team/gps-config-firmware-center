"use client";

import { useState } from "react";
import { RefreshCwIcon, SearchXIcon, TriangleAlertIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useIncidents } from "@/hooks/use-incidents";
import { TableSkeleton } from "@/components/skeleton/table-skeleton";
import { EmptyState } from "@/components/empty-state";
import {
  INCIDENT_SEVERITY_TONE,
  INCIDENT_STATUS_TONE,
  StatusPill,
  statusLabel,
} from "@/lib/status-pill";
import type { IncidentStatus } from "@/lib/incident-api";
import { IncidentActions } from "./incident-actions";

const INCIDENT_STATUS_OPTIONS: { value: IncidentStatus; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "investigating", label: "Investigating" },
  { value: "rolled_back", label: "Rollback แล้ว" },
  { value: "resolved", label: "Resolved" },
];

/**
 * เนื้อหาจริงของหน้า Incident & Rollback — ต่อ `GET /incidents` จริงแล้ว
 * (read-only rollout, Sprint 2 — ดู RBAC_Matrix.md §2 "Incident & Rollback"
 * = R ทุก Role ไม่มี Role ไหนถูกกันออก ต่างจาก Audit Log) แยกเป็น client
 * component ต่างหากจาก page.tsx (server component ที่ export metadata)
 * mirror `audit-log-view.tsx`
 *
 * `IncidentActions` (สั่ง Rollback / แก้ไขเชิงเทคนิค) ยังเป็นปุ่ม disabled
 * scaffold อยู่ — endpoint เขียน (Update/Rollback) ยังไม่มีใน spec เลย
 * (ต่างจาก GET ที่ต่อจริงแล้วรอบนี้) ดู incident-actions.tsx
 */
export function IncidentsView() {
  const [status, setStatus] = useState<IncidentStatus | "">("");
  const { data, isLoading, error, refetch } = useIncidents({
    status: status || undefined,
  });
  const rows = data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Incident & Rollback</h1>
        <p className="text-sm text-muted-foreground">
          Operation สั่ง Rollback · ST แก้ไขเชิงเทคนิค
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            รายการ Incident{" "}
            <span className="text-muted-foreground">({rows.length})</span>
          </CardTitle>
          <CardDescription>
            สร้างอัตโนมัติจากระบบ (ตอนนี้มาจาก config-sync-writer เท่านั้น) —
            เรียงจากล่าสุด
          </CardDescription>
          <CardAction>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refetch()}
              disabled={isLoading}
            >
              <RefreshCwIcon className={isLoading ? "animate-spin" : ""} />
              รีเฟรช
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Select
            value={status}
            onValueChange={(value) =>
              setStatus((value ?? "") as IncidentStatus | "")
            }
          >
            <SelectTrigger className="h-8 max-w-48">
              <SelectValue placeholder="สถานะ: ทั้งหมด" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">สถานะ: ทั้งหมด</SelectItem>
              {INCIDENT_STATUS_OPTIONS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {isLoading && data === null ? (
            <TableSkeleton columns={5} />
          ) : error ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <p className="text-sm text-destructive">{error}</p>
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                ลองใหม่
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={status ? SearchXIcon : TriangleAlertIcon}
              message={
                status ? "ไม่พบ Incident ที่ตรงกับเงื่อนไข" : "ยังไม่มี Incident"
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>เรื่อง</TableHead>
                  <TableHead>ความรุนแรง</TableHead>
                  <TableHead>สถานะ</TableHead>
                  <TableHead>เกิดเมื่อ</TableHead>
                  <TableHead className="text-right">การดำเนินการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((incident) => (
                  <TableRow key={incident.id}>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium">{incident.title}</span>
                        {incident.description && (
                          <span className="text-xs text-muted-foreground">
                            {incident.description}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusPill tone={INCIDENT_SEVERITY_TONE[incident.severity]}>
                        {incident.severity}
                      </StatusPill>
                    </TableCell>
                    <TableCell>
                      <StatusPill tone={INCIDENT_STATUS_TONE[incident.status]}>
                        {statusLabel(incident.status)}
                      </StatusPill>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(incident.createdAt).toLocaleString("th-TH")}
                    </TableCell>
                    <TableCell className="text-right">
                      <IncidentActions />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
