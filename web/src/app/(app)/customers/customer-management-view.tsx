"use client";

import { useCallback, useMemo, useState } from "react";
import type { ColumnDef, Row } from "@tanstack/react-table";
import { Building2Icon, PlusIcon } from "lucide-react";

import { RoleGuard } from "@/components/auth/role-guard";
import { canManageCustomers } from "@/lib/permissions";
import { type ManagedCustomer } from "@/lib/customer-api";
import { useManagedCustomers } from "@/hooks/use-managed-customers";
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
import { CustomerForm } from "./customer-form";
import { CustomerRowActions } from "./customer-row-actions";

function thTextSort(
  a: Row<ManagedCustomer>,
  b: Row<ManagedCustomer>,
  columnId: string,
): number {
  return String(a.getValue(columnId)).localeCompare(
    String(b.getValue(columnId)),
    "th",
  );
}

/**
 * เนื้อหาจริงของหน้า Customer Management — แยกเป็น client component ต่างหากจาก page.tsx เพราะ
 * RoleGuard ต้องใช้ useAuth() · mirror `device-model-management-view.tsx` และ `user-management-view.tsx`
 *
 * ปิดช่องว่างที่ mentor ถามตอนลงทะเบียนอุปกรณ์ว่า "ถ้าจะเพิ่มลูกค้าต้องเพิ่มผ่าน db อย่างเดียวใช่ไหม"
 * (มติ A 2026-11-05) — backend อยู่ที่ PR #443
 */
export function CustomerManagementView() {
  const { data, isLoading, error, refetch } = useManagedCustomers();
  const customerList = useMemo(() => data ?? [], [data]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [justCreated, setJustCreated] = useState<ManagedCustomer | null>(null);

  const handleChanged = useCallback(() => void refetch(), [refetch]);

  const handleCreated = useCallback(
    (customer: ManagedCustomer) => {
      setDialogOpen(false);
      setJustCreated(customer);
      void refetch();
    },
    [refetch],
  );

  const columns: ColumnDef<ManagedCustomer>[] = useMemo(
    () => [
      {
        accessorKey: "companyName",
        header: "ชื่อบริษัท",
        sortingFn: thTextSort,
        meta: { filterVariant: "text", label: "ชื่อบริษัท" },
        cell: ({ row }) => (
          <span className="font-medium">{row.original.companyName}</span>
        ),
      },
      {
        accessorKey: "contactName",
        header: "ผู้ติดต่อ",
        sortingFn: thTextSort,
        cell: ({ row }) => row.original.contactName ?? "-",
      },
      {
        id: "contact",
        header: "อีเมล / โทร",
        enableSorting: false,
        accessorFn: (row) => [row.email, row.phone].filter(Boolean).join(" "),
        cell: ({ row }) => (
          <div className="flex flex-col text-sm">
            <span>{row.original.email ?? "-"}</span>
            <span className="text-muted-foreground">
              {row.original.phone ?? "-"}
            </span>
          </div>
        ),
      },
      {
        accessorKey: "priorityTier",
        header: "ระดับ",
        cell: ({ row }) => row.original.priorityTier ?? "-",
      },
      {
        accessorKey: "deviceCount",
        header: "จำนวนเครื่อง",
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.deviceCount}</span>
        ),
      },
      {
        // accessorFn คืน label ไทยตรงๆ ให้ dropdown filter แสดง "ใช้งานอยู่" / "ปิดใช้งาน" แทน
        // true/false — แบบเดียวกับหน้า User Management
        id: "isActive",
        accessorFn: (row) => (row.isActive ? "ใช้งานอยู่" : "ปิดใช้งาน"),
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
          <CustomerRowActions customer={row.original} onChanged={handleChanged} />
        ),
      },
    ],
    [handleChanged],
  );

  return (
    <RoleGuard allow={canManageCustomers}>
      <div className="flex flex-col gap-5">
        <PageHeader
          title="Customer"
          description="ทะเบียนลูกค้าสำหรับเลือกตอนลงทะเบียนอุปกรณ์ ถ้าลูกค้าเคยมีเครื่องแล้วให้ปิดใช้งานแทนการลบ"
          actions={
            <>
              <RefreshControl />
              <Button onClick={() => setDialogOpen(true)}>
                <PlusIcon />
                เพิ่มลูกค้า
              </Button>
            </>
          }
        />

        {justCreated && (
          <Notice tone="success">
            เพิ่มลูกค้า &ldquo;{justCreated.companyName}&rdquo; แล้ว
          </Notice>
        )}

        <Card>
          <CardContent>
            {isLoading && data === null ? (
              <TableSkeleton columns={columns.length} />
            ) : error ? (
              <ErrorState message={error} onRetry={() => void refetch()} />
            ) : customerList.length === 0 ? (
              <EmptyState
                icon={Building2Icon}
                message="ยังไม่มีลูกค้าในทะเบียน"
                action={
                  <Button size="sm" onClick={() => setDialogOpen(true)}>
                    <PlusIcon />
                    เพิ่มลูกค้า
                  </Button>
                }
              />
            ) : (
              <DataTable
                urlSync
                columns={columns}
                data={customerList}
                // ค่าเริ่มต้นแสดงเฉพาะลูกค้าที่ใช้งานอยู่ — ที่ปิดใช้งานต้องเปลี่ยนตัวกรอง "สถานะ" เอง
                // (แนวเดียวกับหน้า User Management)
                initialColumnFilters={[{ id: "isActive", value: ["ใช้งานอยู่"] }]}
                searchPlaceholder="ค้นหาชื่อบริษัท / ผู้ติดต่อ…"
                emptyMessage="ไม่พบลูกค้าที่ตรงกับเงื่อนไข"
              />
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="gap-0 p-0 pb-0 sm:max-w-xl sm:pb-0">
          <FormDialogHeader
            icon={Building2Icon}
            title="เพิ่มลูกค้าใหม่"
            description="ใส่ชื่อบริษัท (บังคับ) ส่วนข้อมูลติดต่อเว้นว่างได้ แก้ไขทีหลังได้"
          />
          <CustomerForm
            onSaved={handleCreated}
            onCancel={() => setDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </RoleGuard>
  );
}
