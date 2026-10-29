"use client";

import { useMemo, useState } from "react";
import {
  ClipboardCheckIcon,
  InfoIcon,
  RocketIcon,
} from "lucide-react";

import { toast } from "sonner";

import { useAuth } from "@/components/auth/auth-provider";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FloatingActionBar } from "@/components/floating-action-bar";
import { Checkbox } from "@/components/ui/checkbox";
import { ApiError } from "@/lib/api";
import { approveConfig } from "@/lib/config-api";
import {
  canDecideConfigApproval,
  canDecideDeviceConfigOverride,
  canDecideFirmwareOverride,
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
import { ErrorState } from "@/components/error-state";
import { PageHeader } from "@/components/page-header";
import { UrlTabs } from "@/components/url-tabs";
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
  // มุมมองย่อยของหมวด Config ("ทั้งหมด"/"เจาะจงถึงฉัน") เก็บใน URL (`?view=mine`) แชร์ลิงก์ได้
  const [tab, setTabState] = useState<"all" | "mine">(() =>
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("view") === "mine"
      ? "mine"
      : "all",
  );
  function setTab(next: "all" | "mine") {
    setTabState(next);
    const params = new URLSearchParams(window.location.search);
    if (next === "mine") params.set("view", "mine");
    else params.delete("view");
    const qs = params.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${qs ? `?${qs}` : ""}`,
    );
  }
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);

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
  const notices: Record<ApprovalCategory, string | null> = {
    config: notice,
    rollout: rolloutNotice,
    "config-override": overrideNotice,
    "firmware-override": firmwareOverrideNotice,
  };

  // อนุมัติหลายรายการ: เลือกได้เฉพาะ Config ที่ไม่ใช่ของตัวเอง (Separation of Duty)
  // และเฉพาะรายการที่ยังอยู่ในคิวตอนนี้ (คิวรีเฟรชแล้วรายการที่หายไปไม่ค้างเป็นที่เลือก)
  const isOwn = (createdBy: string) => myUserId !== null && createdBy === myUserId;
  const selectableItems = items.filter((i) => !isOwn(i.createdBy));
  const selectedItems = allItems.filter((i) => selectedIds.has(i.id));

  async function approveSelected() {
    if (!session?.accessToken) return;
    const token = session.accessToken;
    const failed: string[] = [];
    let done = 0;
    for (const item of selectedItems) {
      try {
        await approveConfig(token, item.id);
        done += 1;
      } catch (err) {
        failed.push(
          `${item.name}: ${err instanceof ApiError ? err.message : "อนุมัติไม่สำเร็จ"}`,
        );
      }
    }
    setSelectedIds(new Set());
    void refetch();
    if (done > 0) {
      setNotice(`อนุมัติ ${done} รายการแล้ว`);
      toast.success(`อนุมัติ ${done} รายการแล้ว`);
    }
    if (failed.length > 0) {
      toast.error(`อนุมัติไม่สำเร็จ ${failed.length} รายการ`, {
        description: failed.join("; "),
      });
    }
  }

  // แต่ละประเภทเป็น Card แยก ไม่ผสมเป็น list เดียวกัน (คนละ resource/endpoint
  // และคนละ flow: Config, Campaign Rollout ที่ต้องมี Operation อีกคนอนุมัติ,
  // Config/Firmware Override เฉพาะเครื่องที่ ST ส่งจาก Mobile) · หมวด Override
  // gate ด้วย `canDecideOverride`/`canDecideFirmwareOv` (= Operation) ตรงกับ
  // grant Read ใน seed.ts ไม่งั้น role อื่นจะเห็น 403 ดิบจาก backend
  const sections: Record<ApprovalCategory, React.ReactNode> = {
    "config": (
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

            {canDecide && myUserId && selectableItems.length > 1 && (
              <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                <Checkbox
                  checked={
                    selectableItems.length > 0 &&
                    selectableItems.every((i) => selectedIds.has(i.id))
                  }
                  onCheckedChange={(v) =>
                    setSelectedIds(
                      v ? new Set(selectableItems.map((i) => i.id)) : new Set(),
                    )
                  }
                />
                เลือกทั้งหมดที่อนุมัติได้ ({selectableItems.length})
              </label>
            )}

            {isLoading && data === null ? (
              <CardListSkeleton />
            ) : error ? (
              <ErrorState message={error} onRetry={() => void refetch()} />
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
                  selection={
                    canDecide && myUserId
                      ? {
                          checked: selectedIds.has(item.id),
                          disabledReason: isOwn(item.createdBy)
                            ? "อนุมัติ Config ของตัวเองไม่ได้"
                            : undefined,
                          onChange: (checked) =>
                            setSelectedIds((prev) => {
                              const next = new Set(prev);
                              if (checked) next.add(item.id);
                              else next.delete(item.id);
                              return next;
                            }),
                        }
                      : undefined
                  }
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
    ),
    "rollout": (
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
              <ErrorState message={rolloutsQuery.error} onRetry={() => void rolloutsQuery.refetch()} />
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
    ),
    "config-override": (
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
              <ErrorState message={overrideError} onRetry={() => void refetchOverrides()} />
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
    ),
    "firmware-override": (
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
              <ErrorState message={firmwareOverrideError} onRetry={() => void refetchFirmwareOverrides()} />
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
    ),
  };

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

      <UrlTabs
        tabs={categories.map((c) => ({
          id: c.key,
          label: c.label,
          count: c.count ?? undefined,
          content: (
            <div className="flex flex-col gap-4">
              {notices[c.key] && (
                <div
                  role="status"
                  className="rounded-lg border border-success/30 bg-success-subtle p-3 text-sm text-success-foreground"
                >
                  {notices[c.key]}
                </div>
              )}
              {sections[c.key]}
            </div>
          ),
        }))}
      />
      <FloatingActionBar show={selectedItems.length > 0 && canDecide}>
        <span className="tabular-nums">เลือก {selectedItems.length} Config</span>
        <Button size="sm" onClick={() => setBulkOpen(true)}>
          อนุมัติที่เลือก
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
          ยกเลิกการเลือก
        </Button>
      </FloatingActionBar>
      <ConfirmDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        title={`อนุมัติ ${selectedItems.length} Config พร้อมกัน?`}
        description={
          <>
            Config ที่เลือกจะเป็นสถานะอนุมัติแล้วทั้งหมดและย้อนกลับไม่ได้
            ยังไม่ถูกส่งเข้าอุปกรณ์จนกว่าจะเริ่ม Rollout
            <span className="mt-2 block font-instrument text-xs">
              {selectedItems.map((i) => i.name).join(", ")}
            </span>
          </>
        }
        confirmLabel={`อนุมัติ ${selectedItems.length} รายการ`}
        confirmText="APPROVE"
        onConfirm={approveSelected}
      />
    </div>
  );
}
