"use client";

import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ListIcon, PlusIcon } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { RoleGuard } from "@/components/auth/role-guard";
import {
  canAccessParameterLibrary,
  canCreateFieldDefinition,
} from "@/lib/permissions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table/data-table";
import { multiSelectFilterFn } from "@/components/data-table/filter-fns";
import { useConfigDefinitions } from "@/hooks/use-config-definitions";
import { useDeviceModels } from "@/hooks/use-device-models";
import {
  formatModelSupport,
  type ConfigFieldDefinition,
} from "@/lib/config-definition-api";
import { ParameterCreateForm } from "./parameter-create-form";
import { TableSkeleton } from "@/components/skeleton/table-skeleton";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { ParameterDetailDrawer } from "./parameter-detail-drawer";

type DefinitionsState = ReturnType<typeof useConfigDefinitions>;

const columns: ColumnDef<ConfigFieldDefinition>[] = [
  {
    accessorKey: "fieldName",
    header: "ชื่อ Field",
    meta: { filterVariant: "text", label: "ชื่อ field" },
    cell: ({ row }) => (
      <div className="flex items-center gap-2" title={row.original.description ?? undefined}>
        <span className="font-instrument text-sm">{row.original.fieldName}</span>
        {row.original.unknownSpec && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[0.7rem] text-muted-foreground">
            ยังไม่มี spec
          </span>
        )}
      </div>
    ),
  },
  {
    id: "category",
    accessorFn: (row) => row.category ?? "อื่นๆ",
    header: "หมวด",
    filterFn: multiSelectFilterFn,
    meta: { filterVariant: "multi-select", label: "หมวด" },
  },
  {
    accessorKey: "dataType",
    header: "ชนิดข้อมูล",
    filterFn: multiSelectFilterFn,
    meta: { filterVariant: "multi-select", label: "ชนิด" },
  },
  {
    id: "required",
    accessorFn: (row) => (row.required ? "บังคับ" : "ไม่บังคับ"),
    header: "บังคับกรอก",
    filterFn: multiSelectFilterFn,
    meta: { filterVariant: "multi-select", label: "บังคับกรอก" },
    cell: ({ row }) => (
      <span className={row.original.required ? undefined : "text-muted-foreground"}>
        {row.original.required ? "บังคับ" : "ไม่บังคับ"}
      </span>
    ),
  },
  {
    id: "allowedValues",
    accessorFn: (row) =>
      row.allowedValues.length ? row.allowedValues.join(", ") : "ไม่จำกัด",
    header: "ค่าที่ยอมรับ",
    enableSorting: false,
    cell: ({ row }) =>
      row.original.allowedValues.length ? (
        <span className="font-instrument text-xs">
          {row.original.allowedValues.join(", ")}
        </span>
      ) : (
        <span className="text-muted-foreground">ไม่จำกัด</span>
      ),
  },
  {
    id: "unit",
    accessorFn: (row) => row.unit ?? "",
    header: "หน่วย",
    enableSorting: false,
    enableGlobalFilter: false,
    cell: ({ row }) =>
      row.original.unit ? (
        row.original.unit
      ) : (
        <span className="text-muted-foreground">-</span>
      ),
  },
  {
    id: "stOverridable",
    accessorFn: (row) => (row.stOverridable ? "ST override ได้" : "override ไม่ได้"),
    header: "ST Override",
    filterFn: multiSelectFilterFn,
    meta: { filterVariant: "multi-select", label: "ST Override" },
    cell: ({ row }) =>
      row.original.stOverridable ? (
        <span className="rounded bg-info-subtle px-1.5 py-0.5 text-[0.7rem] font-medium text-info-foreground">
          ST override ได้
        </span>
      ) : (
        <span className="text-muted-foreground">-</span>
      ),
  },
  {
    id: "sensitive",
    accessorFn: (row) => (row.sensitive ? "Sensitive" : "ปกติ"),
    header: "Sensitive",
    filterFn: multiSelectFilterFn,
    meta: { filterVariant: "multi-select", label: "Sensitive" },
    cell: ({ row }) =>
      row.original.sensitive ? (
        <span className="rounded bg-warning-subtle px-1.5 py-0.5 text-[0.7rem] font-medium text-warning-foreground">
          Sensitive
        </span>
      ) : (
        <span className="text-muted-foreground">-</span>
      ),
  },
  {
    id: "supportedModels",
    accessorFn: (row) => formatModelSupport(row.supportedModels),
    header: "โมเดล/โปรโตคอลที่รองรับ",
    enableSorting: false,
    meta: { filterVariant: "text", label: "โมเดล/โปรโตคอล" },
    cell: ({ getValue }) => (
      <span className="text-muted-foreground">{getValue<string>()}</span>
    ),
  },
];

function ParameterTableCard({
  definitions,
  emptyAction,
}: {
  definitions: DefinitionsState;
  emptyAction?: React.ReactNode;
}) {
  const { data, isLoading, error, refetch } = definitions;
  const rows = useMemo(() => data ?? [], [data]);
  // field ที่เปิดใน drawer เก็บใน URL (`?param=NAME`) แชร์ลิงก์ตรงถึง field ได้
  const [openName, setOpenName] = useState<string | null>(() =>
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("param"),
  );
  const openDefinition = rows.find((r) => r.fieldName === openName) ?? null;

  function setOpen(name: string | null) {
    setOpenName(name);
    const params = new URLSearchParams(window.location.search);
    if (name) params.set("param", name);
    else params.delete("param");
    const qs = params.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${qs ? `?${qs}` : ""}`,
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>รายการ Parameter ทั้งหมด</CardTitle>
        <CardDescription>
          นิยาม field ที่ระบบรู้จัก ใช้อ้างอิงตอนกรอก/ตรวจ Config
          {data ? ` (${data.length} field)` : ""} คลิกแถวเพื่อดูรายละเอียด
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && data === null ? (
          <TableSkeleton columns={columns.length} />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={ListIcon}
            message="ยังไม่มี Parameter ในระบบ"
            action={emptyAction}
          />
        ) : (
          <DataTable
            columns={columns}
            data={rows}
            urlSync
            columnToggle
            initialColumnVisibility={{
              unit: false,
              stOverridable: false,
              sensitive: false,
            }}
            onRowClick={(row) => setOpen(row.fieldName)}
            searchPlaceholder="ค้นหาชื่อ field / โมเดล…"
            emptyMessage="ไม่พบ Parameter ที่ตรงกับเงื่อนไข ลองล้างตัวกรองบางตัว"
            renderCard={(row) => (
              <div className="flex flex-col gap-1">
                <span className="font-instrument text-sm font-medium break-all">
                  {row.fieldName}
                </span>
                <span className="text-xs text-muted-foreground">
                  {row.category ?? "อื่นๆ"}, {row.dataType}
                  {row.required ? ", บังคับ" : ""}
                </span>
              </div>
            )}
          />
        )}
        <ParameterDetailDrawer
          definition={openDefinition}
          onClose={() => setOpen(null)}
        />
      </CardContent>
    </Card>
  );
}

/**
 * คลัง Parameter (Config Definition Lookup, #12/#26) — ต่อ `GET
 * /config-definitions` จริง · ConfigEngineer/Operation/ST/OT เท่านั้น (gate ทั้งหน้าผ่าน
 * RoleGuard) · ฟอร์มสร้าง Parameter ใหม่ (`POST /config-definitions`) เปิด/ปิด
 * ด้วยปุ่ม — เฉพาะ Role ConfigEngineer (gate ที่ปุ่ม + PermissionGuard ฝั่ง backend)
 */
function ParameterLibraryContent() {
  const { session } = useAuth();
  const canCreate = canCreateFieldDefinition(session?.role);
  const definitions = useConfigDefinitions();
  const deviceModels = useDeviceModels();
  const [showForm, setShowForm] = useState(false);

  const existingNames = useMemo(
    () =>
      new Set(
        (definitions.data ?? []).map((d) => d.fieldName.trim().toLowerCase()),
      ),
    [definitions.data],
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Parameter Library"
        description="นิยามพารามิเตอร์ที่ใช้กรอก Config ของแต่ละโมเดล ทั้งชนิดข้อมูล ช่วงค่า และค่าเริ่มต้น"
        actions={
          canCreate && !showForm ? (
            <Button onClick={() => setShowForm(true)}>
              <PlusIcon />
              สร้าง Parameter ใหม่
            </Button>
          ) : null
        }
      />

      {canCreate && showForm ? (
        <ParameterCreateForm
          deviceModels={deviceModels.data ?? []}
          existingNames={existingNames}
          onCancel={() => setShowForm(false)}
          onCreated={async () => {
            await definitions.refetch();
            setShowForm(false);
          }}
        />
      ) : null}

      <ParameterTableCard
        definitions={definitions}
        emptyAction={
          canCreate && !showForm ? (
            <Button size="sm" onClick={() => setShowForm(true)}>
              <PlusIcon />
              สร้าง Parameter ใหม่
            </Button>
          ) : undefined
        }
      />
    </div>
  );
}

export function ParameterLibraryView() {
  return (
    <RoleGuard allow={canAccessParameterLibrary}>
      <ParameterLibraryContent />
    </RoleGuard>
  );
}
