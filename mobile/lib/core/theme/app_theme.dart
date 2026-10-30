import 'package:flutter/cupertino.dart' show CupertinoPageTransitionsBuilder;
import 'package:flutter/material.dart';

import 'app_tokens.dart';

/// Theme หลักของ Mobile ใช้ชุดสี r4 เดียวกันทั้งหน้าใหม่และชื่อ token เก่า
/// เก็บ alias ไว้ให้หน้าที่ทยอยปรับ layout ใช้ต่อได้ โดยไม่คง palette สองชุด
class AppTheme {
  const AppTheme._();

  static const navy = AppColors.primary;
  static const background = AppColors.background;
  static const surface = AppColors.card;
  static const textPrimary = AppColors.foreground;
  static const textSecondary = AppColors.mutedForeground;
  static const label = AppColors.mutedForeground;
  static const error = AppColors.destructive;
  static const fieldBorder = AppColors.border;

  static const inputBorder = AppColors.inputBorder;
  static const unreadTint = AppColors.accent;
  static const unreadDot = AppColors.primary;
  static const iconBg = AppColors.secondary;

  // ชื่อเดิมของหน้าที่ยังใช้ token กลุ่ม mock — ชี้ชุดสีเดียวกันจนย้าย layout ครบ
  static const mockBg = AppColors.background;
  static const mockAccent = AppColors.primary;
  static const mockAccentSoft = AppColors.accent;
  static const mockSuccess = AppColors.successForeground;
  static const mockSuccessSoft = AppColors.successSubtle;
  static const mockTextPrimary = AppColors.foreground;
  static const mockTextSecondary = AppColors.mutedForeground;
  static const mockTextTertiary = AppColors.mutedForeground;
  static const mockCardBorder = AppColors.border;

  /// เงาของการ์ดเดี่ยวหรือกล่องรายละเอียด
  static const mockShadowCard = [
    BoxShadow(color: Color(0x0D141822), blurRadius: 2, offset: Offset(0, 1)),
    BoxShadow(color: Color(0x0F141822), blurRadius: 16, offset: Offset(0, 6)),
  ];

  /// เงาที่เบากว่าสำหรับแถวซ้ำ เช่น ประวัติและแจ้งเตือน
  static const mockShadowRow = [
    BoxShadow(color: Color(0x0A141822), blurRadius: 2, offset: Offset(0, 1)),
  ];

  /// การเปลี่ยนหน้าแบบจางเข้า + เลื่อนนิดๆ (`FadeForwards` ของ Android 14+) แทน
  /// Zoom ที่ Android ได้เป็นค่าเริ่มต้น — นุ่มกว่า · ใช้ทั้ง [light] (theme ของ
  /// MaterialApp ที่ route ใช้จริง) และ [v2]
  static const pageTransitions = PageTransitionsTheme(
    builders: {
      TargetPlatform.android: FadeForwardsPageTransitionsBuilder(),
      TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
    },
  );

  static ThemeData light() => v2();
  static ThemeData dark() => v2();

  /// Theme r4 โหมดสว่าง ใช้ร่วมกันที่รากแอปและ AppV2Theme
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
        filled: true,
        fillColor: AppColors.card,
        border: inputBorder(AppColors.inputBorder),
        enabledBorder: inputBorder(AppColors.inputBorder),
        focusedBorder: inputBorder(AppColors.ring, 2),
        errorBorder: inputBorder(AppColors.destructive),
        focusedErrorBorder: inputBorder(AppColors.destructive, 2),
        disabledBorder: inputBorder(AppColors.border),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style:
            FilledButton.styleFrom(
              minimumSize: buttonSize,
              backgroundColor: AppColors.primary,
              foregroundColor: AppColors.primaryForeground,
              // ต่างจาก Web ที่ใช้ opacity-50: ปุ่มที่กดไม่ได้ยังต้องอ่านข้อความได้
              // ใช้พื้น accent เขียวอ่อนกับตัวอักษร mutedForeground (WCAG AA ≥4.5:1)
              // แทนการลด opacity ของปุ่มทั้งก้อน ซึ่งทำให้ข้อความจางเกินไป
              disabledBackgroundColor: AppColors.accent,
              disabledForegroundColor: AppColors.mutedForeground,
              shape: shape,
              textStyle: buttonText,
            ).copyWith(
              // พื้นปุ่มที่กดไม่ได้ใกล้สีพื้นหน้า จึงเติมขอบ ink จางให้เห็นรูปทรง
              // ไม่ใช้ขอบเข้มเท่าช่องกรอก และไม่เติมขอบให้ปุ่มหลักที่ยังกดได้
              side: WidgetStateProperty.resolveWith(
                (states) => states.contains(WidgetState.disabled)
                    ? BorderSide(
                        color: AppColors.primary.withValues(alpha: 0.35),
                      )
                    : null,
              ),
            ),
      ),
      // ปุ่มรอง: ใช้ขอบ inputBorder ที่ผ่าน 3:1 แทน border ตกแต่ง ต่างจาก Web โดยตั้งใจ
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: buttonSize,
          foregroundColor: AppColors.foreground,
          backgroundColor: AppColors.background,
          // ปุ่มรองที่กดไม่ได้ยังต้องอ่านออก ใช้พื้น muted กับข้อความ mutedForeground
          // แทน onSurface 38% ของ Material ซึ่งจางเกินเกณฑ์อ่านข้อความ 4.5:1
          disabledForegroundColor: AppColors.mutedForeground,
          disabledBackgroundColor: AppColors.muted,
          side: const BorderSide(color: AppColors.inputBorder),
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
      // การ์ดของ Material (ที่ยังไม่ได้เปลี่ยนเป็น AppCard) ให้หน้าตาใกล้ AppCard —
      // มุม xl ขอบจาง (เงาทำได้แค่ใน AppCard)
      cardTheme: const CardThemeData(
        color: AppColors.card,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.all(Radius.circular(AppRadius.xl)),
          side: BorderSide(color: AppColors.border),
        ),
      ),
      pageTransitionsTheme: pageTransitions,
      dividerTheme: const DividerThemeData(
        color: AppColors.border,
        thickness: 1,
        space: 1,
      ),
    );
  }
}
