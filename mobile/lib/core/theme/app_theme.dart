import 'package:flutter/material.dart';

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
  static const mockSuccess = Color(0xFF2F8F5B);
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
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
      ),
    );
  }
}
