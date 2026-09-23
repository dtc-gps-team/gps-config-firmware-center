"use client";

import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ListIcon } from "lucide-react";

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

type DefinitionsState = ReturnType<typeof useConfigDefinitions>;

const columns: ColumnDef<ConfigFieldDefinition>[] = [
  {
    accessorKey: "fieldName",
    header: "ชื่อ Field",
    meta: { filterVariant: "text", label: "ชื่อ field" },
    cell: ({ row }) => (
      <div className="flex items-center gap-2" title={row.original.description ?? undefined}>
        <span className="font-mono text-sm">{row.original.fieldName}</span>
        {row.original.unknownSpec && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[0.7rem] text-muted-foreground">
            ยังไม่มี spec
          </span>
        )}
      </div>
    ),
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
        <span className="font-mono text-xs">
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
        <span className="text-muted-foreground">—</span>
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
        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[0.7rem] font-medium text-primary">
          ST override ได้
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: "supportedModels",
    accessorFn: (row) => formatModelSupport(row.supportedModels),
    header: "รุ่น/โปรโตคอลที่รองรับ",
    enableSorting: false,
    meta: { filterVariant: "text", label: "รุ่น/โปรโตคอล" },
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>รายการ Parameter ทั้งหมด</CardTitle>
        <CardDescription>
          นิยาม field ที่ระบบรู้จัก · ใช้อ้างอิงตอนกรอก/ตรวจ Config
          {data ? ` · ${data.length} field` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && data === null ? (
          <TableSkeleton columns={columns.length} />
        ) : error ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              ลองใหม่
            </Button>
          </div>
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
            searchPlaceholder="ค้นหาชื่อ field / รุ่น…"
            emptyMessage="ไม่พบ Parameter ที่ตรงกับเงื่อนไข"
          />
        )}
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
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">คลัง Parameter</h1>
          <p className="text-sm text-muted-foreground">
            นิยาม field ที่ใช้กรอก Config · สร้างได้เฉพาะ Role ConfigEngineer
          </p>
        </div>
        {canCreate && !showForm ? (
          <Button onClick={() => setShowForm(true)}>
            + สร้าง Parameter ใหม่
          </Button>
        ) : null}
      </div>

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
              + สร้าง Parameter ใหม่
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
