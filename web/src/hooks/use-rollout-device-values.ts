"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import {
  getRolloutDeviceValues,
  type RolloutDeviceValuesItem,
} from "@/lib/campaign-api";

type State = {
  data: RolloutDeviceValuesItem[] | null;
  /** Config ที่ `data` เป็นของ — กันใช้ค่าที่ค้างจาก Config ก่อนหน้า */
  forConfigId: string | null;
  isLoading: boolean;
  error: string | null;
};

/**
 * โหลดค่าพิเศษเดิมของเครื่องในกลุ่มต่อ Config ที่เลือก
 * (`GET /campaigns/{id}/rollouts/device-values`, docs/17) — ไม่โหลดเมื่อยัง
 * ไม่ได้เลือก Config (`configId` เป็น null) · เปลี่ยน Config แล้วโหลดใหม่เอง
 */
export function useRolloutDeviceValues(
  campaignId: string,
  configId: string | null,
) {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const [state, setState] = useState<State>({
    data: null,
    forConfigId: null,
    isLoading: configId !== null,
    error: null,
  });

  const refetch = useCallback(async () => {
    if (!token || !configId) return;
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const data = await getRolloutDeviceValues(token, campaignId, configId);
      setState({ data, forConfigId: configId, isLoading: false, error: null });
    } catch (err) {
      setState({
        data: null,
        forConfigId: configId,
        isLoading: false,
        error:
          err instanceof ApiError
            ? err.message
            : "โหลดค่าพิเศษเดิมของเครื่องไม่สำเร็จ",
      });
    }
  }, [token, campaignId, configId]);

  useEffect(() => {
    // โหลดข้อมูลตาม Config ที่เลือก (setState เกิดหลัง await ใน refetch)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refetch();
  }, [refetch]);

  const current = state.forConfigId === configId;
  return {
    data: configId && current ? state.data : null,
    // ระหว่างรอผลของ Config ใหม่ (ข้อมูลยังเป็นของ Config เดิม) ถือว่ากำลังโหลด
    isLoading: configId !== null && (state.isLoading || !current),
    error: configId && current ? state.error : null,
    refetch,
  };
}
