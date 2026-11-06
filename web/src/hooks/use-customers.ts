"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import { listCustomers, type CustomerListItem } from "@/lib/customer-api";
import { useRefetchOnFocus } from "@/hooks/use-refetch-on-focus";

type CustomersState = {
  data: CustomerListItem[] | null;
  isLoading: boolean;
  error: string | null;
};

/**
 * โหลดรายชื่อลูกค้าแบบย่อจาก `GET /customers` (docs/12_CustomerScope_Proposal.md
 * เฟส B, PR #127/#153) — mirror `useConfigs`
 *
 * ใช้เลือกลูกค้าตอนลงทะเบียนอุปกรณ์ (`activeOnly` ตัดลูกค้าที่ปิดใช้งานออก) — dropdown filter
 * "ลูกค้า" บน Device Search ใช้ `getFacetedUniqueValues` ของ `DataTable` เอง (อ่านจาก
 * `Device.customer` ที่ embed มากับ `GET /devices`) ซึ่งเห็นเฉพาะลูกค้าที่มีเครื่องผูกอยู่แล้ว
 */
export function useCustomers(options?: { activeOnly?: boolean }) {
  const activeOnly = options?.activeOnly ?? false;
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
      const data = await listCustomers(token, { activeOnly });
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
  }, [token, activeOnly]);

  useEffect(() => {
    void refetch();
  }, [refetch]);
  useRefetchOnFocus(refetch);

  return { ...state, refetch };
}
