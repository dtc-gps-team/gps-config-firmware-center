"use client";

import { useCallback, useMemo } from "react";
import Link from "next/link";
import type { ColumnDef, Row } from "@tanstack/react-table";
import { UsersIcon } from "lucide-react";

import { RoleGuard } from "@/components/auth/role-guard";
import { canAccessUserManagement } from "@/lib/permissions";
import { type ManagedUser } from "@/lib/users-api";
import { useManagedUsers } from "@/hooks/use-users";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { DataTable } from "@/components/data-table/data-table";
import { multiSelectFilterFn } from "@/components/data-table/filter-fns";
import { StatusPill } from "@/lib/status-pill";
import { TableSkeleton } from "@/components/skeleton/table-skeleton";
import { EmptyState } from "@/components/empty-state";
import { UserRowActions } from "./user-row-actions";

function thTextSort(
  a: Row<ManagedUser>,
  b: Row<ManagedUser>,
  columnId: string,
): number {
  return String(a.getValue(columnId)).localeCompare(
    String(b.getValue(columnId)),
    "th",
  );
}

/**
 * เนื้อหาจริงของหน้า User / Role Management — แยกเป็น client component
 * ต่างหากจาก page.tsx (server component ที่ export metadata) เพราะ RoleGuard
 * ต้องใช้ useAuth() ซึ่งเป็น client-only hook
 *
 * จัดการได้แค่บัญชีทั่วไป ไม่รวม Admin/SuperAdmin (RBAC_Matrix.md §2 —
 * แก้ครั้งที่ 38) — `GET /users/managed` ตัด 2 role นี้ออกให้แล้วฝั่ง backend
 */
export function UserManagementView({
  justCreatedId = null,
}: {
  justCreatedId?: string | null;
}) {
  const { data, isLoading, error, refetch } = useManagedUsers();
  const userList = useMemo(() => data ?? [], [data]);

  const justCreated =
    justCreatedId != null
      ? userList.find((u) => u.id === justCreatedId) ?? null
      : null;

  const handleUpdated = useCallback(() => void refetch(), [refetch]);

  const columns: ColumnDef<ManagedUser>[] = useMemo(
    () => [
      {
        accessorKey: "username",
        header: "Username",
        sortingFn: thTextSort,
        meta: { filterVariant: "text", label: "Username" },
        cell: ({ row }) => (
          <span className="font-mono text-sm">{row.original.username}</span>
        ),
      },
      {
        accessorKey: "fullName",
        header: "ชื่อเต็ม",
        sortingFn: thTextSort,
        meta: { filterVariant: "text", label: "ชื่อเต็ม" },
      },
      {
        accessorKey: "role",
        header: "Role",
        filterFn: multiSelectFilterFn,
        meta: { filterVariant: "multi-select", label: "Role" },
      },
      {
        accessorKey: "isActive",
        header: "สถานะ",
        filterFn: multiSelectFilterFn,
        meta: { filterVariant: "multi-select", label: "สถานะ" },
        cell: ({ row }) => (
          <StatusPill tone={row.original.isActive ? "success" : "neutral"}>
            {row.original.isActive ? "ใช้งานอยู่" : "ปิดใช้งาน"}
          </StatusPill>
        ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        enableGlobalFilter: false,
        cell: ({ row }) => (
          <UserRowActions user={row.original} onUpdated={handleUpdated} />
        ),
      },
    ],
    [handleUpdated],
  );

  return (
    <RoleGuard allow={canAccessUserManagement}>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold">User / Role Management</h1>
          <p className="text-sm text-muted-foreground">
            จัดการได้แค่บัญชีทั่วไป — ไม่รวม Admin/SuperAdmin
            (RBAC_Matrix.md §2)
          </p>
        </div>

        <Card>
          {justCreated && (
            <div className="mx-6 -mb-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
              เพิ่มผู้ใช้ &ldquo;{justCreated.username}&rdquo; แล้ว — role{" "}
              <strong>{justCreated.role}</strong>
            </div>
          )}
          <CardHeader>
            <CardTitle>รายชื่อผู้ใช้</CardTitle>
            <CardDescription>บัญชีทั่วไปทั้งหมด (รวมที่ปิดใช้งาน)</CardDescription>
            <CardAction className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void refetch()}
              >
                รีเฟรช
              </Button>
              <Link href="/users/new" className={buttonVariants({ size: "sm" })}>
                + เพิ่มผู้ใช้
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent>
            {isLoading && data === null ? (
              <TableSkeleton columns={columns.length} />
            ) : error ? (
              <div className="flex flex-col items-center gap-3 py-8">
                <p className="text-sm text-destructive">{error}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void refetch()}
                >
                  ลองใหม่
                </Button>
              </div>
            ) : userList.length === 0 ? (
              <EmptyState
                icon={UsersIcon}
                message="ยังไม่มีผู้ใช้ในระบบ"
                action={
                  <Link
                    href="/users/new"
                    className={buttonVariants({ size: "sm" })}
                  >
                    + เพิ่มผู้ใช้
                  </Link>
                }
              />
            ) : (
              <DataTable
                columns={columns}
                data={userList}
                searchPlaceholder="ค้นหา username / ชื่อเต็ม…"
                emptyMessage="ไม่พบผู้ใช้ที่ตรงกับเงื่อนไข"
              />
            )}
          </CardContent>
        </Card>
      </div>
    </RoleGuard>
  );
}
