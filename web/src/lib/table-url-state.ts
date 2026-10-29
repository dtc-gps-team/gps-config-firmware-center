import type { ColumnFiltersState, SortingState } from "@tanstack/react-table";

/**
 * สถานะตาราง (ค้นหารวม, sort, ฟิลเตอร์ต่อคอลัมน์) ↔ query string
 * เพื่อให้ URL เป็น source of truth ของมุมมอง (แชร์ลิงก์ได้ กด Back ได้)
 *
 * รูปแบบ: `q=` ค้นหารวม · `sort=col` หรือ `sort=-col` (ลดหลั่น) ·
 * `f.<col>=text` ฟิลเตอร์ข้อความ · `m.<col>=a&m.<col>=b` multi-select ·
 * `r.<col>=from..to` ช่วงวันที่ · param อื่นในหน้า (เช่น tab) ไม่ถูกแตะ
 */
export type TableViewState = {
  globalFilter: string;
  sorting: SortingState;
  columnFilters: ColumnFiltersState;
};

export const EMPTY_TABLE_VIEW: TableViewState = {
  globalFilter: "",
  sorting: [],
  columnFilters: [],
};

const OWNED_KEYS = /^(q|sort|f\..+|m\..+|r\..+)$/;

export function parseTableView(search: string): TableViewState {
  const params = new URLSearchParams(search);
  const columnFilters: ColumnFiltersState = [];

  const multi = new Map<string, string[]>();
  for (const [key, value] of params.entries()) {
    if (key.startsWith("f.") && value) {
      columnFilters.push({ id: key.slice(2), value });
    } else if (key.startsWith("m.") && value) {
      const id = key.slice(2);
      multi.set(id, [...(multi.get(id) ?? []), value]);
    } else if (key.startsWith("r.") && value.includes("..")) {
      const [from, to] = value.split("..");
      if (from || to) columnFilters.push({ id: key.slice(2), value: [from, to] });
    }
  }
  for (const [id, value] of multi) columnFilters.push({ id, value });

  const sortParam = params.get("sort");
  const sorting: SortingState = sortParam
    ? [
        sortParam.startsWith("-")
          ? { id: sortParam.slice(1), desc: true }
          : { id: sortParam, desc: false },
      ]
    : [];

  return { globalFilter: params.get("q") ?? "", sorting, columnFilters };
}

/** query string (ไม่มี `?`) ของสถานะตาราง · คง param อื่นใน `baseSearch` ไว้ */
export function serializeTableView(
  state: TableViewState,
  baseSearch = "",
): string {
  const params = new URLSearchParams(baseSearch);
  for (const key of Array.from(params.keys())) {
    if (OWNED_KEYS.test(key)) params.delete(key);
  }

  if (state.globalFilter) params.set("q", state.globalFilter);
  const sort = state.sorting[0];
  if (sort) params.set("sort", `${sort.desc ? "-" : ""}${sort.id}`);

  for (const { id, value } of state.columnFilters) {
    if (typeof value === "string") {
      if (value) params.set(`f.${id}`, value);
    } else if (Array.isArray(value) && isRange(value)) {
      const [from = "", to = ""] = value as string[];
      if (from || to) params.set(`r.${id}`, `${from}..${to}`);
    } else if (Array.isArray(value)) {
      for (const v of value) params.append(`m.${id}`, String(v));
    }
  }
  return params.toString();
}

/** ช่วงวันที่ = array ความยาว 2 ที่ทุกค่าเป็น `YYYY-MM-DD` หรือว่าง
 * (multi-select 2 ค่าที่เป็นข้อความทั่วไปจะไม่ถูกตีเป็นช่วง) */
function isRange(value: unknown[]): boolean {
  return (
    value.length === 2 &&
    value.every(
      (v) => v === "" || v === undefined || /^\d{4}-\d{2}-\d{2}$/.test(String(v)),
    )
  );
}

/** มีตัวกรอง/ค้นหาอยู่หรือไม่ (ไว้โชว์ปุ่ม "ล้างตัวกรอง") */
export function hasActiveFilters(state: TableViewState): boolean {
  return state.globalFilter !== "" || state.columnFilters.length > 0;
}
