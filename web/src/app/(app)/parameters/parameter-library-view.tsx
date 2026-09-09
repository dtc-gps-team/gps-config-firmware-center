"use client";

import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";

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
import {
  formatModelSupport,
  type ConfigFieldDefinition,
  type ConfigFieldModelSupport,
} from "@/lib/config-definition-api";
import { ParameterCreateForm } from "./parameter-create-form";

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

function ParameterTableCard({ definitions }: { definitions: DefinitionsState }) {
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
          <p className="py-8 text-center text-sm text-muted-foreground">
            กำลังโหลด…
          </p>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              ลองใหม่
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            ยังไม่มี Parameter ในระบบ
          </p>
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
 * /config-definitions` จริง · SW/Operation/ST/OT เท่านั้น (gate ทั้งหน้าผ่าน
 * RoleGuard) · ฟอร์มสร้าง Parameter ใหม่ (`POST /config-definitions`) เปิด/ปิด
 * ด้วยปุ่ม — เฉพาะ Role SW (gate ที่ปุ่ม + PermissionGuard ฝั่ง backend)
 */
function ParameterLibraryContent() {
  const { session } = useAuth();
  const canCreate = canCreateFieldDefinition(session?.role);
  const definitions = useConfigDefinitions();
  const [showForm, setShowForm] = useState(false);

  /** คู่ (รุ่น/โปรโตคอล) ที่มีในระบบแล้ว — ให้ฟอร์มเลือกเป็น supportedModels */
  const knownPairs = useMemo<ConfigFieldModelSupport[]>(() => {
    const seen = new Set<string>();
    const out: ConfigFieldModelSupport[] = [];
    for (const d of definitions.data ?? []) {
      for (const m of d.supportedModels) {
        const key = `${m.deviceModel}/${m.protocol}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ deviceModel: m.deviceModel, protocol: m.protocol });
      }
    }
    return out;
  }, [definitions.data]);

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
            นิยาม field ที่ใช้กรอก Config · สร้างได้เฉพาะ Role SW
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
          knownPairs={knownPairs}
          existingNames={existingNames}
          onCancel={() => setShowForm(false)}
          onCreated={async () => {
            await definitions.refetch();
            setShowForm(false);
          }}
        />
      ) : null}

      <ParameterTableCard definitions={definitions} />
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
