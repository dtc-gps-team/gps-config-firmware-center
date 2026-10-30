"use client";

import { useRef, useState } from "react";

import { tokenizeJson, type JsonTokenKind } from "@/lib/config-raw";
import { cn } from "@/lib/utils";

const TOKEN_CLASS: Record<JsonTokenKind, string> = {
  key: "text-info-foreground",
  string: "text-success-foreground",
  number: "text-warning-foreground",
  literal: "text-primary",
  punct: "text-muted-foreground",
  space: "",
};

/** ฟอนต์/ระยะ/การตัดบรรทัดต้องเหมือนกันทุกประการทั้งสองชั้น ไม่งั้นเคอร์เซอร์เลื่อนจากตัวอักษร */
const SHARED =
  "m-0 box-border p-3 font-instrument text-xs leading-5 whitespace-pre";

/**
 * ช่องแก้ JSON ที่ระบายสีขณะพิมพ์: textarea จริงอยู่ด้านบน (ตัวอักษรโปร่งใส เหลือเคอร์เซอร์
 * และ selection) ส่วนข้อความระบายสีวางอยู่ข้างใต้ตำแหน่งเดียวกัน เลื่อนตามกัน ·
 * ไม่ตัดบรรทัดอัตโนมัติเพื่อให้สองชั้นตรงกันเสมอ (เลื่อนแนวนอนแทน)
 */
export function JsonEditor({
  id,
  value,
  onChange,
  invalid,
  className,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  className?: string;
}) {
  const [scroll, setScroll] = useState({ left: 0, top: 0 });
  const areaRef = useRef<HTMLTextAreaElement>(null);

  return (
    <div
      className={cn(
        "relative h-96 overflow-hidden rounded-lg border bg-surface-sunken transition-colors duration-(--duration-fast) ease-(--ease-standard) focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
        invalid && "border-destructive focus-within:border-destructive",
        className,
      )}
    >
      <pre
        aria-hidden
        className={cn(SHARED, "pointer-events-none absolute top-0 left-0 min-w-full select-none")}
        style={{ transform: `translate(${-scroll.left}px, ${-scroll.top}px)` }}
      >
        {tokenizeJson(value).map((t, i) => (
          <span key={i} className={TOKEN_CLASS[t.kind]}>
            {t.text}
          </span>
        ))}
        {/* บรรทัดท้ายว่างต้องมีความสูง ไม่งั้นเลื่อนสุดแล้วเคอร์เซอร์ตกขอบ */}
        {"\n"}
      </pre>
      <textarea
        ref={areaRef}
        id={id}
        value={value}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-invalid={invalid ? true : undefined}
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) =>
          setScroll({ left: e.currentTarget.scrollLeft, top: e.currentTarget.scrollTop })
        }
        wrap="off"
        className={cn(
          SHARED,
          "absolute inset-0 h-full w-full resize-none overflow-auto border-0 bg-transparent text-transparent caret-foreground outline-none selection:bg-primary/25",
        )}
      />
    </div>
  );
}
