"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import { listUsers, type UserSummary } from "@/lib/users-api";

type FieldTechniciansState = {
  data: UserSummary[] | null;
  isLoading: boolean;
  error: string | null;
};

/**
 * รายชื่อช่างหน้างาน (role ST/OT ที่ active) — ใช้ทำ dropdown "มอบหมาย
 * ผู้รับผิดชอบหน้างาน" ใน Campaign Wizard (#21) · `listUsers` filter ได้แค่
 * role เดียว ต่อ query จึงเรียกไม่กรอง role แล้วกรอง ST/OT ฝั่ง client แทน
 * (ประหยัดกว่ายิง 2 request)
 */
export function useFieldTechnicians() {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const [state, setState] = useState<FieldTechniciansState>({
    data: null,
    isLoading: true,
    error: null,
  });

  const refetch = useCallback(async () => {
    if (!token) return;
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const users = await listUsers(token);
      const technicians = users.filter(
        (u) => u.role === "ST" || u.role === "OT",
      );
      setState({ data: technicians, isLoading: false, error: null });
    } catch (err) {
      setState((prev) => ({
        data: prev.data,
        isLoading: false,
        error:
          err instanceof ApiError
            ? err.message
            : "โหลดรายชื่อช่างหน้างานไม่สำเร็จ",
      }));
    }
  }, [token]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { ...state, refetch };
}
