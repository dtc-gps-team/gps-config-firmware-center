"use client";

import { useState } from "react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * กล่องยืนยันการกระทำที่แก้กลับยาก (ส่งทั้งกลุ่ม, ลบ, rollback)
 * `confirmText` ใส่เมื่อต้องพิมพ์ข้อความนั้นให้ตรงก่อนปุ่มยืนยันจะกดได้
 * (type-to-confirm) — ใช้กับ bulk/อันตราย · `onConfirm` ที่คืน Promise จะ
 * แสดงสถานะกำลังทำงานที่ปุ่มจนเสร็จ
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  confirmText,
  destructive = false,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel: string;
  confirmText?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
  /** เนื้อหาเพิ่มระหว่างคำอธิบายกับปุ่ม เช่นช่องกรอกเหตุผล */
  children?: React.ReactNode;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const blocked = confirmText !== undefined && typed.trim() !== confirmText;

  async function run() {
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setTyped("");
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        {children}
        {confirmText !== undefined && (
          <label className="flex flex-col gap-1.5 text-sm">
            <span>
              พิมพ์ <strong className="font-instrument">{confirmText}</strong>{" "}
              เพื่อยืนยัน
            </span>
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>ยกเลิก</AlertDialogCancel>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={blocked}
            loading={busy}
            onClick={() => void run()}
          >
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
