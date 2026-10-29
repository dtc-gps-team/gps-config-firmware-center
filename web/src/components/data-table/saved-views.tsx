"use client";

import { useCallback, useState } from "react";
import { BookmarkIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export type SavedView = { name: string; search: string };

const STORAGE_PREFIX = "gps.table-views.";

function readViews(key: string): SavedView[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter(
          (v): v is SavedView =>
            typeof v?.name === "string" && typeof v?.search === "string",
        )
      : [];
  } catch {
    return [];
  }
}

function useSavedViews(key: string) {
  // ตารางโผล่หลังโหลดข้อมูลฝั่ง client เท่านั้น จึงอ่าน localStorage ตอนสร้าง state ได้
  const [views, setViews] = useState<SavedView[]>(() =>
    typeof window === "undefined" ? [] : readViews(key),
  );

  const persist = useCallback(
    (next: SavedView[]) => {
      setViews(next);
      try {
        window.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(next));
      } catch {
        // เก็บไม่ได้ (private window ฯลฯ): ใช้ได้ในหน้านี้ต่อ แค่ไม่จำข้ามรอบ
      }
    },
    [key],
  );
  return { views, persist };
}

/**
 * มุมมองที่บันทึกไว้ (ค้นหา + sort + ฟิลเตอร์) เก็บใน localStorage ของเครื่องนี้
 * `currentSearch` = query string ของมุมมองปัจจุบัน · `onApply` รับ query string
 * ของมุมมองที่เลือก
 */
export function SavedViewsMenu({
  storageKey,
  currentSearch,
  onApply,
}: {
  storageKey: string;
  currentSearch: string;
  onApply: (search: string) => void;
}) {
  const { views, persist } = useSavedViews(storageKey);
  const [name, setName] = useState("");
  const trimmed = name.trim();
  const canSave = trimmed !== "" && currentSearch !== "";

  function save() {
    if (!canSave) return;
    persist([
      ...views.filter((v) => v.name !== trimmed),
      { name: trimmed, search: currentSearch },
    ]);
    setName("");
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button type="button" variant="outline" size="sm">
            <BookmarkIcon />
            ที่บันทึกไว้{views.length > 0 && ` (${views.length})`}
          </Button>
        }
      />
      <PopoverContent className="w-72 gap-2 p-2" align="start">
        {views.length === 0 ? (
          <p className="px-1 py-1 text-xs text-muted-foreground">
            ยังไม่มีตัวกรองที่บันทึก ตั้งค้นหาหรือตัวกรองในตาราง แล้วตั้งชื่อเพื่อเก็บไว้ใช้ซ้ำ
          </p>
        ) : (
          <ul className="flex flex-col">
            {views.map((v) => (
              <li key={v.name} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onApply(v.search)}
                  className="min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted"
                >
                  {v.name}
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`ลบตัวกรอง ${v.name}`}
                  onClick={() => persist(views.filter((x) => x.name !== v.name))}
                >
                  <XIcon />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center gap-1.5 border-t pt-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
            }}
            placeholder="ตั้งชื่อตัวกรองปัจจุบัน"
            className="h-8"
            aria-label="ชื่อตัวกรอง"
          />
          <Button type="button" size="sm" disabled={!canSave} onClick={save}>
            บันทึก
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
