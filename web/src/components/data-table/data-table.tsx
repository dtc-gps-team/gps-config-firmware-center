"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  type RowSelectionState,
  type SortingState,
  useReactTable,
  type VisibilityState,
} from "@tanstack/react-table";
import {
  ChevronDownIcon,
  ChevronsUpDownIcon,
  ChevronUpIcon,
  Columns3Icon,
  FilterXIcon,
  SearchXIcon,
} from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { EmptyState } from "@/components/empty-state";
import { FloatingActionBar } from "@/components/floating-action-bar";
import { cn } from "@/lib/utils";
import {
  EMPTY_TABLE_VIEW,
  hasActiveFilters,
  parseTableView,
  serializeTableView,
} from "@/lib/table-url-state";
import {
  computeWindow,
  VIRTUALIZE_THRESHOLD,
  type VirtualWindow,
} from "@/lib/virtual-window";
import { DataTableColumnFilter } from "./column-filter";
import { SavedViewsMenu } from "./saved-views";

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

const MOBILE_QUERY = "(max-width: 767px)";

/** อ่านสถานะตั้งต้นจาก URL ตอน mount (client เท่านั้น — ตารางโผล่หลังโหลดข้อมูลแล้ว) */
function readUrlView() {
  if (typeof window === "undefined") return EMPTY_TABLE_VIEW;
  return parseTableView(window.location.search);
}

function writeUrlView(search: string) {
  const url = `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`;
  window.history.replaceState(window.history.state, "", url);
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
  /** ฟิลเตอร์คอลัมน์ตั้งต้น (เช่นมาจากลิงก์ที่มี query) — ใช้ตอน mount ครั้งเดียว ผู้ใช้แก้/ล้างต่อได้ */
  initialColumnFilters?: ColumnFiltersState;
  /** เก็บค้นหา/sort/ฟิลเตอร์ไว้ใน URL (`?q=&sort=&m.col=`) — หน้าที่มีตารางเดียวเท่านั้น */
  urlSync?: boolean;
  /** เปิดปุ่ม "มุมมอง" บันทึกชุดค้นหา/ฟิลเตอร์ (ค่าคือ key เก็บใน localStorage) — ต้องใช้คู่กับ `urlSync` */
  savedViewsKey?: string;
  /** เปิดเมนูซ่อน/แสดงคอลัมน์ */
  columnToggle?: boolean;
  /** เลือกแถวได้ + แถบการกระทำลอยเมื่อมีที่เลือก */
  selectable?: {
    getRowId: (row: TData) => string;
    bulkActions: (selected: TData[], clear: () => void) => React.ReactNode;
  };
  /** การ์ดของแถวสำหรับจอแคบ (< 768px) — ไม่ใส่ = ตารางเลื่อนแนวนอนตามเดิม */
  renderCard?: (row: TData) => React.ReactNode;
  /** คอลัมน์ที่ซ่อนตอนเริ่ม (ผู้ใช้เปิดได้จากเมนู "คอลัมน์") เช่น `{ protocol: false }` */
  initialColumnVisibility?: VisibilityState;
  /** ความสูงแถว (px) ตอนเข้าโหมด virtualization (แถวเกิน 200) */
  virtualRowHeight?: number;
}

function useIsMobile(enabled: boolean) {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const mq = window.matchMedia(MOBILE_QUERY);
    const sync = () => setMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [enabled]);
  return mobile;
}

/**
 * ตาราง list มาตรฐาน — ค้นหารวม + ฟิลเตอร์ต่อคอลัมน์ (ข้อความ / dropdown) +
 * เรียงลำดับต่อคอลัมน์ client-side ทั้งหมด (มติ Sprint 1 review ข้อ 2 — เริ่ม
 * client-side, data ยังน้อย) ออกแบบให้ทุกหน้า list reuse ได้
 *
 * ความสามารถเสริมที่เปิดผ่าน props (ไม่ใส่ = ทำงานเหมือนเดิม): `urlSync`
 * (มุมมองอยู่ใน URL), `savedViewsKey` (มุมมองที่บันทึก), `columnToggle`,
 * `selectable` (เลือกแถว + FloatingActionBar), `renderCard` (card list บนมือถือ)
 * และ virtualization อัตโนมัติเมื่อแถวหลังกรองเกิน 200
 */
export function DataTable<TData, TValue>({
  columns,
  data,
  searchPlaceholder = "ค้นหา…",
  emptyMessage = "ไม่พบข้อมูลที่ตรงกับเงื่อนไข",
  onRowClick,
  initialColumnFilters = [],
  urlSync = false,
  savedViewsKey,
  columnToggle = false,
  selectable,
  renderCard,
  initialColumnVisibility = {},
  virtualRowHeight = 52,
}: DataTableProps<TData, TValue>) {
  // TanStack Table's useReactTable() คืน function ที่ React Compiler memoize
  // ไม่ปลอดภัย — opt-out component นี้ออกจาก compiler (คำแนะนำทางการของ TanStack)
  "use no memo";

  // ค่าจาก URL มาก่อน ถ้า URL ว่างใช้ฟิลเตอร์ตั้งต้นจาก props
  const [initial] = useState(() => {
    const fromUrl = urlSync ? readUrlView() : EMPTY_TABLE_VIEW;
    return {
      ...fromUrl,
      columnFilters:
        fromUrl.columnFilters.length > 0
          ? fromUrl.columnFilters
          : initialColumnFilters,
    };
  });
  const [globalFilter, setGlobalFilter] = useState(initial.globalFilter);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(
    initial.columnFilters,
  );
  const [sorting, setSorting] = useState<SortingState>(initial.sorting);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
    initialColumnVisibility,
  );
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  // เพิ่มค่าเมื่อมุมมองถูกแทนที่จากภายนอก (มุมมองที่บันทึก/ล้างตัวกรอง) เพื่อ
  // remount ช่องกรองที่เก็บข้อความของตัวเองไว้
  const [viewNonce, setViewNonce] = useState(0);

  const syncUrl = useCallback(
    (next: {
      globalFilter: string;
      sorting: SortingState;
      columnFilters: ColumnFiltersState;
    }) => {
      if (!urlSync || typeof window === "undefined") return;
      writeUrlView(serializeTableView(next, window.location.search));
    },
    [urlSync],
  );

  const columnsWithSelect = useMemo<ColumnDef<TData, TValue>[]>(() => {
    if (!selectable) return columns;
    const selectColumn: ColumnDef<TData, TValue> = {
      id: "__select",
      enableSorting: false,
      enableHiding: false,
      header: ({ table }) => (
        <span className="flex items-center">
          <Checkbox
            checked={table.getIsAllRowsSelected()}
            indeterminate={table.getIsSomeRowsSelected()}
            onCheckedChange={(v) => table.toggleAllRowsSelected(Boolean(v))}
            aria-label="เลือกทุกแถว"
          />
        </span>
      ),
      cell: ({ row }) => (
        <span className="flex items-center" onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(v) => row.toggleSelected(Boolean(v))}
            aria-label="เลือกแถวนี้"
          />
        </span>
      ),
    };
    return [selectColumn, ...columns];
  }, [columns, selectable]);

  // eslint-disable-next-line react-hooks/incompatible-library -- opt-out ด้วย "use no memo" ข้างบนแล้ว
  const table = useReactTable({
    data,
    columns: columnsWithSelect,
    state: { globalFilter, columnFilters, sorting, columnVisibility, rowSelection },
    getRowId: selectable ? (row) => selectable.getRowId(row) : undefined,
    enableRowSelection: Boolean(selectable),
    onGlobalFilterChange: (updater) => {
      const next = typeof updater === "function" ? updater(globalFilter) : updater;
      setGlobalFilter(next);
      syncUrl({ globalFilter: next, sorting, columnFilters });
    },
    onColumnFiltersChange: (updater) => {
      const next = typeof updater === "function" ? updater(columnFilters) : updater;
      setColumnFilters(next);
      syncUrl({ globalFilter, sorting, columnFilters: next });
    },
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      setSorting(next);
      syncUrl({ globalFilter, sorting: next, columnFilters });
    },
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
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
  const view = { globalFilter, sorting, columnFilters };
  const filtersActive = hasActiveFilters(view);
  const currentSearch = serializeTableView(view);
  const selectedRows = table.getSelectedRowModel().rows.map((r) => r.original);
  const visibleColumnCount = table.getVisibleLeafColumns().length;

  function applyView(search: string) {
    const next = parseTableView(search);
    setGlobalFilter(next.globalFilter);
    setSorting(next.sorting);
    setColumnFilters(next.columnFilters);
    setViewNonce((n) => n + 1);
    syncUrl(next);
  }

  // ---- virtualization (แถวหลังกรองเกิน 200) ----
  const virtual = rows.length > VIRTUALIZE_THRESHOLD;
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(640);
  const win: VirtualWindow | null = virtual
    ? computeWindow({
        total: rows.length,
        rowHeight: virtualRowHeight,
        scrollTop,
        viewportHeight,
      })
    : null;
  const shownRows = win ? rows.slice(win.start, win.end) : rows;

  const mobile = useIsMobile(Boolean(renderCard));
  const showCards = Boolean(renderCard) && mobile;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={globalFilter}
          onChange={(e) => table.setGlobalFilter(e.target.value)}
          placeholder={searchPlaceholder}
          className="h-8 w-full max-w-xs"
          aria-label="ค้นหารวม"
        />
        {filtersActive && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => applyView("")}
          >
            <FilterXIcon />
            ล้างตัวกรอง
          </Button>
        )}
        {urlSync && savedViewsKey && (
          <SavedViewsMenu
            storageKey={savedViewsKey}
            currentSearch={currentSearch}
            onApply={applyView}
          />
        )}
        {columnToggle && (
          <Popover>
            <PopoverTrigger
              render={
                <Button type="button" variant="outline" size="sm">
                  <Columns3Icon />
                  คอลัมน์
                </Button>
              }
            />
            <PopoverContent className="w-48 p-1">
              {table
                .getAllLeafColumns()
                .filter((c) => c.getCanHide() && c.id !== "__select")
                .map((c) => (
                  <label
                    key={c.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                  >
                    <Checkbox
                      checked={c.getIsVisible()}
                      onCheckedChange={(v) => c.toggleVisibility(Boolean(v))}
                    />
                    {c.columnDef.meta?.label ??
                      (typeof c.columnDef.header === "string" ? c.columnDef.header : c.id)}
                  </label>
                ))}
            </PopoverContent>
          </Popover>
        )}
        <span
          className="ml-auto text-xs text-muted-foreground tabular-nums"
          aria-live="polite"
        >
          {rows.length} / {data.length} รายการ
        </span>
      </div>

      {showCards ? (
        <div className="flex flex-col gap-2" data-testid="data-table-cards">
          {rows.length === 0 ? (
            <EmptyState icon={SearchXIcon} message={emptyMessage} />
          ) : (
            rows.map((row) => (
              <div
                key={row.id}
                role={rowClickable ? "button" : undefined}
                tabIndex={rowClickable ? 0 : undefined}
                onClick={rowClickable ? () => onRowClick(row.original) : undefined}
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
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  rowClickable && "cursor-pointer active:bg-muted/60",
                )}
              >
                {selectable && (
                  <span onClick={(e) => e.stopPropagation()} className="pt-0.5">
                    <Checkbox
                      checked={row.getIsSelected()}
                      onCheckedChange={(v) => row.toggleSelected(Boolean(v))}
                      aria-label="เลือกรายการนี้"
                    />
                  </span>
                )}
                <div className="min-w-0 flex-1">{renderCard?.(row.original)}</div>
              </div>
            ))
          )}
        </div>
      ) : (
        <div
          onScroll={
            virtual
              ? (e) => {
                  setScrollTop(e.currentTarget.scrollTop);
                  setViewportHeight(e.currentTarget.clientHeight);
                }
              : undefined
          }
          className={cn(
            "overflow-x-auto rounded-lg border",
            virtual && "max-h-[70vh] overflow-y-auto",
          )}
        >
          <Table>
            <TableHeader className={virtual ? "sticky top-0 z-(--z-sticky) bg-card" : undefined}>
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
                        aria-sort={
                          sorted === "asc"
                            ? "ascending"
                            : sorted === "desc"
                              ? "descending"
                              : undefined
                        }
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
                    <TableHead key={`${header.id}-filter-${viewNonce}`} className="py-1.5">
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
                  <TableCell colSpan={visibleColumnCount} className="p-0">
                    <EmptyState icon={SearchXIcon} message={emptyMessage} />
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {win && win.padTop > 0 && (
                    <TableRow aria-hidden className="border-0 hover:bg-transparent">
                      <TableCell
                        colSpan={visibleColumnCount}
                        className="p-0"
                        style={{ height: win.padTop }}
                      />
                    </TableRow>
                  )}
                  {shownRows.map((row) => (
                    <TableRow
                      key={row.id}
                      role={rowClickable ? "button" : undefined}
                      tabIndex={rowClickable ? 0 : undefined}
                      data-state={row.getIsSelected() ? "selected" : undefined}
                      style={virtual ? { height: virtualRowHeight } : undefined}
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
                      className={cn(
                        rowClickable &&
                          "cursor-pointer outline-none hover:bg-muted/60 focus-visible:bg-muted/60",
                        row.getIsSelected() && "bg-primary/5",
                      )}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell
                          key={cell.id}
                          className={cn(
                            cell.column.columnDef.meta?.align === "end" && "text-right",
                            virtual && "py-0 whitespace-nowrap",
                          )}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                  {win && win.padBottom > 0 && (
                    <TableRow aria-hidden className="border-0 hover:bg-transparent">
                      <TableCell
                        colSpan={visibleColumnCount}
                        className="p-0"
                        style={{ height: win.padBottom }}
                      />
                    </TableRow>
                  )}
                </>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {selectable && (
        <FloatingActionBar show={selectedRows.length > 0}>
          <span className="tabular-nums">เลือกแล้ว {selectedRows.length}</span>
          {selectable.bulkActions(selectedRows, () => table.resetRowSelection())}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => table.resetRowSelection()}
          >
            ยกเลิกการเลือก
          </Button>
        </FloatingActionBar>
      )}
    </div>
  );
}
