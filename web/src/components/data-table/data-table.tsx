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
  getSortedRowModel,
  type RowData,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import {
  ChevronDownIcon,
  ChevronsUpDownIcon,
  ChevronUpIcon,
} from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { DataTableColumnFilter } from "./column-filter";

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /**
     * ชนิดฟิลเตอร์ต่อคอลัมน์ (มติ Sprint 1 review ข้อ 2):
     * `"text"` = ช่องพิมพ์กรองสด · `"multi-select"` = dropdown checkbox หลายค่า
     * (ตัวเลือกจากข้อมูลจริง) · `"date-range"` = ช่วงวันที่
     * ไม่ใส่ = คอลัมน์นี้ไม่มีฟิลเตอร์ต่อคอลัมน์
     */
    filterVariant?: "text" | "multi-select" | "date-range";
    /** ป้ายชื่อคอลัมน์ (ใช้ใน placeholder ของช่องฟิลเตอร์) */
    label?: string;
    /** จัดชิดขวา (คอลัมน์วันที่ / ตัวเลข) — ใส่กับทั้ง header และ cell */
    align?: "end";
  }
}

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  /** placeholder ของช่องค้นหารวม (ค้นข้ามทุกคอลัมน์) */
  searchPlaceholder?: string;
  /** ข้อความเมื่อไม่มีแถวหลังกรอง */
  emptyMessage?: string;
  /** คลิกแถว (เปิดรายละเอียด ฯลฯ) — ใส่แล้วแถวจะกดได้ + โฟกัสด้วยคีย์บอร์ดได้ */
  onRowClick?: (row: TData) => void;
}

/**
 * ตาราง list มาตรฐาน — ค้นหารวม + ฟิลเตอร์ต่อคอลัมน์ (ข้อความ / dropdown) +
 * เรียงลำดับต่อคอลัมน์ client-side ทั้งหมด (มติ Sprint 1 review ข้อ 2 — เริ่ม
 * client-side, data ยังน้อย) ออกแบบให้ทุกหน้า list reuse ได้
 */
export function DataTable<TData, TValue>({
  columns,
  data,
  searchPlaceholder = "ค้นหา…",
  emptyMessage = "ไม่พบข้อมูลที่ตรงกับเงื่อนไข",
  onRowClick,
}: DataTableProps<TData, TValue>) {
  // TanStack Table's useReactTable() คืน function ที่ React Compiler memoize
  // ไม่ปลอดภัย — opt-out component นี้ออกจาก compiler (คำแนะนำทางการของ TanStack)
  "use no memo";

  const [globalFilter, setGlobalFilter] = useState("");
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [sorting, setSorting] = useState<SortingState>([]);

  // eslint-disable-next-line react-hooks/incompatible-library -- opt-out ด้วย "use no memo" ข้างบนแล้ว
  const table = useReactTable({
    data,
    columns,
    state: { globalFilter, columnFilters, sorting },
    onGlobalFilterChange: setGlobalFilter,
    onColumnFiltersChange: setColumnFilters,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  });

  const hasColumnFilterRow = table
    .getAllLeafColumns()
    .some((c) => c.columnDef.meta?.filterVariant);

  const rows = table.getRowModel().rows;
  const rowClickable = typeof onRowClick === "function";

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
                {headerGroup.headers.map((header) => {
                  const align = header.column.columnDef.meta?.align;
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  const headerContent = header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      );
                  return (
                    <TableHead
                      key={header.id}
                      className={align === "end" ? "text-right" : undefined}
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className={cn(
                            "inline-flex items-center gap-1 -ml-1 rounded px-1 py-0.5 hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                            align === "end" && "ml-0 -mr-1 flex-row-reverse",
                          )}
                        >
                          {headerContent}
                          {sorted === "asc" ? (
                            <ChevronUpIcon className="size-3.5 opacity-70" />
                          ) : sorted === "desc" ? (
                            <ChevronDownIcon className="size-3.5 opacity-70" />
                          ) : (
                            <ChevronsUpDownIcon className="size-3.5 opacity-40" />
                          )}
                        </button>
                      ) : (
                        headerContent
                      )}
                    </TableHead>
                  );
                })}
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
                <TableRow
                  key={row.id}
                  role={rowClickable ? "button" : undefined}
                  tabIndex={rowClickable ? 0 : undefined}
                  onClick={
                    rowClickable ? () => onRowClick(row.original) : undefined
                  }
                  onKeyDown={
                    rowClickable
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onRowClick(row.original);
                          }
                        }
                      : undefined
                  }
                  className={
                    rowClickable
                      ? "cursor-pointer outline-none hover:bg-muted/60 focus-visible:bg-muted/60"
                      : undefined
                  }
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={
                        cell.column.columnDef.meta?.align === "end"
                          ? "text-right"
                          : undefined
                      }
                    >
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
