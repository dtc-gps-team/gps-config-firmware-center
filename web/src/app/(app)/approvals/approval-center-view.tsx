"use client";

import { useMemo, useState } from "react";
import {
  ClipboardCheckIcon,
  InfoIcon,
  RocketIcon,
} from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import {
  canDecideConfigApproval,
  canDecideDeviceConfigOverride,
  canDecideFirmwareOverride,
} from "@/lib/permissions";
import { getTokenSubject } from "@/lib/jwt";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { usePendingApprovals } from "@/hooks/use-pending-approvals";
import { useUserNames } from "@/hooks/use-user-names";
import { usePendingCampaignRollouts } from "@/hooks/use-pending-campaign-rollouts";
import { usePendingDeviceConfigOverrides } from "@/hooks/use-pending-device-config-overrides";
import { usePendingDeviceFirmwareOverrides } from "@/hooks/use-pending-device-firmware-overrides";
import { CardListSkeleton } from "@/components/skeleton/card-list-skeleton";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Notice } from "@/components/ui/notice";
import { ApprovalCard } from "./approval-card";
import { CampaignRolloutApprovalCard } from "./campaign-rollout-approval-card";
import { DeviceConfigOverrideApprovalCard } from "./device-config-override-approval-card";
import { DeviceFirmwareOverrideApprovalCard } from "./device-firmware-override-approval-card";

type ApprovalCategory =
  | "config"
  | "rollout"
  | "config-override"
  | "firmware-override";

export function ApprovalCenterView() {
  const { session } = useAuth();
  const canDecide = canDecideConfigApproval(session?.role);
  const canDecideOverride = canDecideDeviceConfigOverride(session?.role);
  const canDecideFirmwareOv = canDecideFirmwareOverride(session?.role);
  const myUserId = session?.accessToken
    ? getTokenSubject(session.accessToken)
    : null;
  const { data, isLoading, error, refetch } = usePendingApprovals();
  const { resolveName } = useUserNames();
  const rolloutsQuery = usePendingCampaignRollouts();
  const {
    data: overrideData,
    isLoading: overrideLoading,
    error: overrideError,
    refetch: refetchOverrides,
  } = usePendingDeviceConfigOverrides(canDecideOverride);
  const {
    data: firmwareOverrideData,
    isLoading: firmwareOverrideLoading,
    error: firmwareOverrideError,
    refetch: refetchFirmwareOverrides,
  } = usePendingDeviceFirmwareOverrides(canDecideFirmwareOv);
  const [notice, setNotice] = useState<string | null>(null);
  const [overrideNotice, setOverrideNotice] = useState<string | null>(null);
  const [firmwareOverrideNotice, setFirmwareOverrideNotice] = useState<
    string | null
  >(null);
  const [rolloutNotice, setRolloutNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<"all" | "mine">("all");
  const [picked, setPicked] = useState<ApprovalCategory>("config");

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

  // หมวดคำขอ: แสดงทีละหมวด (ไม่เลื่อนยาวผ่านทุกหมวด) · ป้ายตัวเลขข้างชื่อ
  // หมวดบอกจำนวนรอ เพื่อให้เห็นว่าหมวดไหนมีงานโดยไม่ต้องกดเข้าไปดู ·
  // หมวด Override ซ่อนสำหรับ role ที่ไม่มีสิทธิ์อ่าน (เหมือน gate เดิม)
  const categories: {
    key: ApprovalCategory;
    label: string;
    count: number | null;
  }[] = [
    {
      key: "config",
      label: "Config",
      count: data === null ? null : allItems.length,
    },
    {
      key: "rollout",
      label: "Campaign Rollout",
      count: rolloutsQuery.data === null ? null : rolloutsQuery.data.length,
    },
    ...(canDecideOverride
      ? [
          {
            key: "config-override" as const,
            label: "Config Override",
            count: overrideData?.length ?? null,
          },
        ]
      : []),
    ...(canDecideFirmwareOv
      ? [
          {
            key: "firmware-override" as const,
            label: "Firmware Override",
            count: firmwareOverrideData?.length ?? null,
          },
        ]
      : []),
  ];
  const category: ApprovalCategory = categories.some((c) => c.key === picked)
    ? picked
    : "config";
  const activeNotice = {
    config: notice,
    rollout: rolloutNotice,
    "config-override": overrideNotice,
    "firmware-override": firmwareOverrideNotice,
  }[category];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Approval Center"
        description="คำขอทุกประเภทที่รอ Operation อนุมัติ แยกเป็นส่วนตามประเภทคำขอ"
      />
      {/* คนที่ไม่ใช่ Operation เข้ามาดูได้ แต่ปุ่มอนุมัติ/ปฏิเสธจะไม่แสดง —
       * บอกครั้งเดียวตรงนี้ให้รู้ว่าทำไมไม่มีปุ่ม (ไม่ใช่ระบบพัง) */}
      {!canDecide && (
        <Notice tone="neutral">
          หน้านี้แสดงให้ดูอย่างเดียว การอนุมัติหรือปฏิเสธทำได้เฉพาะ Operation
        </Notice>
      )}

      <div
        role="group"
        aria-label="หมวดคำขอ"
        className="flex flex-wrap gap-1 border-b"
      >
        {categories.map((c) => {
          const active = c.key === category;
          return (
            <button
              key={c.key}
              type="button"
              aria-pressed={active}
              onClick={() => setPicked(c.key)}
              className={cn(
                "-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm",
                active
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {c.label}
              {c.count !== null && (
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs",
                    c.count > 0
                      ? "bg-warning-subtle text-warning-foreground"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {c.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {activeNotice && (
        <div className="rounded-lg border border-success/30 bg-success-subtle p-3 text-sm text-success-foreground">
          {activeNotice}
        </div>
      )}

      {category === "config" && (
        <Card>
          <CardHeader>
            <CardTitle>
              Config รออนุมัติ{" "}
              <span className="text-muted-foreground">({allItems.length})</span>
            </CardTitle>
            <CardDescription>
              Config ที่ทดสอบผ่านแล้ว รอ Operation อนุมัติก่อนนำไปใช้กับอุปกรณ์
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
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-label="เจาะจงถึงฉันคืออะไร"
                        className="inline-flex items-center px-1 text-muted-foreground hover:text-foreground"
                      />
                    }
                  >
                    <InfoIcon className="size-4" />
                  </TooltipTrigger>
                  <TooltipContent>
                    Config ที่ผู้สร้างเลือกให้คุณดูเป็นพิเศษ Operation
                    คนอื่นยังอนุมัติได้
                  </TooltipContent>
                </Tooltip>
              </div>
            )}

            {isLoading && data === null ? (
              <CardListSkeleton />
            ) : error ? (
              <div className="flex flex-col items-center gap-3 py-8">
                <p className="text-sm text-destructive">{error}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void refetch()}
                >
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
                  creatorName={resolveName(item.createdBy)}
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
      )}

      {/* section แยกจาก Config ชัดเจน (แก้ไข 2026-09-24 — feedback: หาปุ่ม
       * อนุมัติ Rollout ยาก) — คนละ Card ไม่ผสมเป็น list เดียวกับ Config
       * เพราะ resource/flow คนละอย่างกัน */}
      {category === "rollout" && (
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
                <p className="text-sm text-destructive">
                  {rolloutsQuery.error}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void rolloutsQuery.refetch()}
                >
                  ลองใหม่
                </Button>
              </div>
            ) : (rolloutsQuery.data ?? []).length === 0 ? (
              <EmptyState
                icon={RocketIcon}
                message="ไม่มี Campaign Rollout รออนุมัติ"
              />
            ) : (
              (rolloutsQuery.data ?? []).map((item) => (
                <CampaignRolloutApprovalCard
                  key={item.rollout.id}
                  item={item}
                  creatorName={resolveName(item.rollout.createdBy)}
                  onDecided={(updated) => {
                    setRolloutNotice(
                      updated.status === "approved"
                        ? `อนุมัติ Rollout ของ "${item.campaignName}" แล้ว ไปที่หน้ากลุ่มหรือหน้า Rollout เพื่อกดปล่อยเข้าอุปกรณ์เมื่อพร้อม`
                        : `ปฏิเสธ Rollout ของ "${item.campaignName}" แล้ว`,
                    );
                    void rolloutsQuery.refetch();
                  }}
                />
              ))
            )}
          </CardContent>
        </Card>
      )}

      {/* section แยกจาก Config/Campaign Rollout ชัดเจนเช่นกัน (issue #223,
       * มติ 2026-09-24) — คนละ resource/endpoint กันทั้งหมด · gate ด้วย
       * canDecideOverride (= role Operation เท่านั้น ตรงกับ grant Read ของ
       * resource `device-config-override` ใน seed.ts เป๊ะ) — ไม่งั้น role อื่น
       * (Admin ฯลฯ) จะเห็น raw 403 message จาก backend ตรงๆ แทนที่จะไม่เห็น
       * section นี้เลย (แก้ครั้งที่ 73 — พบจาก UX/UI audit) */}
      {category === "config-override" && (
        <Card>
          <CardHeader>
            <CardTitle>
              Config Override รออนุมัติ{" "}
              <span className="text-muted-foreground">
                ({overrideData?.length ?? 0})
              </span>
            </CardTitle>
            <CardDescription>
              คำขอแก้ค่าพารามิเตอร์เฉพาะเครื่อง (ST ส่งจาก Mobile) อนุมัติแล้ว
              ยังไม่ apply เข้าอุปกรณ์อัตโนมัติ ช่างต้องกดใส่ Config
              เข้าเครื่อง อีกครั้งหลังอนุมัติ
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
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
                message="ไม่มีคำขอ Config Override รออนุมัติ"
              />
            ) : (
              overrideData?.map((item) => (
                <DeviceConfigOverrideApprovalCard
                  key={item.id}
                  item={item}
                  requesterName={resolveName(item.overriddenBy)}
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
      )}

      {/* section แยกจากทั้ง Config/Campaign Rollout/Config Override (Sprint 3
       * แถวที่ 24) — คนละ resource/endpoint กันทั้งหมด mirror section
       * Per-device Config Override ด้านบนเป๊ะ รวมถึง gate ด้วย
       * canDecideFirmwareOv เหมือนกัน (แก้ครั้งที่ 73) */}
      {category === "firmware-override" && (
        <Card>
          <CardHeader>
            <CardTitle>
              Firmware Override รออนุมัติ{" "}
              <span className="text-muted-foreground">
                ({firmwareOverrideData?.length ?? 0})
              </span>
            </CardTitle>
            <CardDescription>
              คำขอติดตั้ง Firmware เฉพาะเครื่องที่ไม่ตรงกับ Campaign Rollout
              (ST ส่งจาก Mobile) อนุมัติแล้วปลดล็อกให้ช่างกด Confirm Install
              firmware นี้กับเครื่องนั้นได้ ไม่ได้สั่งติดตั้งอัตโนมัติ
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {firmwareOverrideLoading && firmwareOverrideData === null ? (
              <CardListSkeleton />
            ) : firmwareOverrideError ? (
              <div className="flex flex-col items-center gap-3 py-8">
                <p className="text-sm text-destructive">
                  {firmwareOverrideError}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void refetchFirmwareOverrides()}
                >
                  ลองใหม่
                </Button>
              </div>
            ) : (firmwareOverrideData?.length ?? 0) === 0 ? (
              <EmptyState
                icon={ClipboardCheckIcon}
                message="ไม่มีคำขอ Firmware Override รออนุมัติ"
              />
            ) : (
              firmwareOverrideData?.map((item) => (
                <DeviceFirmwareOverrideApprovalCard
                  key={item.id}
                  item={item}
                  requesterName={resolveName(item.overriddenBy)}
                  canDecide={canDecideFirmwareOv}
                  onDecided={(action) => {
                    setFirmwareOverrideNotice(
                      action === "approve"
                        ? `อนุมัติคำขอของ ${item.deviceId} แล้ว`
                        : `ปฏิเสธคำขอของ ${item.deviceId} แล้ว`,
                    );
                    void refetchFirmwareOverrides();
                  }}
                />
              ))
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
