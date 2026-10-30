import Link from "next/link";
import { CompassIcon } from "lucide-react";

import { StatusPage } from "@/components/status-page";
import { buttonVariants } from "@/components/ui/button";

export const metadata = {
  title: "ไม่พบหน้านี้ | GPS Config Center",
};

export default function NotFound() {
  return (
    <StatusPage
      icon={CompassIcon}
      code="404"
      title="ไม่พบหน้านี้"
      description="ลิงก์อาจผิดหรือหน้านี้ถูกย้ายแล้ว กลับไปหน้าแรกแล้วเลือกจากเมนู"
      actions={
        <Link href="/" className={buttonVariants({ variant: "default" })}>
          กลับไปหน้าแรก
        </Link>
      }
    />
  );
}
