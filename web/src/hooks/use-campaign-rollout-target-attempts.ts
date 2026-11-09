"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import {
  listCampaignRolloutTargetAttempts,
  type CampaignRolloutTargetAttempt,
} from "@/lib/campaign-api";

/** โหลดประวัติรายรอบของเครื่องหนึ่งเมื่อ `enabled` (กางแถว) · `refreshKey` เปลี่ยน = โหลดใหม่
 * (ผลต่อเครื่องรีเฟรชทุก 5 วินาทีอยู่แล้ว จึงโหลดประวัติใหม่ตามเมื่อสถานะเครื่องขยับ) */
export function useCampaignRolloutTargetAttempts(
  campaignId: string,
  rolloutId: string,
  targetId: string,
  enabled: boolean,
  refreshKey: string,
) {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const [data, setData] = useState<CampaignRolloutTargetAttempt[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setData(
        await listCampaignRolloutTargetAttempts(
          token,
          campaignId,
          rolloutId,
          targetId,
        ),
      );
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "โหลดประวัติการส่งไม่สำเร็จ",
      );
    }
  }, [token, campaignId, rolloutId, targetId]);

  useEffect(() => {
    if (!enabled) return;
    // โหลดจาก API แล้ว setState ใน callback (ไม่ใช่ใน effect โดยตรง) pattern เดียวกับ hook ข้างเคียง
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [enabled, load, refreshKey]);

  return { data, error, isLoading: enabled && data === null && error === null };
}
