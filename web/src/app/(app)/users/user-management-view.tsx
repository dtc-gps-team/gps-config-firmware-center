"use client";

import { useCallback, useMemo, useState } from "react";
import type { ColumnDef, Row } from "@tanstack/react-table";
import { UserPlusIcon, UsersIcon, PlusIcon } from "lucide-react";

import { RoleGuard } from "@/components/auth/role-guard";
import { canAccessUserManagement } from "@/lib/permissions";
import { type ManagedUser } from "@/lib/users-api";
import { useManagedUsers } from "@/hooks/use-users";
import { FormDialogHeader } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DataTable } from "@/components/data-table/data-table";
import { multiSelectFilterFn } from "@/components/data-table/filter-fns";
import { StatusPill } from "@/lib/status-pill";
import { TableSkeleton } from "@/components/skeleton/table-skeleton";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { RefreshControl } from "@/components/refresh-control";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { Notice } from "@/components/ui/notice";
import { UserRowActions } from "./user-row-actions";
import { CreateUserForm } from "./create-user-form";

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
export function UserManagementView() {
  const { data, isLoading, error, refetch } = useManagedUsers();
  const userList = useMemo(() => data ?? [], [data]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [justCreated, setJustCreated] = useState<ManagedUser | null>(null);

  const handleUpdated = useCallback(() => void refetch(), [refetch]);

  const handleCreated = useCallback(
    (user: ManagedUser) => {
      setDialogOpen(false);
      setJustCreated(user);
      void refetch();
    },
    [refetch],
  );

  const columns: ColumnDef<ManagedUser>[] = useMemo(
    () => [
      {
        accessorKey: "username",
        header: "Username",
        sortingFn: thTextSort,
        meta: { filterVariant: "text", label: "Username" },
        cell: ({ row }) => (
          <span className="font-instrument text-sm">
            {row.original.username}
          </span>
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
      <div className="flex flex-col gap-5">
        <PageHeader
          title="User Management"
          description="จัดการบัญชีผู้ใช้ทั่วไป กำหนด Role และเปิดหรือปิดการใช้งาน บัญชี Admin และ SuperAdmin ไม่อยู่ในรายการนี้"
          actions={
            <>
              <RefreshControl />
              <Button onClick={() => setDialogOpen(true)}>
                <PlusIcon />
                เพิ่มผู้ใช้
              </Button>
            </>
          }
        />

        {justCreated && (
          <Notice tone="success">
            เพิ่มผู้ใช้ &ldquo;{justCreated.username}&rdquo; แล้ว role{" "}
            <strong>{justCreated.role}</strong>
          </Notice>
        )}

        <Card>
          <CardContent>
            {isLoading && data === null ? (
              <TableSkeleton columns={columns.length} />
            ) : error ? (
              <ErrorState message={error} onRetry={() => void refetch()} />
            ) : userList.length === 0 ? (
              <EmptyState
                icon={UsersIcon}
                message="ยังไม่มีผู้ใช้ในระบบ"
                action={
                  <Button size="sm" onClick={() => setDialogOpen(true)}>
                    <PlusIcon />
                    เพิ่มผู้ใช้
                  </Button>
                }
              />
            ) : (
              <DataTable
                urlSync
                columns={columns}
                data={userList}
                searchPlaceholder="ค้นหา username / ชื่อเต็ม…"
                emptyMessage="ไม่พบผู้ใช้ที่ตรงกับเงื่อนไข"
              />
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="gap-0 p-0 pb-0 sm:max-w-xl sm:pb-0">
          <FormDialogHeader
            icon={UserPlusIcon}
            title="เพิ่มผู้ใช้ใหม่"
            description="เฉพาะ Role Admin เลือก role ได้แค่บัญชีทั่วไป (ไม่รวม Admin/SuperAdmin) และตั้งรหัสผ่านเริ่มต้นให้ผู้ใช้เองที่นี่"
          />
          <CreateUserForm
            onCreated={handleCreated}
            onCancel={() => setDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </RoleGuard>
  );
}
