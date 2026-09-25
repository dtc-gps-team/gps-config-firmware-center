"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import {
  listDeviceConfigOverrides,
  type DeviceConfigOverride,
} from "@/lib/device-config-override-api";
import { useRefetchOnFocus } from "@/hooks/use-refetch-on-focus";

type State = {
  data: DeviceConfigOverride[] | null;
  isLoading: boolean;
  error: string | null;
};

/**
 * คิว Per-device Config Override ที่รอ Operation อนุมัติ — `GET
 * /device-config-overrides?status=pending` (issue #223, มติ 2026-09-24) ·
 * แยก hook จาก `usePendingApprovals` ตั้งใจ เพราะเป็นคนละ resource/endpoint
 * กันคนละ section ใน Approval Center (ไม่ผสมรวม list เดียวกับ Config)
 */
export function usePendingDeviceConfigOverrides() {
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
      const data = await listDeviceConfigOverrides(token, {
        status: "pending",
      });
      setState({ data, isLoading: false, error: null });
    } catch (err) {
      setState((prev) => ({
        data: prev.data,
        isLoading: false,
        error:
          err instanceof ApiError
            ? err.message
            : "โหลดคิว Device Config Override ไม่สำเร็จ",
      }));
    }
  }, [token]);

  useEffect(() => {
    void refetch();
  }, [refetch]);
  useRefetchOnFocus(refetch);

  return { ...state, refetch };
}
