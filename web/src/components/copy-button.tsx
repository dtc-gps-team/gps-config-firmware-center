"use client";

import { useEffect, useRef, useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

/** ปุ่มคัดลอกค่า (IMEI, serial, id) — ไอคอนสลับเป็นเครื่องหมายถูก 1.5 วินาที
 *  ถ้า clipboard ใช้ไม่ได้ (เช่นไม่ใช่ HTTPS) ไม่ทำอะไรเงียบๆ ไม่ throw */
export function CopyButton({
  value,
  label = "คัดลอก",
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return;
    }
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className={className}
      onClick={() => void copy()}
      aria-label={copied ? "คัดลอกแล้ว" : label}
      title={copied ? "คัดลอกแล้ว" : label}
    >
      {copied ? <CheckIcon className="text-success" /> : <CopyIcon />}
    </Button>
  );
}
