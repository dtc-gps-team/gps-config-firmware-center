"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { usePollInterval } from "@/hooks/use-poll-interval";
import { ApiError } from "@/lib/api";
import {
  getFieldApplyProgress,
  listFieldApplyRequests,
  type FieldApplyProgress,
  type FieldApplyRequest,
} from "@/lib/field-apply-request-api";

/** ถามความคืบหน้าทุกกี่ ms ระหว่างที่คำขอยัง `sending` (ใกล้เคียงหน้าความคืบหน้าบน Mobile ที่ถามทุก 2 วินาที) */
export const APPLY_PROGRESS_POLL_MS = 3000;

/** สถานะที่ปล่อยเข้ากล่องแล้ว — มีความคืบหน้า/ประวัติรอบให้ถาม (ก่อนหน้านี้ยังไม่ปล่อย ไม่มีอะไรให้ดู) */
const RELEASED_STATUSES = new Set([
  "sending",
  "succeeded",
  "failed",
  "skipped_offline",
]);

type State = {
  request: FieldApplyRequest | null;
  progress: FieldApplyProgress | null;
  isLoading: boolean;
  error: string | null;
};

/**
 * คำขอส่ง Config/Firmware เข้ากล่อง "ล่าสุด" ของอุปกรณ์เครื่องหนึ่ง + ความคืบหน้า (รวมรอบที่ลองส่งใหม่) —
 * ใช้ที่การ์ดบนหน้ารายละเอียดอุปกรณ์ · `GET /config-apply-requests` กรองตาม `deviceId` ฝั่ง client
 * (รายการน้อยใน MVP · backend ยังไม่มี filter `deviceId`) แล้วถาม `.../progress` ของใบล่าสุด
 *
 * ระหว่างที่คำขอ `sending` ถามความคืบหน้าซ้ำทุก {@link APPLY_PROGRESS_POLL_MS} (หยุดเมื่อแท็บถูกซ่อน) พอจบแล้ว
 * โหลดรายการใหม่ครั้งเดียว · `enabled` ปิดเมื่อ role ไม่มีสิทธิ์อ่านคิว (ไม่ยิงเพื่อไม่ให้ได้ 403)
 */
export function useDeviceApplyRequest(deviceId: string, enabled: boolean) {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const [state, setState] = useState<State>({
    request: null,
    progress: null,
    isLoading: enabled,
    error: null,
  });
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  const load = useCallback(async () => {
    if (!token || !enabled) return;
    try {
      const all = await listFieldApplyRequests(token);
      const latest =
        all
          .filter((r) => r.deviceId === deviceId)
          .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))[0] ??
        null;
      const progress =
        latest && RELEASED_STATUSES.has(latest.status)
          ? await getFieldApplyProgress(token, latest.taskId, latest.id)
          : null;
      setState({ request: latest, progress, isLoading: false, error: null });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error:
          err instanceof ApiError
            ? err.message
            : "โหลดคำขอส่งเข้ากล่องไม่สำเร็จ",
      }));
    }
  }, [token, enabled, deviceId]);

  useEffect(() => {
    void load();
  }, [load]);

  // ระหว่างกำลังส่ง: ถามเฉพาะความคืบหน้า · เปลี่ยนสถานะแล้วโหลดรายการใหม่
  const pollProgress = useCallback(async () => {
    const { request, progress } = stateRef.current;
    if (!token || !enabled || !request || progress?.status !== "sending") return;
    try {
      const next = await getFieldApplyProgress(
        token,
        request.taskId,
        request.id,
      );
      if (next.status !== "sending") {
        await load();
      } else {
        setState((prev) => ({ ...prev, progress: next }));
      }
    } catch {
      // ถามพลาดรอบเดียวไม่เป็นไร รอบถัดไปลองใหม่ · ไม่ทำให้การ์ดเด้ง error
    }
  }, [token, enabled, load]);
  usePollInterval(() => void pollProgress(), APPLY_PROGRESS_POLL_MS);

  return { ...state, refetch: load };
}
