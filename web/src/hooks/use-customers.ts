"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import { listCustomers, type CustomerSummary } from "@/lib/customer-api";
import { useRefetchOnFocus } from "@/hooks/use-refetch-on-focus";

type CustomersState = {
  data: CustomerSummary[] | null;
  isLoading: boolean;
  error: string | null;
};

/**
 * โหลดรายชื่อลูกค้าแบบย่อจาก `GET /customers` (docs/12_CustomerScope_Proposal.md
 * เฟส B, PR #127/#153) — mirror `useConfigs`
 *
 * **ยังไม่ถูกใช้ที่ไหนในรอบนี้ ("ช่วงที่ 1")** — dropdown filter "ลูกค้า" บน
 * Device Search ใช้ `getFacetedUniqueValues` ของ `DataTable` เอง (อ่านจาก
 * `Device.customer` ที่ embed มากับ `GET /devices` โดยตรง ไม่ต้องยิง endpoint
 * นี้แยก) — hook นี้เตรียมไว้สำหรับ "ช่วงที่ 2" (ปุ่ม "กำหนดลูกค้า" บน Device
 * Search) ที่ต้องเลือกลูกค้าให้อุปกรณ์ได้แม้ลูกค้านั้นยังไม่มีอุปกรณ์ผูกอยู่เลย
 * (เช่น Metro Transit ใน seed) ซึ่ง `getFacetedUniqueValues` ทำไม่ได้เพราะมัน
 * derive จากข้อมูลที่โหลดมาแล้วเท่านั้น
 */
export function useCustomers() {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const [state, setState] = useState<CustomersState>({
    data: null,
    isLoading: true,
    error: null,
  });

  const refetch = useCallback(async () => {
    if (!token) return;
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const data = await listCustomers(token);
      setState({ data, isLoading: false, error: null });
    } catch (err) {
      setState((prev) => ({
        data: prev.data,
        isLoading: false,
        error:
          err instanceof ApiError
            ? err.message
            : "โหลดรายชื่อลูกค้าไม่สำเร็จ",
      }));
    }
  }, [token]);

  useEffect(() => {
    void refetch();
  }, [refetch]);
  useRefetchOnFocus(refetch);

  return { ...state, refetch };
}
