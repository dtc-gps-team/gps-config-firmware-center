"use client";

import { useMemo, useState } from "react";
import { ClipboardCheckIcon, RocketIcon } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import {
  canDecideConfigApproval,
  canDecideDeviceConfigOverride,
} from "@/lib/permissions";
import { getTokenSubject } from "@/lib/jwt";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { usePendingApprovals } from "@/hooks/use-pending-approvals";
import { usePendingCampaignRollouts } from "@/hooks/use-pending-campaign-rollouts";
import { usePendingDeviceConfigOverrides } from "@/hooks/use-pending-device-config-overrides";
import { CardListSkeleton } from "@/components/skeleton/card-list-skeleton";
import { EmptyState } from "@/components/empty-state";
import { ApprovalCard } from "./approval-card";
import { CampaignRolloutApprovalCard } from "./campaign-rollout-approval-card";
import { DeviceConfigOverrideApprovalCard } from "./device-config-override-approval-card";

export function ApprovalCenterView() {
  const { session } = useAuth();
  const canDecide = canDecideConfigApproval(session?.role);
  const canDecideOverride = canDecideDeviceConfigOverride(session?.role);
  const myUserId = session?.accessToken
    ? getTokenSubject(session.accessToken)
    : null;
  const { data, isLoading, error, refetch } = usePendingApprovals();
  const rolloutsQuery = usePendingCampaignRollouts();
  const {
    data: overrideData,
    isLoading: overrideLoading,
    error: overrideError,
    refetch: refetchOverrides,
  } = usePendingDeviceConfigOverrides();
  const [notice, setNotice] = useState<string | null>(null);
  const [overrideNotice, setOverrideNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<"all" | "mine">("all");

  const allItems = useMemo(() => data ?? [], [data]);
  const mineCount = useMemo(
    () =>
      myUserId
        ? allItems.filter((i) => i.suggestedApprover?.id === myUserId).length
        : 0,
    [allItems, myUserId],
  );
  const items =
    tab === "mine" && myUserId
      ? allItems.filter((i) => i.suggestedApprover?.id === myUserId)
      : allItems;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Approval Center</h1>
        <p className="text-sm text-muted-foreground">
          Config ที่ผ่านการทดสอบแล้ว และ Campaign Rollout ที่เพิ่งเริ่ม — รอ
          Operation อนุมัติ ·{" "}
          {canDecide
            ? "คุณอนุมัติ/ปฏิเสธได้"
            : "เฉพาะ Operation ที่อนุมัติ/ปฏิเสธได้ — คุณดูได้อย่างเดียว"}{" "}
          · รวมคิว Per-device Config Override ไว้เป็นอีก section แยกด้านล่าง
          (คนละเรื่องกับ Config ทั้งชุดด้านบน — issue #223)
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            รออนุมัติ{" "}
            <span className="text-muted-foreground">({allItems.length})</span>
          </CardTitle>
          <CardDescription>
            สถานะ Config = testing (ผ่าน simulation + ConfigEngineer ปักผลผ่านแล้ว)
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {canDecide && myUserId && (
            <div className="flex gap-1 border-b pb-2 text-sm">
              <button
                type="button"
                onClick={() => setTab("all")}
                className={
                  "rounded-md px-3 py-1 " +
                  (tab === "all"
                    ? "bg-muted font-medium"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                ทั้งหมด ({allItems.length})
              </button>
              <button
                type="button"
                onClick={() => setTab("mine")}
                className={
                  "rounded-md px-3 py-1 " +
                  (tab === "mine"
                    ? "bg-muted font-medium"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                เจาะจงถึงฉัน ({mineCount})
              </button>
            </div>
          )}

          {notice && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
              {notice}
            </div>
          )}

          {isLoading && data === null ? (
            <CardListSkeleton />
          ) : error ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <p className="text-sm text-destructive">{error}</p>
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                ลองใหม่
              </Button>
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              icon={ClipboardCheckIcon}
              message={
                tab === "mine"
                  ? "ไม่มี Config ที่เจาะจงถึงคุณ"
                  : "ไม่มี Config รออนุมัติ"
              }
            />
          ) : (
            items.map((item) => (
              <ApprovalCard
                key={item.id}
                item={item}
                canDecide={canDecide}
                onDecided={(action) => {
                  setNotice(
                    action === "approve"
                      ? `อนุมัติ "${item.name}" แล้ว`
                      : `ปฏิเสธ "${item.name}" แล้ว`,
                  );
                  void refetch();
                }}
              />
            ))
          )}
        </CardContent>
      </Card>

      {/* section แยกจาก Config ชัดเจน (แก้ไข 2026-09-24 — feedback: หาปุ่ม
       * อนุมัติ Rollout ยาก) — คนละ Card ไม่ผสมเป็น list เดียวกับ Config
       * เพราะ resource/flow คนละอย่างกัน (Firmware ยังไม่รวม — อยู่หน้า
       * Firmware Repository ของตัวเองต่อไป) */}
      <Card>
        <CardHeader>
          <CardTitle>
            Campaign Rollout รออนุมัติ{" "}
            <span className="text-muted-foreground">
              ({(rolloutsQuery.data ?? []).length})
            </span>
          </CardTitle>
          <CardDescription>
            Rollout ที่เพิ่งเริ่มในกลุ่มอุปกรณ์ต่างๆ รอ Operation อีกคนอนุมัติ
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {rolloutsQuery.isLoading && rolloutsQuery.data === null ? (
            <CardListSkeleton />
          ) : rolloutsQuery.error ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <p className="text-sm text-destructive">{rolloutsQuery.error}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void rolloutsQuery.refetch()}
              >
                ลองใหม่
              </Button>
            </div>
          ) : (rolloutsQuery.data ?? []).length === 0 ? (
            <EmptyState icon={RocketIcon} message="ไม่มี Campaign Rollout รออนุมัติ" />
          ) : (
            (rolloutsQuery.data ?? []).map((item) => (
              <CampaignRolloutApprovalCard
                key={item.rollout.id}
                item={item}
                onDecided={(updated) => {
                  setNotice(
                    updated.status === "active"
                      ? `อนุมัติ Rollout ของ "${item.campaignName}" แล้ว`
                      : `ปฏิเสธ Rollout ของ "${item.campaignName}" แล้ว`,
                  );
                  void rolloutsQuery.refetch();
                }}
              />
            ))
          )}
        </CardContent>
      </Card>

      {/* section แยกจาก Config/Campaign Rollout ชัดเจนเช่นกัน (issue #223,
       * มติ 2026-09-24) — คนละ resource/endpoint กันทั้งหมด */}
      <Card>
        <CardHeader>
          <CardTitle>
            Per-device Config Override รออนุมัติ{" "}
            <span className="text-muted-foreground">
              ({overrideData?.length ?? 0})
            </span>
          </CardTitle>
          <CardDescription>
            คำขอแก้ค่าพารามิเตอร์เฉพาะเครื่อง (ST ส่งจาก Mobile) — อนุมัติแล้ว
            ยังไม่ apply เข้าอุปกรณ์อัตโนมัติ ช่างต้องกดใส่ Config เข้าเครื่อง
            อีกครั้งหลังอนุมัติ
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {overrideNotice && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
              {overrideNotice}
            </div>
          )}

          {overrideLoading && overrideData === null ? (
            <CardListSkeleton />
          ) : overrideError ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <p className="text-sm text-destructive">{overrideError}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void refetchOverrides()}
              >
                ลองใหม่
              </Button>
            </div>
          ) : (overrideData?.length ?? 0) === 0 ? (
            <EmptyState
              icon={ClipboardCheckIcon}
              message="ไม่มีคำขอ Override รออนุมัติ"
            />
          ) : (
            overrideData?.map((item) => (
              <DeviceConfigOverrideApprovalCard
                key={item.id}
                item={item}
                canDecide={canDecideOverride}
                onDecided={(action) => {
                  setOverrideNotice(
                    action === "approve"
                      ? `อนุมัติคำขอของ ${item.deviceId} แล้ว`
                      : `ปฏิเสธคำขอของ ${item.deviceId} แล้ว`,
                  );
                  void refetchOverrides();
                }}
              />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
