import type { Metadata } from "next";
import { Anuphan, Geist_Mono } from "next/font/google";
import { AuthProvider } from "@/components/auth/auth-provider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

// variable ตั้งชื่อเป็น "--font-sans" ตรงๆ (ไม่ใช่ "--font-noto-sans-thai")
// เพราะ globals.css (จาก shadcn init) กำหนด `--font-sans: var(--font-sans)`
// ไว้รออยู่แล้ว — ต้องตั้งชื่อให้ตรงกันตัวแปรถึงจะถูกหยิบไปใช้จริง (เดิมตอนเป็น
// Geist ตัวแปรชื่อ --font-geist-sans ไม่ตรงกับที่ globals.css รออยู่ ทำให้
// Tailwind fallback ไปใช้ font ระบบเงียบๆ โดยไม่มี error — แก้จุดนี้ไปด้วยเลย)
//
// เปลี่ยนจาก Noto_Sans_Thai (เดิม) → Noto_Sans_Thai_Looped: Google แยกฟอนต์นี้
// เป็น 2 ตระกูล — "Noto Sans Thai" ดีไซน์แบบไม่มีหัว (loopless) ส่วน "Noto Sans
// Thai Looped" มีหัวตามอักขระไทยดั้งเดิม อ่านชัดกว่าเมื่อมองจากระยะไกล/ตัวเล็ก
// (feedback จากผู้ใช้จริง 2026-09-16) — เปลี่ยนแค่ชื่อฟอนต์ที่โหลด ไม่กระทบ
// ชื่อ CSS variable/weight/subset เดิมเลย
//
// เปลี่ยนเป็น Anuphan (2026-10-16, UI ปรับใหม่): ฟอนต์ไทย
// ของ Cadson Demak ออกแบบมาให้ไทยกับอังกฤษเข้าชุดกันในบรรทัดเดียว (หน้าจอ
// ระบบนี้ปนสองภาษาตลอด เช่น "สร้าง Config ใหม่") ดูเป็นแอปสมัยใหม่กว่า แต่
// เป็นแบบไม่มีหัว ซึ่งต่างจากเหตุผลที่เลือก Looped ไว้ข้างบน ถ้าผู้ใช้กลับมา
// บอกว่าตัวเล็กอ่านยาก ให้ย้อนกลับมาดูจุดนี้ · ชื่อ CSS variable ยังเป็น
// --font-sans เหมือนเดิม
const anuphan = Anuphan({
  variable: "--font-sans",
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GPS Config & Firmware Center",
  description: "Web app สำหรับจัดการ Config/Firmware ของอุปกรณ์ GPS",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="th"
      className={`${anuphan.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AuthProvider>{children}</AuthProvider>
        <Toaster />
      </body>
    </html>
  );
}
