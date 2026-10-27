"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import {
  getDeviceHistory,
  type DeviceHistoryItem,
  type DeviceHistorySummary,
  type DeviceHistoryType,
} from "@/lib/device-history-api";

type State = {
  summary: DeviceHistorySummary | null;
  items: DeviceHistoryItem[];
  nextCursor: string | null;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
};

/**
 * ประวัติของอุปกรณ์เครื่องเดียว แบ่งหน้าแบบ cursor (`loadMore` ต่อท้ายรายการ
 * เดิม ไม่ใช่แทนที่) — ต่าง `useCampaignTargets`/`useDevices` ที่โหลดทีเดียว
 * จบเพราะข้อมูลนี้โตไม่มีขอบเขต (เครื่องที่ใช้งานมานานมีประวัติได้เรื่อยๆ)
 *
 * `DeviceHistorySheet` mount component นี้ตอนเปิด Sheet เท่านั้น (ไม่ mount
 * ค้างไว้เสมอ) จึงโหลดแบบ lazy โดยไม่ต้องมี flag `enabled` แยก — กันตารางที่
 * มีหลายเครื่อง (เช่นสมาชิก Campaign) ยิงคำขอประวัติพร้อมกันทุกแถวตั้งแต่โหลด
 * หน้า ทั้งที่ผู้ใช้อาจไม่ได้เปิดดูเลย
 *
 * `types` กรองชนิดรายการ (ไม่ส่ง/ว่าง = ทุกชนิด) — เทียบด้วยค่า string ที่
 * join แล้วเป็น dependency ของ effect ไม่ใช่ตัวแอเรย์ตรงๆ กัน re-render ของ
 * caller ที่สร้างแอเรย์ใหม่ทุกครั้ง (เช่น `types ?? []` เป็น literal) ทำให้
 * fetch ซ้ำไม่จบ
 */
export function useDeviceHistory(deviceId: string, types?: DeviceHistoryType[]) {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const typesKey = (types ?? []).join(",");
  const [state, setState] = useState<State>({
    summary: null,
    items: [],
    nextCursor: null,
    isLoading: true,
    isLoadingMore: false,
    error: null,
  });

  const loadFirstPage = useCallback(async () => {
    if (!token) return;
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const result = await getDeviceHistory(token, deviceId, {
        types: typesKey ? (typesKey.split(",") as DeviceHistoryType[]) : undefined,
      });
      setState({
        summary: result.summary,
        items: result.items,
        nextCursor: result.nextCursor,
        isLoading: false,
        isLoadingMore: false,
        error: null,
      });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: err instanceof ApiError ? err.message : "โหลดประวัติไม่สำเร็จ",
      }));
    }
     
  }, [token, deviceId, typesKey]);

  const loadMore = useCallback(async () => {
    if (!token) return;
    setState((prev) => {
      if (!prev.nextCursor || prev.isLoadingMore) return prev;
      return { ...prev, isLoadingMore: true };
    });
    try {
      const cursor = state.nextCursor;
      if (!cursor) return;
      const result = await getDeviceHistory(token, deviceId, {
        before: cursor,
        types: typesKey ? (typesKey.split(",") as DeviceHistoryType[]) : undefined,
      });
      setState((prev) => ({
        ...prev,
        items: [...prev.items, ...result.items],
        nextCursor: result.nextCursor,
        isLoadingMore: false,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        isLoadingMore: false,
        error:
          err instanceof ApiError ? err.message : "โหลดประวัติเพิ่มไม่สำเร็จ",
      }));
    }
     
  }, [token, deviceId, state.nextCursor, typesKey]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  return { ...state, refetch: loadFirstPage, loadMore };
}
