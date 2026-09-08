"use client";

import { useEffect, useMemo, useState } from "react";
import type { Column } from "@tanstack/react-table";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

/**
 * ฟิลเตอร์ต่อคอลัมน์ (มติ Sprint 1 review ข้อ 2):
 * - `filterVariant: "text"`   → ช่องพิมพ์ กรองสดแบบ debounce
 * - `filterVariant: "select"` → dropdown ค่า distinct จากข้อมูลจริง
 *   (`column.getFacetedUniqueValues()`)
 * คอลัมน์ที่ `enableColumnFilter === false` จะไม่ render อะไร
 */
export function DataTableColumnFilter<TData, TValue>({
  column,
}: {
  column: Column<TData, TValue>;
}) {
  const variant = column.columnDef.meta?.filterVariant;
  if (!column.getCanFilter() || !variant) return <span aria-hidden />;

  const label = column.columnDef.meta?.label ?? column.id;

  if (variant === "select") {
    return <SelectFilter column={column} label={label} />;
  }
  return <TextFilter column={column} label={label} />;
}

function TextFilter<TData, TValue>({
  column,
  label,
}: {
  column: Column<TData, TValue>;
  label: string;
}) {
  const [raw, setRaw] = useState<string>(
    (column.getFilterValue() as string) ?? "",
  );
  const debounced = useDebouncedValue(raw, 300);

  useEffect(() => {
    column.setFilterValue(debounced || undefined);
  }, [debounced, column]);

  return (
    <Input
      value={raw}
      onChange={(e) => setRaw(e.target.value)}
      placeholder={`ค้น ${label}`}
      className="h-7 text-xs"
      aria-label={`ค้นหา ${label}`}
    />
  );
}

function SelectFilter<TData, TValue>({
  column,
  label,
}: {
  column: Column<TData, TValue>;
  label: string;
}) {
  const options = useMemo(() => {
    const values = Array.from(column.getFacetedUniqueValues().keys())
      .filter((v): v is string | number => v !== null && v !== undefined && v !== "")
      .map(String);
    return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, "th"));
  }, [column]);

  const value = (column.getFilterValue() as string) ?? "";

  return (
    <select
      value={value}
      onChange={(e) => column.setFilterValue(e.target.value || undefined)}
      aria-label={`กรอง ${label}`}
      className={cn(
        "h-7 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 text-xs outline-none transition-colors",
        "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        "dark:bg-input/30",
      )}
    >
      <option value="">ทั้งหมด</option>
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  );
}
