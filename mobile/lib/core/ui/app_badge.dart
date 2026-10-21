import 'package:flutter/material.dart';

import '../theme/app_tokens.dart';

/// tone ของ [AppBadge] — ชุดเดียวกับ `BadgeTone` ของ Web
/// (`web/src/components/ui/badge.tsx`, docs/22 §5.1)
///
/// กติกาเลือก tone (ตาม Web):
/// - success / warning / danger / info = สถานะที่ผู้ใช้ต้องรู้ความหมายของสี
/// - neutral = ทุกอย่างที่ไม่ใช่สถานะ (ประเภท, protocol, จำนวน)
///
/// mapping สถานะ → tone อยู่ใน `status_tones.dart`
enum AppBadgeTone { neutral, success, warning, danger, info }

/// สีของแต่ละ tone — เปิดให้อ่านได้เพื่อเทส contrast ไม่ใช่ให้หน้าไปหยิบสีเอง
typedef AppBadgeStyle = ({Color background, Color foreground, Color dot});

extension AppBadgeToneStyle on AppBadgeTone {
  AppBadgeStyle get style => switch (this) {
    AppBadgeTone.neutral => (
      background: AppColors.secondary,
      foreground: AppColors.secondaryForeground.withValues(alpha: 0.8),
      dot: AppColors.mutedForeground.withValues(alpha: 0.6),
    ),
    AppBadgeTone.success => (
      background: AppColors.successSubtle,
      foreground: AppColors.successForeground,
      dot: AppColors.success,
    ),
    AppBadgeTone.warning => (
      background: AppColors.warningSubtle,
      foreground: AppColors.warningForeground,
      dot: AppColors.warning,
    ),
    AppBadgeTone.danger => (
      background: AppColors.dangerSubtle,
      foreground: AppColors.dangerForeground,
      dot: AppColors.destructive,
    ),
    AppBadgeTone.info => (
      background: AppColors.infoSubtle,
      foreground: AppColors.infoForeground,
      dot: AppColors.info,
    ),
  };
}

/// ป้ายสั้นๆ (สถานะ, จำนวน, ประเภท) แบบ `Badge` ของ Web — **รับสีได้แค่ [tone]**
/// ไม่เปิดให้ส่งสีเองผ่าน prop (Web ตั้งใจจำกัดไว้ กันป้ายแต่ละหน้าโทนเพี้ยนกัน)
///
/// [dot] ใส่จุดสีหน้าข้อความ — **ป้ายสถานะใส่เสมอ** เพื่อไม่ให้สีเป็นสิ่งเดียวที่
/// สื่อความหมาย (docs/22 §5.1) · จุดเป็นของตกแต่ง screen reader อ่านแค่ [label]
class AppBadge extends StatelessWidget {
  const AppBadge({
    super.key,
    required this.label,
    this.tone = AppBadgeTone.neutral,
    this.dot = false,
  });

  final String label;
  final AppBadgeTone tone;
  final bool dot;

  @override
  Widget build(BuildContext context) {
    final style = tone.style;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: style.background,
        borderRadius: BorderRadius.circular(AppRadius.full),
      ),
      child: Padding(
        // ต่างจาก Web (px-2 py-0.5) — กว้างขึ้นนิด ตัวหนาขึ้น อ่านง่ายบนมือถือ (§4.6)
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (dot) ...[
              ExcludeSemantics(
                child: Container(
                  key: const Key('app_badge_dot'),
                  width: 6,
                  height: 6,
                  decoration: BoxDecoration(
                    color: style.dot,
                    shape: BoxShape.circle,
                  ),
                ),
              ),
              const SizedBox(width: 6),
            ],
            // Web: whitespace-nowrap — บรรทัดเดียว ที่แคบตัดด้วย … แทนการล้น
            Flexible(
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: AppTypography.xs,
                  height: AppTypography.xsHeight,
                  fontWeight: FontWeight.w600,
                  color: style.foreground,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
