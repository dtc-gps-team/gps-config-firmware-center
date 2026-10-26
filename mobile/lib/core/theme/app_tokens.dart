import 'package:flutter/material.dart';

/// Design token ของ Mobile — เริ่มจากชุดเดียวกับ Web (docs/22 §4) ใช้กับ
/// [AppTheme.v2] และ widget ใหม่ใน `lib/core/ui/` เท่านั้น หน้าเดิมยังใช้ token เก่าใน
/// `AppTheme` จนกว่าจะย้ายตาม batch ของ docs/22 §9 (token เก่าลบใน Batch 6)
///
/// ชื่อตาม CSS variable ของ `web/src/app/globals.css` (`:root`) แปลง kebab-case
/// เป็น camelCase (`--muted-foreground` → [AppColors.mutedForeground]) ค้นข้าม
/// สองฝั่งได้ตรงๆ · ค่า hex เดิม **แปลงจาก `oklch()` จริง** (main `d487763`)
///
/// **เริ่มต่างจาก Web แล้วโดยตั้งใจ (ปรับดีไซน์ให้พรีเมียมขึ้น — docs/22 §4.6):**
/// ขอบ / พื้น / ป้ายสถานะนุ่มขึ้น, radius ใหญ่ขึ้น, มีเงา ([AppShadows]) ที่ Web ไม่มี
/// · ค่าที่ต่างจาก Web มีคอมเมนต์ "ต่างจาก Web" กำกับ · ต้องคุยกับ A ว่าจะตาม Web
/// หรือให้ Web ตาม ก่อนสลับทั้งแอปใน Batch 6
///
/// โหมดสว่างอย่างเดียว ไม่พอร์ต `.dark` ของ Web ในรอบนี้ (docs/22 §4.2)
class AppColors {
  const AppColors._();

  /// ต่างจาก Web (`#F7F8FA`) — เทาอมฟ้าอ่อนลงนิดเดียว ให้การ์ดขาวที่มีเงาลอยเด่นขึ้น
  static const background = Color(0xFFF5F7FA);
  static const foreground = Color(0xFF1B2733);
  static const card = Color(0xFFFFFFFF);
  static const cardForeground = foreground;
  static const primary = Color(0xFF1B6FB2);
  static const primaryForeground = Color(0xFFFFFFFF);

  /// สีเน้น (accent) จุดสำคัญ — พื้นฟ้าอ่อนของ primary ใต้ไอคอน / ตัวเลข / สัญลักษณ์
  /// ใหม่ ไม่มีใน Web (ต่างจาก Web)
  static const primarySubtle = Color(0xFFE8F1FA);
  static const secondary = Color(0xFFEEF1F5);
  static const secondaryForeground = foreground;
  static const muted = secondary;

  /// ค่าใหม่จาก #344 (`oklch(0.49 0.028 259.8)`) เข้มขึ้นจาก `#667080` เดิม —
  /// 6.26:1 บน [card], 5.89:1 บน [background]
  static const mutedForeground = Color(0xFF576171);
  static const accent = Color(0xFFECF3F9);
  static const accentForeground = Color(0xFF12344D);
  static const destructive = Color(0xFFE7000B);

  // ป้ายสถานะ: พื้นอ่อน (subtle) + ตัวอักษรเข้ม (foreground) — subtle ต่างจาก Web
  // เล็กน้อย (นุ่มลง อิ่มสีน้อยลง) ตัวอักษรคงค่าเดิม คอนทราสต์ยังเกิน 4.5:1 ทุกคู่
  static const success = Color(0xFF4E9B6C);
  static const successForeground = Color(0xFF165E3C);
  static const successSubtle = Color(0xFFE3F5EA);
  static const warning = Color(0xFFCB8315);
  static const warningForeground = Color(0xFF824103);
  static const warningSubtle = Color(0xFFFDF2D8);
  static const info = Color(0xFF287CCF);
  static const infoForeground = Color(0xFF075A8E);
  static const infoSubtle = Color(0xFFE5F1FC);

  /// Web ไม่มี `--danger` ตัวเข้ม จุด/ปุ่มอันตรายใช้ [destructive] แทน
  static const dangerForeground = Color(0xFF9D1135);
  static const dangerSubtle = Color(0xFFFDEDEF);

  /// ขอบการ์ด เส้นแบ่ง — ของตกแต่ง ห้ามใช้เป็นขอบช่องกรอก · ต่างจาก Web
  /// (`#E2E6EB`) — จางลงเพราะการ์ดใช้เงา ([AppShadows.card]) แยกจากพื้นแทนเส้นขอบ
  static const border = Color(0xFFE7EAEF);

  /// ขอบช่องกรอก **ต่างจาก Web โดยตั้งใจ** (docs/22 §4.3): `--input` ของ Web
  /// เท่ากับ [border] (1.25:1) ไม่ผ่าน WCAG 1.4.11 ใช้ [mutedForeground] แทน
  static const inputBorder = mutedForeground;
  static const ring = primary;

  /// ไฮไลต์ที่วิ่งผ่าน skeleton ([AppSkeletonBox] shimmer) — สว่างกว่า [muted]
  static const shimmerHighlight = Color(0xFFF8F9FB);
}

/// Radius — เริ่มจากสเกลของ Web (`--radius: 0.625rem` = 10) แล้ว **มนขึ้นต่างจาก
/// Web** (lg 10 → 12, xl 14 → 16) · ปุ่ม / ช่องกรอก / กล่องข้อความใช้ [lg] · การ์ดใช้
/// [xl] · กล่องใหญ่ที่ลอยเด่น (การ์ดหน้า Login) ใช้ [xxl]
class AppRadius {
  const AppRadius._();

  static const double sm = 6;
  static const double md = 8;
  static const double lg = 12;
  static const double xl = 16;
  static const double xxl = 20;

  /// ป้าย (Badge) — `rounded-full`
  static const double full = 999;
}

/// เงาแบบนุ่ม (blur มาก opacity ต่ำ สีอมน้ำเงินของ [AppColors.foreground] ไม่ใช่ดำ)
/// สองชั้น: ชั้นแคบคมให้ขอบล่างชัด + ชั้นกว้างจางให้ลอย — ไม่มีใน Web (ต่างจาก Web)
class AppShadows {
  const AppShadows._();

  /// การ์ดปกติ (`AppCard`) — แทนเส้นขอบเข้มเดิม
  static const card = [
    BoxShadow(color: Color(0x0A1B2733), blurRadius: 2, offset: Offset(0, 1)),
    BoxShadow(color: Color(0x0F1B2733), blurRadius: 16, offset: Offset(0, 4)),
  ];

  /// ตอนกดการ์ดค้าง / element ที่ลอยเหนือเนื้อหา (แถบปุ่มล่าง)
  static const raised = [
    BoxShadow(color: Color(0x0D1B2733), blurRadius: 4, offset: Offset(0, 2)),
    BoxShadow(color: Color(0x141B2733), blurRadius: 24, offset: Offset(0, 8)),
  ];

  /// กล่องหลักที่ลอยเด่นกลางจอ (การ์ดหน้า Login)
  static const floating = [
    BoxShadow(color: Color(0x0D1B2733), blurRadius: 6, offset: Offset(0, 2)),
    BoxShadow(color: Color(0x1A1B2733), blurRadius: 40, offset: Offset(0, 16)),
  ];

  /// เงาสีของสัญลักษณ์แอป / ปุ่มหลักที่ต้องการเน้น
  static const primaryGlow = [
    BoxShadow(color: Color(0x401B6FB2), blurRadius: 20, offset: Offset(0, 8)),
  ];
}

/// ระยะห่างสเกล 4 — ใช้ใน component กลาง ให้จังหวะช่องว่างสม่ำเสมอ
class AppSpacing {
  const AppSpacing._();

  static const double xs = 4;
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 20;
  static const double xxl = 24;
  static const double xxxl = 32;
}

/// ความเร็ว / เส้นโค้งของการเคลื่อนไหว — เบาและสั้น ทุกตัวต้องปิดได้ด้วย
/// `MediaQuery.disableAnimations` (ตั้งลดการเคลื่อนไหวในเครื่อง)
class AppMotion {
  const AppMotion._();

  static const fast = Duration(milliseconds: 120);
  static const base = Duration(milliseconds: 280);
  static const slow = Duration(milliseconds: 450);

  /// รอบของ shimmer บน skeleton
  static const shimmer = Duration(milliseconds: 1400);
  static const curve = Curves.easeOutCubic;
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

  /// ชิดตัวอักษรหัวข้อ (ชื่อหน้า / ชื่อการ์ด) ลงเล็กน้อยให้ดูแน่นและเด่นจากเนื้อหา —
  /// ต่างจาก Web (ไม่ได้ตั้ง `tracking`)
  static const double headingTracking = -0.2;
}
