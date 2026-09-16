import {
  SlidersHorizontalIcon,
  ShieldCheckIcon,
  ScrollTextIcon,
  type LucideIcon,
} from "lucide-react";

/**
 * ข้อความแนะนำระบบฝั่งซ้าย — เทียบกับ mockup UX/UI Design ต้นฉบับที่มี bullet
 * พูดถึง "Rollout แบบ Pilot → Canary → Batch พร้อม Auto Pause" และ "ติดตาม
 * Real-time" ซึ่งเป็นฟีเจอร์ที่ตัดออกจากขอบเขตงานฝึกงานไปแล้ว (ยังไม่มีจริง)
 * — เขียนใหม่ให้ตรงกับสิ่งที่ระบบทำได้จริงตอนนี้แทน ไม่ก็อปข้อความที่เกินจริงมา
 */
const FEATURES: { icon: LucideIcon; text: string }[] = [
  {
    icon: SlidersHorizontalIcon,
    text: "จัดการ Config และ Firmware ของอุปกรณ์ทั้งหมดในที่เดียว",
  },
  {
    icon: ShieldCheckIcon,
    text: "แยกผู้สร้างกับผู้อนุมัติเสมอ (Separation of Duty)",
  },
  {
    icon: ScrollTextIcon,
    text: "บันทึก Audit Log ทุก action ที่เปลี่ยนแปลงข้อมูลสำคัญ",
  },
];

/**
 * พาเนลซ้ายของหน้า Login (ซ่อนบนจอเล็ก — งานหลักคือฟอร์ม ไม่ใช่พาเนลนี้)
 *
 * พื้นหลังมี blob ไล่สีเบลอ 2 ก้อน ขยับช้าๆด้วย CSS animation ล้วน (ดู
 * globals.css: animate-drift-a/b) ไม่ใช้ JS/canvas เพื่อความเบา — เคารพ
 * prefers-reduced-motion (ปิด animation ให้อัตโนมัติถ้าผู้ใช้ตั้งค่าไว้)
 */
export function LoginHeroPanel() {
  return (
    <div className="relative hidden overflow-hidden bg-sidebar p-10 text-sidebar-foreground lg:flex lg:flex-col lg:justify-between">
      <div
        aria-hidden
        className="animate-drift-a absolute -top-24 -left-24 size-96 rounded-full bg-sidebar-primary/30 blur-3xl"
      />
      <div
        aria-hidden
        className="animate-drift-b absolute -right-32 -bottom-24 size-[28rem] rounded-full bg-sidebar-accent/70 blur-3xl"
      />

      <p className="relative text-sm font-semibold tracking-wide">
        GPS Config &amp; Firmware Center
      </p>

      <div className="relative flex flex-col gap-6">
        <h1 className="text-3xl leading-tight font-semibold text-balance">
          จัดการ Config และ Firmware ของยานพาหนะทั้งหมดในที่เดียว
        </h1>
        <ul className="flex flex-col gap-3 text-sm text-sidebar-foreground/90">
          {FEATURES.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-start gap-2.5">
              <Icon className="mt-0.5 size-4 shrink-0" />
              <span>{text}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="relative text-xs text-sidebar-foreground/60">
        © {new Date().getFullYear() + 543} GPS Config &amp; Firmware Center —
        Internal Platform
      </p>
    </div>
  );
}
