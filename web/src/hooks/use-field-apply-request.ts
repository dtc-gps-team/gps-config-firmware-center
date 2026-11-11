"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { APPLY_PROGRESS_POLL_MS } from "@/hooks/use-device-apply-request";
import { usePollInterval } from "@/hooks/use-poll-interval";
import { useRefetchOnFocus } from "@/hooks/use-refetch-on-focus";
import { ApiError } from "@/lib/api";
import {
  getFieldApplyProgress,
  getFieldApplyRequest,
  type FieldApplyProgress,
  type FieldApplyRequest,
} from "@/lib/field-apply-request-api";

/** สถานะที่ปล่อยเข้ากล่องแล้ว มีความคืบหน้า/ประวัติรอบให้ถาม */
const RELEASED_STATUSES = new Set([
  "sending",
  "succeeded",
  "failed",
  "skipped_offline",
]);

type State = {
  data: FieldApplyRequest | null;
  progress: FieldApplyProgress | null;
  isLoading: boolean;
  error: string | null;
};

/**
 * คำขอส่งเข้ากล่อง 1 รายการสำหรับหน้ารายละเอียด (`GET /config-apply-requests/{id}`) ·
 * ปล่อยเข้ากล่องแล้วถามความคืบหน้า (รวมประวัติลองส่งใหม่) ต่อ ระหว่าง `sending`
 * ถามซ้ำทุก {@link APPLY_PROGRESS_POLL_MS} เหมือนการ์ดบนหน้ารายละเอียดอุปกรณ์ ·
 * โหลดความคืบหน้าไม่ได้ไม่ทำให้ทั้งหน้าพัง (แสดงเฉพาะข้อมูลคำขอ)
 */
export function useFieldApplyRequest(id: string) {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const [state, setState] = useState<State>({
    data: null,
    progress: null,
    isLoading: true,
    error: null,
  });
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  const loadProgress = useCallback(
    async (request: FieldApplyRequest): Promise<FieldApplyProgress | null> => {
      if (!token || !RELEASED_STATUSES.has(request.status)) return null;
      try {
        return await getFieldApplyProgress(token, request.taskId, request.id);
      } catch {
        return null;
      }
    },
    [token],
  );

  const refetch = useCallback(async () => {
    if (!token) return;
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const data = await getFieldApplyRequest(token, id);
      const progress = await loadProgress(data);
      setState({ data, progress, isLoading: false, error: null });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: err instanceof ApiError ? err.message : "โหลดคำขอไม่สำเร็จ",
      }));
    }
  }, [token, id, loadProgress]);

  useEffect(() => {
    void refetch();
  }, [refetch]);
  useRefetchOnFocus(refetch);

  const pollProgress = useCallback(async () => {
    const { data, progress } = stateRef.current;
    if (!token || !data || progress?.status !== "sending") return;
    const next = await loadProgress(data);
    if (!next) return;
    if (next.status !== "sending") {
      await refetch();
    } else {
      setState((prev) => ({ ...prev, progress: next }));
    }
  }, [token, loadProgress, refetch]);
  usePollInterval(() => void pollProgress(), APPLY_PROGRESS_POLL_MS);

  return { ...state, refetch };
}
