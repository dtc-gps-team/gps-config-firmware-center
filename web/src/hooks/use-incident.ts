"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import { getIncident, type Incident } from "@/lib/incident-api";
import { useRefetchOnFocus } from "@/hooks/use-refetch-on-focus";

type State = {
  data: Incident | null;
  isLoading: boolean;
  error: string | null;
};

/**
 * โหลด Incident ตัวเดียวจาก `GET /incidents/{id}` — ใช้ตอนสร้างกลุ่มอุปกรณ์จาก
 * flow "ส่งต่อเป็น Campaign" เพื่อรู้หัวข้อและอุปกรณ์ที่รายงาน · `id` เป็น
 * null = ไม่โหลดอะไร (ไม่ได้มาจาก flow นั้น)
 */
export function useIncident(id: string | null) {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const [state, setState] = useState<State>({
    data: null,
    isLoading: id !== null,
    error: null,
  });

  const load = useCallback(async () => {
    if (!token || !id) return;
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const data = await getIncident(token, id);
      setState({ data, isLoading: false, error: null });
    } catch (err) {
      setState((prev) => ({
        data: prev.data,
        isLoading: false,
        error:
          err instanceof ApiError ? err.message : "โหลดรายงานปัญหาไม่สำเร็จ",
      }));
    }
  }, [token, id]);

  useEffect(() => {
    void load();
  }, [load]);
  useRefetchOnFocus(load);

  return { ...state, refetch: load };
}
