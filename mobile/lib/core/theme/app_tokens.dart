import 'package:flutter/material.dart';

/// Design token ชุดเดียวกับ Web (docs/22 §4) — ใช้กับ [AppTheme.v2] และ widget
/// ใหม่ใน `lib/core/ui/` เท่านั้น หน้าเดิมยังใช้ token เก่าใน `AppTheme` จนกว่าจะ
/// ย้ายตาม batch ของ docs/22 §9 (token เก่าลบใน Batch 6)
///
/// ชื่อตาม CSS variable ของ `web/src/app/globals.css` (`:root`) แปลง kebab-case
/// เป็น camelCase (`--muted-foreground` → [AppColors.mutedForeground]) ค้นข้าม
/// สองฝั่งได้ตรงๆ · ค่า hex **แปลงจาก `oklch()` จริง** (main `d487763`) ไม่ได้
/// ลอกจากคอมเมนต์ในไฟล์ ซึ่งไม่ตรงค่าจริงหลายตัว (docs/22 §4.4)
///
/// โหมดสว่างอย่างเดียว ไม่พอร์ต `.dark` ของ Web ในรอบนี้ (docs/22 §4.2)
class AppColors {
  const AppColors._();

  static const background = Color(0xFFF7F8FA);
  static const foreground = Color(0xFF1B2733);
  static const card = Color(0xFFFFFFFF);
  static const cardForeground = foreground;
  static const primary = Color(0xFF1B6FB2);
  static const primaryForeground = Color(0xFFFFFFFF);
  static const secondary = Color(0xFFEEF1F5);
  static const secondaryForeground = foreground;
  static const muted = secondary;

  /// ค่าใหม่จาก #344 (`oklch(0.49 0.028 259.8)`) เข้มขึ้นจาก `#667080` เดิม —
  /// 6.26:1 บน [card], 5.89:1 บน [background]
  static const mutedForeground = Color(0xFF576171);
  static const accent = Color(0xFFECF3F9);
  static const accentForeground = Color(0xFF12344D);
  static const destructive = Color(0xFFE7000B);

  static const success = Color(0xFF4E9B6C);
  static const successForeground = Color(0xFF165E3C);
  static const successSubtle = Color(0xFFDBF6E6);
  static const warning = Color(0xFFCB8315);
  static const warningForeground = Color(0xFF824103);
  static const warningSubtle = Color(0xFFFEF3C9);
  static const info = Color(0xFF287CCF);
  static const infoForeground = Color(0xFF075A8E);
  static const infoSubtle = Color(0xFFDFF2FE);

  /// Web ไม่มี `--danger` ตัวเข้ม จุด/ปุ่มอันตรายใช้ [destructive] แทน
  static const dangerForeground = Color(0xFF9D1135);
  static const dangerSubtle = Color(0xFFFFF0F2);

  /// ขอบการ์ด เส้นแบ่ง — ของตกแต่ง (1.25:1) ห้ามใช้เป็นขอบช่องกรอก
  static const border = Color(0xFFE2E6EB);

  /// ขอบช่องกรอก **ต่างจาก Web โดยตั้งใจ** (docs/22 §4.3): `--input` ของ Web
  /// เท่ากับ [border] (1.25:1) ไม่ผ่าน WCAG 1.4.11 ใช้ [mutedForeground] แทน
  static const inputBorder = mutedForeground;
  static const ring = primary;
}

/// Radius ตามสเกลของ Web (`--radius: 0.625rem` = 10) — การ์ด ปุ่ม ช่องกรอกใช้
/// [lg] ตาม `rounded-lg` ของ `card.tsx` / `button.tsx` / `input.tsx`
class AppRadius {
  const AppRadius._();

  static const double sm = 6;
  static const double md = 8;
  static const double lg = 10;
  static const double xl = 14;

  /// ป้าย (Badge) — `rounded-full`
  static const double full = 999;
}

/// สเกลตัวอักษรตาม Tailwind ที่ Web ใช้ — `xs` / `sm` ขยายขึ้น 1px ตาม #344
/// (13 / 15) ที่ B ตัดสินให้ Mobile ตาม · line-height คิดเป็นตัวคูณแบบ Flutter
class AppTypography {
  const AppTypography._();

  /// Anuphan ตาม Web (#344) — มติ B · bundle เป็น asset (`assets/fonts/`, ประกาศ
  /// ใน pubspec) เป็น variable font ไฟล์เดียว `FontWeight` เลือกน้ำหนักให้เอง
  static const fontFamily = 'Anuphan';

  /// ชื่อ field / ค่าดิบของ Config (เช่น `REPORT_INTERVAL_MOVING`) — Web ใช้ Geist Mono
  /// ฝั่ง Mobile ใช้ monospace ของระบบไปก่อน ไม่ bundle ฟอนต์เพิ่ม (docs/22 §4.5)
  static const monoFamily = 'monospace';

  static const double xs = 13;
  static const double sm = 15;
  static const double base = 16;
  static const double lg = 18;
  static const double xl = 20;
  static const double xxl = 24;

  // line-height: xs 1.25rem, sm 1.5rem (ตาม #344) · ที่เหลือค่าเริ่มต้นของ Tailwind
  static const double xsHeight = 20 / 13;
  static const double smHeight = 24 / 15;
  static const double baseHeight = 24 / 16;
  static const double lgHeight = 28 / 18;
  static const double xlHeight = 28 / 20;
  static const double xxlHeight = 32 / 24;
}
