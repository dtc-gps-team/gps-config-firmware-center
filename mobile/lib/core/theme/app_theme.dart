import 'package:flutter/material.dart';

import 'app_tokens.dart';

/// App-wide theme. Kept intentionally small — a design pass comes later.
///
/// The colors below were consolidated from per-screen `_XColors` classes
/// (Login, Home, Task, Device, Incident, Notification) that had all
/// converged on the same palette independently — this is a pure refactor
/// (no visual change): same hex values, one shared source instead of six
/// duplicated ones. `label` is the one value that turned out genuinely
/// different from `textSecondary` (Login's field-label color vs. the
/// subtitle/secondary-text color used everywhere else) and stays separate
/// on purpose.
class AppTheme {
  const AppTheme._();

  static const _seed = Color(0xFF1565C0);

  static const navy = Color(0xFF12344D);
  static const background = Color(0xFFF4F6F8);
  static const surface = Colors.white;
  static const textPrimary = Color(0xFF12344D);
  static const textSecondary = Color(0xFF5F6E79);
  static const label = Color(0xFF51606B);
  static const error = Color(0xFFC0392B);
  static const fieldBorder = Color(0xFFCED6DE);

  /// ขอบช่องกรอกที่ตั้ง `enabledBorder` เอง (UX audit #10) — ขอบเป็นสิ่งเดียวที่
  /// บอกว่าตรงไหนกรอกได้ จึงต้องถึง 3:1 ตาม WCAG 1.4.11 (3.43:1 บนพื้นขาว,
  /// 3.16:1 บน [background]) · ช่องกรอกที่ไม่ได้ตั้งเองใช้ `colorScheme.outline`
  /// ของ Material (4.48:1) ซึ่งผ่านอยู่แล้ว · [fieldBorder] (1.47:1) ใช้กับเส้นแบ่ง
  /// / กรอบตกแต่งที่ไม่ใช่ช่องกรอกเท่านั้น
  static const inputBorder = Color(0xFF778DA4);
  static const unreadTint = Color(0xFFE3ECF4);
  static const unreadDot = Color(0xFF1F6FB2);
  static const iconBg = Color(0xFFE8EEF3);

  // --- Redesign tokens (from the field-app visual mockup) ---------------
  // Scoped to the screens migrated to the new look so far (Home). Not yet
  // applied app-wide — that is a separate follow-up once every screen has
  // been checked against the mockup. Do not remove the tokens above while
  // any screen still depends on them.
  static const mockBg = Color(0xFFF1F1EE);
  static const mockAccent = Color(0xFF2955B3);
  static const mockAccentSoft = Color(0xFFE8EEFB);
  // เขียวเข้มขึ้นจาก #2F8F5B (3.57:1) ให้ป้าย "เสร็จสิ้น" ผ่าน WCAG AA (UX audit
  // #10): 4.66:1 บน [mockSuccessSoft], 5.27:1 บนพื้นขาว
  static const mockSuccess = Color(0xFF287A4E);
  static const mockSuccessSoft = Color(0xFFE7F4EC);
  static const mockTextPrimary = Color(0xFF1B2333);
  static const mockTextSecondary = Color(0xFF767C88);
  static const mockTextTertiary = Color(0xFF9298A3);
  static const mockCardBorder = Color(0xFFE2E1DA);

  /// Standalone card / detail-panel shadow.
  static const mockShadowCard = [
    BoxShadow(color: Color(0x0D141822), blurRadius: 2, offset: Offset(0, 1)),
    BoxShadow(color: Color(0x0F141822), blurRadius: 16, offset: Offset(0, 6)),
  ];

  /// Lighter shadow for repeated list rows (history cards, notif cards…).
  static const mockShadowRow = [
    BoxShadow(color: Color(0x0A141822), blurRadius: 2, offset: Offset(0, 1)),
  ];

  static ThemeData light() => _base(Brightness.light);
  static ThemeData dark() => _base(Brightness.dark);

  /// Theme ใหม่ตาม design system ของ Web (docs/22 §4) — โหมดสว่างอย่างเดียว
  /// ยังไม่มีหน้าไหนใช้ หน้าที่ย้ายแล้วครอบด้วย theme นี้ทีละหน้า (Batch 2–5)
  /// แล้วสลับทั้งแอปใน Batch 6 · token อยู่ใน `app_tokens.dart`
  static ThemeData v2() {
    const scheme = ColorScheme(
      brightness: Brightness.light,
      primary: AppColors.primary,
      onPrimary: AppColors.primaryForeground,
      secondary: AppColors.secondary,
      onSecondary: AppColors.secondaryForeground,
      error: AppColors.destructive,
      onError: AppColors.primaryForeground,
      surface: AppColors.card,
      onSurface: AppColors.foreground,
      onSurfaceVariant: AppColors.mutedForeground,
      surfaceContainerHighest: AppColors.secondary,
      outline: AppColors.inputBorder,
      outlineVariant: AppColors.border,
    );
    const radius = BorderRadius.all(Radius.circular(AppRadius.lg));
    const shape = RoundedRectangleBorder(borderRadius: radius);
    // ความสูงปุ่ม 48 ต่างจาก Web (h-8 = 32) โดยตั้งใจ — พื้นที่กดขั้นต่ำบนมือถือ
    // (Material 48dp) ใช้แค่สี radius ตัวอักษร ตาม Web (docs/22 §4.5)
    // · กว้างขั้นต่ำ 64 ไม่ใช่ `Size.fromHeight` (กว้าง infinity) ที่ทำให้ปุ่มใน Row /
    // Wrap throw "BoxConstraints forces an infinite width" (รีวิว #349) — ปุ่มที่ต้อง
    // เต็มความกว้างให้ครอบเองด้วย `SizedBox(width: double.infinity)` หรือ `Expanded`
    const buttonSize = Size(64, 48);
    const buttonText = TextStyle(
      fontSize: AppTypography.sm,
      fontWeight: FontWeight.w500,
    );

    TextStyle text(double size, double height, [FontWeight? weight]) =>
        TextStyle(
          fontSize: size,
          height: height,
          fontWeight: weight,
          color: AppColors.foreground,
        );

    OutlineInputBorder inputBorder(Color color, [double width = 1]) =>
        OutlineInputBorder(
          borderRadius: radius,
          borderSide: BorderSide(color: color, width: width),
        );

    return ThemeData(
      colorScheme: scheme,
      scaffoldBackgroundColor: AppColors.background,
      fontFamily: AppTypography.fontFamily,
      textTheme: TextTheme(
        headlineSmall: text(
          AppTypography.xxl,
          AppTypography.xxlHeight,
          FontWeight.w600,
        ),
        titleLarge: text(
          AppTypography.xl,
          AppTypography.xlHeight,
          FontWeight.w600,
        ),
        titleMedium: text(
          AppTypography.base,
          AppTypography.baseHeight,
          FontWeight.w500,
        ),
        titleSmall: text(
          AppTypography.sm,
          AppTypography.smHeight,
          FontWeight.w500,
        ),
        bodyLarge: text(AppTypography.base, AppTypography.baseHeight),
        bodyMedium: text(AppTypography.sm, AppTypography.smHeight),
        bodySmall: text(AppTypography.xs, AppTypography.xsHeight),
        labelLarge: text(
          AppTypography.sm,
          AppTypography.smHeight,
          FontWeight.w500,
        ),
        labelMedium: text(
          AppTypography.xs,
          AppTypography.xsHeight,
          FontWeight.w500,
        ),
        labelSmall: text(
          AppTypography.xs,
          AppTypography.xsHeight,
          FontWeight.w500,
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        border: inputBorder(AppColors.inputBorder),
        enabledBorder: inputBorder(AppColors.inputBorder),
        focusedBorder: inputBorder(AppColors.ring, 2),
        errorBorder: inputBorder(AppColors.destructive),
        focusedErrorBorder: inputBorder(AppColors.destructive, 2),
        disabledBorder: inputBorder(AppColors.border),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: buttonSize,
          backgroundColor: AppColors.primary,
          foregroundColor: AppColors.primaryForeground,
          // Web: disabled:opacity-50
          disabledBackgroundColor: AppColors.primary.withValues(alpha: 0.5),
          disabledForegroundColor: AppColors.primaryForeground,
          shape: shape,
          textStyle: buttonText,
        ),
      ),
      // variant `outline` ของ Web: ขอบ border พื้น background ตัวอักษร foreground
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: buttonSize,
          foregroundColor: AppColors.foreground,
          backgroundColor: AppColors.background,
          side: const BorderSide(color: AppColors.border),
          shape: shape,
          textStyle: buttonText,
        ),
      ),
      // variant `ghost` / `link` ของ Web
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: AppColors.primary,
          shape: shape,
          textStyle: buttonText,
        ),
      ),
      cardTheme: CardThemeData(
        color: AppColors.card,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: radius,
          side: BorderSide(color: AppColors.foreground.withValues(alpha: 0.2)),
        ),
      ),
      dividerTheme: const DividerThemeData(
        color: AppColors.border,
        thickness: 1,
        space: 1,
      ),
    );
  }

  static ThemeData _base(Brightness brightness) {
    final scheme = ColorScheme.fromSeed(
      seedColor: _seed,
      brightness: brightness,
    );
    return ThemeData(
      colorScheme: scheme,
      inputDecorationTheme: const InputDecorationTheme(
        border: OutlineInputBorder(),
      ),
      // ปุ่มหลักทั้งแอปหน้าตาเดียวกับปุ่มหลักหน้า login (UX audit #12) — กรมท่า
      // ตัวอักษรขาว มุม 12 สูง 48 เดิมตั้งแค่ความสูง ปุ่มที่ไม่ได้ใส่ style เอง
      // จึงได้สีฟ้าจาก seed และทรงแคปซูล · ปุ่มที่ใส่ style เองค่าของปุ่มยังชนะ
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size.fromHeight(48),
          backgroundColor: navy,
          foregroundColor: Colors.white,
          disabledBackgroundColor: navy.withValues(alpha: 0.4),
          disabledForegroundColor: Colors.white,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
          textStyle: const TextStyle(fontWeight: FontWeight.w600),
        ),
      ),
    );
  }
}
