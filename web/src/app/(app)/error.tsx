"use client";

import Link from "next/link";
import { ServerCrashIcon } from "lucide-react";

import { StatusPage } from "@/components/status-page";
import { Button, buttonVariants } from "@/components/ui/button";

/** ขอบเขต error ของหน้าในแอป: เมนูและแถบบนยังใช้ได้ ผู้ใช้ลองใหม่หรือกลับหน้าแรกได้ */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <StatusPage
      icon={ServerCrashIcon}
      code="500"
      title="หน้านี้แสดงผลไม่สำเร็จ"
      description={
        <>
          ลองโหลดใหม่ ถ้ายังเกิดซ้ำให้แจ้งผู้ดูแลระบบพร้อมรหัส{" "}
          <span className="font-instrument">{error.digest ?? "ไม่มี"}</span>
        </>
      }
      actions={
        <>
          <Button onClick={reset}>ลองใหม่</Button>
          <Link href="/" className={buttonVariants({ variant: "outline" })}>
            กลับไปหน้าแรก
          </Link>
        </>
      }
    />
  );
}
