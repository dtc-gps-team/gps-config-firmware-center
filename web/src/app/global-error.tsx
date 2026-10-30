"use client";

import { ServerCrashIcon } from "lucide-react";

import { StatusPage } from "@/components/status-page";
import { Button } from "@/components/ui/button";
import "./globals.css";

/** error ระดับ root layout (ก่อนถึงแอป) ต้องมี html/body เอง เพราะแทนที่ layout ทั้งหมด */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="th">
      <body className="min-h-screen bg-background text-foreground">
        <StatusPage
          className="min-h-screen"
          icon={ServerCrashIcon}
          code="500"
          title="ระบบเริ่มทำงานไม่สำเร็จ"
          description={
            <>
              โหลดหน้านี้ใหม่ ถ้ายังเกิดซ้ำให้แจ้งผู้ดูแลระบบพร้อมรหัส{" "}
              <span className="font-instrument">{error.digest ?? "ไม่มี"}</span>
            </>
          }
          actions={<Button onClick={reset}>โหลดใหม่</Button>}
        />
      </body>
    </html>
  );
}
