"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import {
  listDeviceConfigOverrides,
  type DeviceConfigOverride,
} from "@/lib/device-config-override-api";
import { useRefetchOnFocus } from "@/hooks/use-refetch-on-focus";
import {
  PENDING_QUEUE_POLL_INTERVAL_MS,
  usePollInterval,
} from "@/hooks/use-poll-interval";

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
 *
 * `enabled` (default true) — resource นี้ grant `Read` ให้เฉพาะ Operation
 * (`backend/prisma/seed.ts`) role อื่นเรียกแล้วโดน 403 เสมอ ต้องส่ง
 * `enabled: canDecideDeviceConfigOverride(role)` จากฝั่งเรียกเพื่อข้าม fetch
 * ไปเลย ไม่ใช่ปล่อยให้ error message ดิบจาก backend หลุดไปโชว์ผู้ใช้
 */
export function usePendingDeviceConfigOverrides(enabled: boolean = true) {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const [state, setState] = useState<State>({
    data: null,
    isLoading: enabled,
    error: null,
  });

  const refetch = useCallback(async () => {
    if (!token || !enabled) return;
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
  }, [token, enabled]);

  useEffect(() => {
    if (!enabled) {
      setState({ data: null, isLoading: false, error: null });
      return;
    }
    void refetch();
  }, [refetch, enabled]);
  useRefetchOnFocus(refetch);
  usePollInterval(refetch, PENDING_QUEUE_POLL_INTERVAL_MS);

  return { ...state, refetch };
}
