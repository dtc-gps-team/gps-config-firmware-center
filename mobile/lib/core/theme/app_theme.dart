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
