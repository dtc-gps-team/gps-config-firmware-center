"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import {
  listFieldApplyRequests,
  type FieldApplyRequest,
} from "@/lib/field-apply-request-api";
import { useRefetchOnFocus } from "@/hooks/use-refetch-on-focus";
import {
  PENDING_QUEUE_POLL_INTERVAL_MS,
  usePollInterval,
} from "@/hooks/use-poll-interval";

type State = {
  data: FieldApplyRequest[] | null;
  isLoading: boolean;
  error: string | null;
};

/**
 * คิวคำขอส่ง Config/Firmware เข้ากล่องจากหน้างานที่รอ Operation อนุมัติ —
 * `GET /config-apply-requests?status=pending` (docs/25 §3.4 · docs/30 P1) ·
 * แยก hook จาก `usePendingApprovals`/`usePendingDeviceConfigOverrides` ตั้งใจ
 * เพราะเป็นคนละ resource/endpoint กันคนละ section ใน Approval Center
 *
 * `enabled` (default true) — resource นี้ grant `Read` ให้ Operation/Auditor/
 * Admin/SuperAdmin (`backend/prisma/seed.ts`) role อื่นเรียกแล้วโดน 403 เสมอ
 * ต้องส่ง `enabled: canDecideFieldApplyRequest(role)` จากฝั่งเรียกเพื่อข้าม
 * fetch ไปเลย ไม่ใช่ปล่อยให้ error message ดิบจาก backend หลุดไปโชว์ผู้ใช้
 */
export function usePendingFieldApplyRequests(enabled: boolean = true) {
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
      const data = await listFieldApplyRequests(token, { status: "pending" });
      setState({ data, isLoading: false, error: null });
    } catch (err) {
      setState((prev) => ({
        data: prev.data,
        isLoading: false,
        error:
          err instanceof ApiError
            ? err.message
            : "โหลดคิวคำขอส่งเข้ากล่องจากหน้างานไม่สำเร็จ",
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
