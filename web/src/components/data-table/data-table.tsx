"use client";

import { useState } from "react";
import {
  type ColumnDef,
  type ColumnFiltersState,
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  type RowData,
  useReactTable,
} from "@tanstack/react-table";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { DataTableColumnFilter } from "./column-filter";

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /**
     * ชนิดฟิลเตอร์ต่อคอลัมน์ (มติ Sprint 1 review ข้อ 2):
     * `"text"` = ช่องพิมพ์กรองสด · `"select"` = dropdown ค่า distinct จากข้อมูลจริง
     * ไม่ใส่ = คอลัมน์นี้ไม่มีฟิลเตอร์ต่อคอลัมน์
     */
    filterVariant?: "text" | "select";
    /** ป้ายชื่อคอลัมน์ (ใช้ใน placeholder ของช่องฟิลเตอร์) */
    label?: string;
  }
}

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  /** placeholder ของช่องค้นหารวม (ค้นข้ามทุกคอลัมน์) */
  searchPlaceholder?: string;
  /** ข้อความเมื่อไม่มีแถวหลังกรอง */
  emptyMessage?: string;
}

/**
 * ตาราง list มาตรฐาน — ค้นหารวม + ฟิลเตอร์ต่อคอลัมน์ (ข้อความ / dropdown)
 * client-side ทั้งหมด (มติ Sprint 1 review ข้อ 2 — เริ่ม client-side, data
 * ยังน้อย) ออกแบบให้ทุกหน้า list reuse ได้
 */
export function DataTable<TData, TValue>({
  columns,
  data,
  searchPlaceholder = "ค้นหา…",
  emptyMessage = "ไม่พบข้อมูลที่ตรงกับเงื่อนไข",
}: DataTableProps<TData, TValue>) {
  // TanStack Table's useReactTable() คืน function ที่ React Compiler memoize
  // ไม่ปลอดภัย — opt-out component นี้ออกจาก compiler (คำแนะนำทางการของ TanStack)
  "use no memo";

  const [globalFilter, setGlobalFilter] = useState("");
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  // eslint-disable-next-line react-hooks/incompatible-library -- opt-out ด้วย "use no memo" ข้างบนแล้ว
  const table = useReactTable({
    data,
    columns,
    state: { globalFilter, columnFilters },
    onGlobalFilterChange: setGlobalFilter,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  });

  const hasColumnFilterRow = table
    .getAllLeafColumns()
    .some((c) => c.columnDef.meta?.filterVariant);

  const rows = table.getRowModel().rows;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Input
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          placeholder={searchPlaceholder}
          className="h-8 max-w-xs"
          aria-label="ค้นหารวม"
        />
        <span className="text-xs text-muted-foreground tabular-nums">
          {rows.length} / {data.length} รายการ
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
            {hasColumnFilterRow && (
              <TableRow>
                {table.getHeaderGroups()[0]?.headers.map((header) => (
                  <TableHead key={`${header.id}-filter`} className="py-1.5">
                    {header.isPlaceholder ? null : (
                      <DataTableColumnFilter column={header.column} />
                    )}
                  </TableHead>
                ))}
              </TableRow>
            )}
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-sm text-muted-foreground"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
