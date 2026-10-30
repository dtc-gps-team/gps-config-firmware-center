import 'package:flutter/material.dart';

/// ชุดสี Mobile ตามภาพ r4.2 (docs/29 §4) — ตั้งใจต่างจาก Web:
/// ใช้พื้นกระดาษอ่อน สี ink และเขียวมะนาว แทนชุดสีน้ำเงินเดิม ไม่เปลี่ยนสีของ Web
/// คงชื่อ semantic token เดิม เพื่อให้หน้าและ component ที่ใช้ร่วมกันเปลี่ยนชุดสีได้พร้อมกัน
class AppColors {
  const AppColors._();

  static const background = Color(0xFFF5F6F1);
  static const foreground = Color(0xFF252821);
  static const card = Color(0xFFFFFFFF);
  static const cardForeground = foreground;
  static const primary = Color(0xFF22261F);
  static const primaryForeground = Color(0xFFFFFFFF);

  static const primarySubtle = Color(0xFFD7EDAC);
  static const secondary = Color(0xFFEEF0EA);
  static const secondaryForeground = foreground;
  static const muted = secondary;

  static const mutedForeground = Color(0xFF5F675A);
  static const accent = Color(0xFFE3EFCF);
  static const accentForeground = Color(0xFF344126);
  static const destructive = Color(0xFF943726);

  static const success = Color(0xFF2B5E33);
  static const successForeground = Color(0xFF2B5E33);
  static const successSubtle = Color(0xFFE1F0E1);
  static const warning = Color(0xFF6F511A);
  static const warningForeground = Color(0xFF6F511A);
  static const warningSubtle = Color(0xFFF8EFD9);
  static const info = Color(0xFF2C5574);
  static const infoForeground = Color(0xFF2C5574);
  static const infoSubtle = Color(0xFFE2EDF6);

  static const dangerForeground = Color(0xFF943726);
  static const dangerSubtle = Color(0xFFFBE5E0);

  /// ขอบการ์ด/เส้นแบ่งเป็นของตกแต่ง ใช้สีจางได้ ไม่ใช้เป็นขอบช่องกรอก
  static const border = Color(0xFFE7EAE0);

  /// ช่องกรอกต้องแยกจากพื้นได้ตาม WCAG 1.4.11 (อย่างน้อย 3:1)
  /// #76816B ได้ประมาณ 4.10:1 บนขาว ต่างจาก Web และขอบการ์ดโดยตั้งใจ
  static const inputBorder = Color(0xFF76816B);
  static const ring = primary;
  static const onInk = Color(0xFFF3F6EC);
  static const onInkMuted = Color(0xFFD3DBC9);
  static const tabSelectedForeground = Color(0xFF34412A);
  static const notificationBadge = Color(0xFFE8A33B);
  static const onNotificationBadge = Color(0xFF2B1F08);

  static const shimmerHighlight = Color(0xFFFAFBF7);
}

/// มุมโค้งตาม r4: ช่องกรอก/ปุ่ม 16, การ์ด 20, พื้นหัวหน้า/แผ่นล่าง 32
/// ต่างจากสเกล Web โดยตั้งใจ ส่วนป้ายและ component เล็กยังใช้มุมเดิม
class AppRadius {
  const AppRadius._();

  static const double sm = 6;
  static const double md = 8;
  static const double lg = 16;
  static const double xl = 20;
  static const double xxl = 32;

  /// ป้าย (Badge) — `rounded-full`
  static const double full = 999;
}

/// ขนาดแถบเมนูล่างตามภาพ r4.2 — แยกจากมุมการ์ดและสเกลข้อความเนื้อหา
/// ชื่อแท็บขยายตามผู้ใช้จนถึงเพดาน เพื่อให้อ่านครบเป็นคำบนจอ 360px
/// พื้นที่แตะยังไม่น้อยกว่า 48dp และโปรแกรมอ่านหน้าจอได้รับชื่อเต็มเสมอ
class AppDockTokens {
  const AppDockTokens._();

  static const double radius = 23;
  static const double itemRadius = 17;
  static const margin = EdgeInsets.fromLTRB(18, 10, 18, 14);
  static const double padding = 7;
  static const double gap = 4;
  static const itemPadding = EdgeInsets.symmetric(horizontal: 4, vertical: 5);
  static const double iconSize = 19;
  static const double minTarget = 48;
  static const double labelSize = 10.5;
  static const double selectedLabelSize = 11.5;
  static const double maxLabelSize = 14;
  static const double maxSelectedLabelSize = 14.5;
  static const double labelHeight = 1.25;
  static const double badgeLabelSize = 10;
  static const double verticalGap = 3;
  static const double horizontalGap = 7;

  /// เปลี่ยนเป็นแนวตั้งเมื่อข้อความโตขึ้น ลดการเบียดไอคอนและการตัดคำ
  static const double verticalLayoutScale = 1.2;

  /// เผื่อการปัดเศษและฟอนต์จริงที่ต่างจากความกว้างที่วัดเล็กน้อย
  static const double textMeasurementSlack = 4;
}

/// เงาแบบนุ่ม (blur มาก opacity ต่ำ สี ink ของ r4 ไม่ใช่ดำสนิท)
/// สองชั้น: ชั้นแคบคมให้ขอบล่างชัด + ชั้นกว้างจางให้ลอย — ไม่มีใน Web (ต่างจาก Web)
class AppShadows {
  const AppShadows._();

  /// การ์ดปกติ (`AppCard`) — แทนเส้นขอบเข้มเดิม
  static const card = [
    BoxShadow(color: Color(0x0A22261F), blurRadius: 2, offset: Offset(0, 1)),
    BoxShadow(color: Color(0x0F22261F), blurRadius: 16, offset: Offset(0, 4)),
  ];

  /// ตอนกดการ์ดค้าง / element ที่ลอยเหนือเนื้อหา (แถบปุ่มล่าง)
  static const raised = [
    BoxShadow(color: Color(0x0D22261F), blurRadius: 4, offset: Offset(0, 2)),
    BoxShadow(color: Color(0x1422261F), blurRadius: 24, offset: Offset(0, 8)),
  ];

  /// กล่องหลักที่ลอยเด่นกลางจอ (การ์ดหน้า Login)
  static const floating = [
    BoxShadow(color: Color(0x0D22261F), blurRadius: 6, offset: Offset(0, 2)),
    BoxShadow(color: Color(0x1A22261F), blurRadius: 40, offset: Offset(0, 16)),
  ];

  /// เงาสีของสัญลักษณ์แอป / ปุ่มหลักที่ต้องการเน้น
  static const primaryGlow = [
    BoxShadow(color: Color(0x1822261F), blurRadius: 20, offset: Offset(0, 8)),
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
