"use client";

import { useId, useRef, useState } from "react";
import { UploadCloudIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * พื้นที่ลากไฟล์มาวาง หรือกดเลือกไฟล์ (ใช้ `<input type="file">` จริงอยู่ข้างใน
 * จึงใช้คีย์บอร์ดและโปรแกรมอ่านหน้าจอได้) · ส่งไฟล์เดียวผ่าน `onPick`
 */
export function FileDropzone({
  label,
  hint,
  disabled,
  accept,
  onPick,
  children,
}: {
  label: string;
  hint?: string;
  disabled?: boolean;
  /** ชนิดไฟล์ที่เลือกได้ เช่น `application/json,.json` */
  accept?: string;
  onPick: (file: File | null) => void;
  /** เนื้อหาแทนข้อความตั้งต้น (เช่นชื่อไฟล์ที่เลือกแล้ว) */
  children?: React.ReactNode;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <div
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (disabled) return;
        onPick(e.dataTransfer.files?.[0] ?? null);
      }}
      className={cn(
        "relative flex flex-col items-center gap-1.5 rounded-lg border border-dashed px-4 py-6 text-center transition-colors duration-(--duration-fast) ease-(--ease-standard)",
        over ? "border-primary bg-info-subtle" : "bg-surface-sunken hover:bg-muted/60",
        disabled && "pointer-events-none opacity-60",
      )}
    >
      <UploadCloudIcon className="size-6 text-muted-foreground" aria-hidden />
      <label
        htmlFor={id}
        className="cursor-pointer text-sm font-medium after:absolute after:inset-0 after:content-['']"
      >
        {label}
      </label>
      <p className="text-xs text-muted-foreground">
        {children ?? hint ?? "ลากไฟล์มาวางที่นี่ หรือกดเพื่อเลือกไฟล์"}
      </p>
      <input
        ref={inputRef}
        id={id}
        type="file"
        disabled={disabled}
        accept={accept}
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
        className="sr-only"
      />
    </div>
  );
}
