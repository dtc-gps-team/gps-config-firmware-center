"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import {
  getDeviceFirmwareOverride,
  type DeviceFirmwareOverride,
} from "@/lib/device-firmware-override-api";
import { useRefetchOnFocus } from "@/hooks/use-refetch-on-focus";

type State = {
  data: DeviceFirmwareOverride | null;
  isLoading: boolean;
  error: string | null;
};

/**
 * โหลดคำขอ Firmware Override ตัวเดียวจาก
 * `GET /device-firmware-overrides/{id}` — mirror `useDeviceConfigOverride`
 * ทุกประการ
 */
export function useDeviceFirmwareOverride(id: string) {
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
      const data = await getDeviceFirmwareOverride(token, id);
      setState({ data, isLoading: false, error: null });
    } catch (err) {
      setState((prev) => ({
        data: prev.data,
        isLoading: false,
        error: err instanceof ApiError ? err.message : "โหลดคำขอไม่สำเร็จ",
      }));
    }
  }, [token, id]);

  useEffect(() => {
    void refetch();
  }, [refetch]);
  useRefetchOnFocus(refetch);

  return { ...state, refetch };
}
