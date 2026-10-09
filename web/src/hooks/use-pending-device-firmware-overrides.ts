"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import {
  listDeviceFirmwareOverrides,
  type DeviceFirmwareOverride,
} from "@/lib/device-firmware-override-api";
import { useRefetchOnFocus } from "@/hooks/use-refetch-on-focus";
import {
  PENDING_QUEUE_POLL_INTERVAL_MS,
  usePollInterval,
} from "@/hooks/use-poll-interval";

type State = {
  data: DeviceFirmwareOverride[] | null;
  isLoading: boolean;
  error: string | null;
};

/**
 * คิว Firmware Override รายเครื่องที่รอ Operation อนุมัติ — `GET
 * /device-firmware-overrides?status=pending` (Sprint 3 แถวที่ 24) mirror
 * `usePendingDeviceConfigOverrides` ทุกประการ — แยก hook ตั้งใจ เพราะเป็นคนละ
 * resource/endpoint กันคนละ section ใน Approval Center
 *
 * `enabled` (default true) — resource นี้ grant `Read` ให้เฉพาะ Operation
 * (`backend/prisma/seed.ts`) role อื่นเรียกแล้วโดน 403 เสมอ ต้องส่ง
 * `enabled: canDecideFirmwareOverride(role)` จากฝั่งเรียกเพื่อข้าม fetch
 * ไปเลย mirror `usePendingDeviceConfigOverrides` ทุกประการ
 */
export function usePendingDeviceFirmwareOverrides(enabled: boolean = true) {
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
      const data = await listDeviceFirmwareOverrides(token, {
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
            : "โหลดคิว Firmware Override ไม่สำเร็จ",
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
