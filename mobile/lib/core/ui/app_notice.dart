import 'package:flutter/material.dart';

import '../theme/app_tokens.dart';
import 'app_badge.dart';

/// กล่องข้อความแจ้งในหน้า (ส่งสำเร็จ, คำเตือน, error ของฟอร์ม, ข้อมูลประกอบ) แบบ
/// `Notice` ของ Web (`web/src/components/ui/notice.tsx`) — ใช้แทนกล่องที่แต่ละหน้า
/// เขียนสีเองซ้ำๆ (`AppTheme.error.withValues(alpha: 0.06)`, `mockAccentSoft` ฯลฯ)
/// · tone ชุดเดียวกับ [AppBadge] (สีจาก semantic token: พื้น `*-subtle`,
/// ตัวอักษร `*-foreground`, ขอบสีหลักของ tone 30%) · ไม่เปิดให้ส่งสีเอง
///
/// [title] บรรทัดหัวตัวหนา (ไม่ใส่ก็ได้) · [child] เนื้อหา — สีตัวอักษรของ tone
/// ใส่ให้ผ่าน [DefaultTextStyle] ข้อความข้างในไม่ต้องตั้งสีเอง · [icon] ไอคอนนำหน้า
class AppNotice extends StatelessWidget {
  const AppNotice({
    super.key,
    this.tone = AppBadgeTone.info,
    this.title,
    this.child,
    this.icon,
  }) : assert(title != null || child != null, 'ต้องมี title หรือ child');

  final AppBadgeTone tone;
  final String? title;
  final Widget? child;
  final IconData? icon;

  /// ขอบ: สีหลักของ tone 30% (`border-success/30` ฯลฯ ของ Web) · neutral ใช้ `border`
  static Color _borderColor(AppBadgeTone tone) => switch (tone) {
    AppBadgeTone.neutral => AppColors.border,
    AppBadgeTone.success => AppColors.success.withValues(alpha: 0.3),
    AppBadgeTone.warning => AppColors.warning.withValues(alpha: 0.3),
    AppBadgeTone.danger => AppColors.destructive.withValues(alpha: 0.3),
    AppBadgeTone.info => AppColors.info.withValues(alpha: 0.3),
  };

  @override
  Widget build(BuildContext context) {
    final style = tone.style;
    // neutral: ตัวอักษร secondary-foreground เต็ม (ไม่ใช่ 80% แบบป้าย) — เป็นย่อหน้า
    // ให้อ่าน ไม่ใช่ป้ายสั้นๆ
    final foreground = tone == AppBadgeTone.neutral
        ? AppColors.secondaryForeground
        : style.foreground;
    final body = DefaultTextStyle.merge(
      style: TextStyle(
        fontSize: AppTypography.sm,
        height: AppTypography.smHeight,
        color: foreground,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (title != null)
            Text(title!, style: const TextStyle(fontWeight: FontWeight.w600)),
          if (title != null && child != null) const SizedBox(height: 4),
          ?child,
        ],
      ),
    );

    return Container(
      width: double.infinity,
      // px-3.5 py-2.5 ของ Web
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: style.background,
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(color: _borderColor(tone)),
      ),
      child: icon == null
          ? body
          : Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Padding(
                  padding: const EdgeInsets.only(top: 3),
                  child: ExcludeSemantics(
                    child: Icon(icon, size: 16, color: foreground),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(child: body),
              ],
            ),
    );
  }
}

/// error ของฟอร์ม: ข้อความหลัก + รายการรายละเอียดจาก backend (`ApiException.details`)
/// เป็น bullet · ใช้ใน [AppNotice] tone danger ของทุกหน้าฟอร์ม (เดิมแต่ละหน้าเขียน
/// ซ้ำกันเอง)
class AppErrorDetails extends StatelessWidget {
  const AppErrorDetails({
    super.key,
    required this.message,
    this.details = const [],
  });

  final String message;
  final List<String> details;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(message),
        for (final msg in details)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              '• $msg',
              style: const TextStyle(
                fontSize: AppTypography.xs,
                height: AppTypography.xsHeight,
              ),
            ),
          ),
      ],
    );
  }
}
