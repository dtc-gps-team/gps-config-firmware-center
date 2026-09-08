"use client";

import { useEffect, useMemo, useState } from "react";
import type { Column } from "@tanstack/react-table";
import { ChevronDownIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

/**
 * ฟิลเตอร์ต่อคอลัมน์ (มติ Sprint 1 review ข้อ 2):
 * - `filterVariant: "text"`         → ช่องพิมพ์ กรองสดแบบ debounce
 * - `filterVariant: "multi-select"` → dropdown checkbox เลือกได้หลายค่า
 *   ตัวเลือกมาจากข้อมูลจริง (`column.getFacetedUniqueValues()`)
 * - `filterVariant: "date-range"`   → ช่วงวันที่ (จาก / ถึง)
 * คอลัมน์ที่ไม่ตั้ง `filterVariant` จะไม่ render อะไร
 */
export function DataTableColumnFilter<TData, TValue>({
  column,
}: {
  column: Column<TData, TValue>;
}) {
  const variant = column.columnDef.meta?.filterVariant;
  if (!column.getCanFilter() || !variant) return <span aria-hidden />;

  const label = column.columnDef.meta?.label ?? column.id;

  if (variant === "multi-select") {
    return <MultiSelectFilter column={column} label={label} />;
  }
  if (variant === "date-range") {
    return <DateRangeFilter column={column} label={label} />;
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

function MultiSelectFilter<TData, TValue>({
  column,
  label,
}: {
  column: Column<TData, TValue>;
  label: string;
}) {
  const options = useMemo(() => {
    const values = Array.from(column.getFacetedUniqueValues().keys())
      .filter(
        (v): v is string | number =>
          v !== null && v !== undefined && v !== "",
      )
      .map(String);
    return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, "th"));
  }, [column]);

  const selected = (column.getFilterValue() as string[] | undefined) ?? [];

  function toggle(value: string) {
    const next = selected.includes(value)
      ? selected.filter((v) => v !== value)
      : [...selected, value];
    column.setFilterValue(next.length ? next : undefined);
  }

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "flex h-7 w-full min-w-0 items-center justify-between gap-1 rounded-lg border border-input bg-transparent px-2 text-xs outline-none transition-colors",
          "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          "dark:bg-input/30",
        )}
        aria-label={`กรอง ${label}`}
      >
        <span className={cn("truncate", selected.length === 0 && "text-muted-foreground")}>
          {selected.length === 0
            ? "ทั้งหมด"
            : selected.length === 1
              ? selected[0]
              : `เลือก ${selected.length}`}
        </span>
        <ChevronDownIcon className="size-3.5 shrink-0 opacity-60" />
      </PopoverTrigger>
      <PopoverContent className="p-1">
        {options.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">ไม่มีตัวเลือก</p>
        ) : (
          <>
            {selected.length > 0 && (
              <button
                type="button"
                onClick={() => column.setFilterValue(undefined)}
                className="mb-1 w-full rounded-md px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted"
              >
                ล้างตัวเลือก
              </button>
            )}
            {options.map((opt) => (
              <label
                key={opt}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted"
              >
                <Checkbox
                  checked={selected.includes(opt)}
                  onCheckedChange={() => toggle(opt)}
                />
                <span className="truncate">{opt}</span>
              </label>
            ))}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

function DateRangeFilter<TData, TValue>({
  column,
  label,
}: {
  column: Column<TData, TValue>;
  label: string;
}) {
  const [from, to] = (column.getFilterValue() as
    | [string?, string?]
    | undefined) ?? [undefined, undefined];

  function setRange(next: [string?, string?]) {
    column.setFilterValue(next[0] || next[1] ? next : undefined);
  }

  return (
    <div className="flex items-center gap-1" aria-label={`ช่วงวันที่ ${label}`}>
      <input
        type="date"
        value={from ?? ""}
        onChange={(e) => setRange([e.target.value || undefined, to])}
        aria-label={`${label} ตั้งแต่`}
        className="h-7 w-full min-w-0 rounded-lg border border-input bg-transparent px-1.5 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
      />
      <span className="text-xs text-muted-foreground">–</span>
      <input
        type="date"
        value={to ?? ""}
        onChange={(e) => setRange([from, e.target.value || undefined])}
        aria-label={`${label} ถึง`}
        className="h-7 w-full min-w-0 rounded-lg border border-input bg-transparent px-1.5 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
      />
    </div>
  );
}
