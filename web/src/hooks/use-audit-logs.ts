"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { listAuditLogs } from "@/lib/audit-api";
import { listUsers } from "@/lib/users-api";
import { ApiError } from "@/lib/api";
import { useRefetchOnFocus } from "@/hooks/use-refetch-on-focus";

/**
 * View-model ของ 1 แถวในหน้า Audit Log — `actorName` resolve จาก `GET /users`
 * (ไม่ join ชื่อจาก backend — mirror `use-pending-approvals.ts`
 * `suggestedApprover`) fallback เป็น `userId` ดิบถ้าหา user ไม่เจอ (บัญชีถูกลบไป
 * แล้ว) หรือถ้า `GET /users` ล่ม (พังไม่ block ตาราง audit log)
 */
export type AuditLogRow = {
  id: string;
  actorId: string;
  actorName: string;
  auditModule: string;
  action: string;
  ipAddress: string | null;
  createdAt: string;
};

export type AuditLogFilters = {
  auditModule?: string;
  action?: string;
};

type State = {
  data: AuditLogRow[] | null;
  isLoading: boolean;
  error: string | null;
};

/**
 * `GET /audit-logs` (Sprint 3 #27) — เรียง createdAt desc มาจาก backend
 * อยู่แล้ว · filter (auditModule/action) ส่งตรงไป backend ผ่าน query params
 */
export function useAuditLogs(filters: AuditLogFilters = {}) {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const { auditModule, action } = filters;
  const [state, setState] = useState<State>({
    data: null,
    isLoading: true,
    error: null,
  });

  const refetch = useCallback(async () => {
    if (!token) return;
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const [logs, users] = await Promise.all([
        listAuditLogs(token, { auditModule, action }),
        // resolve ชื่อผู้ทำรายการ — พังไม่ block ตาราง audit log (fallback
        // เป็น userId ดิบด้านล่าง)
        listUsers(token).catch(() => []),
      ]);
      const nameById = new Map(users.map((u) => [u.id, u.fullName]));
      const data = logs.map(
        (log): AuditLogRow => ({
          id: log.id,
          actorId: log.userId,
          actorName: nameById.get(log.userId) ?? log.userId,
          auditModule: log.auditModule,
          action: log.action,
          ipAddress: log.ipAddress,
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
  }, [token, auditModule, action]);

  useEffect(() => {
    void refetch();
  }, [refetch]);
  useRefetchOnFocus(refetch);

  return { ...state, refetch };
}
