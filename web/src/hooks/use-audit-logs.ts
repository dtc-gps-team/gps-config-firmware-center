"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { listAuditLogs } from "@/lib/audit-api";
import { ApiError } from "@/lib/api";

/**
 * View-model ของ 1 แถวในหน้า Audit Log — ตอนนี้ `actorName` = `userId` ดิบ
 * (backend คืนมาแค่ `userId` ไม่ join ชื่อมาให้) ยังไม่มี endpoint list user
 * แบบย่อในสาขานี้ให้ resolve ชื่อ (ดู Approval Center #19 — `GET /users`) ·
 * วันที่ endpoint นั้น merge ค่อยต่อ join ชื่อแบบเดียวกับ
 * `use-pending-approvals.ts` (`suggestedApprover`) — เปลี่ยนแค่ไฟล์นี้ไฟล์
 * เดียว component ไม่ต้องแตะ
 */
export type AuditLogRow = {
  id: string;
  actorId: string;
  actorName: string;
  auditModule: string;
  action: string;
  createdAt: string;
};

type State = {
  data: AuditLogRow[] | null;
  isLoading: boolean;
  error: string | null;
};

/**
 * `GET /audit-logs` (Sprint 3 #27) — เรียง createdAt desc มาจาก backend
 * อยู่แล้ว
 */
export function useAuditLogs() {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const [state, setState] = useState<State>({
    data: null,
    isLoading: true,
    error: null,
  });

  const refetch = useCallback(async () => {
    if (!token) return;
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const logs = await listAuditLogs(token);
      const data = logs.map(
        (log): AuditLogRow => ({
          id: log.id,
          actorId: log.userId,
          actorName: log.userId,
          auditModule: log.auditModule,
          action: log.action,
          createdAt: log.createdAt,
        }),
      );
      setState({ data, isLoading: false, error: null });
    } catch (err) {
      setState((prev) => ({
        data: prev.data,
        isLoading: false,
        error:
          err instanceof ApiError ? err.message : "โหลด Audit Log ไม่สำเร็จ",
      }));
    }
  }, [token]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { ...state, refetch };
}
