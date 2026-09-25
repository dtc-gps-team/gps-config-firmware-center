"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import {
  listAllCampaignRollouts,
  listCampaigns,
  type CampaignRollout,
} from "@/lib/campaign-api";
import { useRefetchOnFocus } from "@/hooks/use-refetch-on-focus";

/** view-model ของ 1 รายการ Rollout รออนุมัติใน Approval Center — resolve
 * ชื่อกลุ่มเองจาก `GET /campaigns` (backend ไม่ embed) mirror
 * `PendingApproval` ของ Config (`use-pending-approvals.ts`) */
export type PendingCampaignRolloutApproval = {
  rollout: CampaignRollout;
  campaignName: string;
};

type State = {
  data: PendingCampaignRolloutApproval[] | null;
  isLoading: boolean;
  error: string | null;
};

/**
 * คิว Campaign Rollout ที่รอ Operation อนุมัติ —
 * `GET /campaigns/rollouts?status=pending_approval` (แก้ไข 2026-09-24 —
 * Approval Center รวม Campaign Rollout เข้ามาด้วย) · เรียงใหม่สุดก่อน
 */
export function usePendingCampaignRollouts() {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const [state, setState] = useState<State>({
    data: null,
    isLoading: true,
    error: null,
  });

  const refetch = useCallback(async () => {
    if (!token) return;
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const [rollouts, campaigns] = await Promise.all([
        listAllCampaignRollouts(token, { status: "pending_approval" }),
        listCampaigns(token),
      ]);
      const nameById = new Map(campaigns.map((c) => [c.id, c.name]));
      const data = rollouts
        .map(
          (rollout): PendingCampaignRolloutApproval => ({
            rollout,
            campaignName: nameById.get(rollout.campaignId) ?? rollout.campaignId,
          }),
        )
        .sort((a, b) =>
          b.rollout.createdAt.localeCompare(a.rollout.createdAt),
        );
      setState({ data, isLoading: false, error: null });
    } catch (err) {
      setState((prev) => ({
        data: prev.data,
        isLoading: false,
        error:
          err instanceof ApiError
            ? err.message
            : "โหลดคิว Rollout รออนุมัติไม่สำเร็จ",
      }));
    }
  }, [token]);

  useEffect(() => {
    void refetch();
  }, [refetch]);
  useRefetchOnFocus(refetch);

  return { ...state, refetch };
}
