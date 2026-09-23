"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import { listDeviceModels, type DeviceModel } from "@/lib/device-model-api";
import { useRefetchOnFocus } from "@/hooks/use-refetch-on-focus";

type DeviceModelsState = {
  data: DeviceModel[] | null;
  isLoading: boolean;
  error: string | null;
};

/**
 * โหลดทะเบียนรุ่นอุปกรณ์จาก `GET /device-models` (issue #209, docs/15) —
 * mirror `useCustomers` · ใช้แทนการ derive คู่ (deviceModel, protocol) จาก
 * Parameter ที่มีอยู่แล้วเหมือนเดิม (issue #203) — รุ่นอุปกรณ์รู้ protocol
 * ที่ตัวเองรองรับอยู่แล้วจาก `DeviceModel.supportedProtocols` ไม่ต้องเดา
 */
export function useDeviceModels() {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const [state, setState] = useState<DeviceModelsState>({
    data: null,
    isLoading: true,
    error: null,
  });

  const refetch = useCallback(async () => {
    if (!token) return;
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const data = await listDeviceModels(token);
      setState({ data, isLoading: false, error: null });
    } catch (err) {
      setState((prev) => ({
        data: prev.data,
        isLoading: false,
        error:
          err instanceof ApiError
            ? err.message
            : "โหลดทะเบียนรุ่นอุปกรณ์ไม่สำเร็จ",
      }));
    }
  }, [token]);

  useEffect(() => {
    void refetch();
  }, [refetch]);
  useRefetchOnFocus(refetch);

  return { ...state, refetch };
}
