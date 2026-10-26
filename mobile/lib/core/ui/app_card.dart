import 'package:flutter/material.dart';

import '../theme/app_tokens.dart';

enum AppCardSize {
  /// padding 16 (`--card-spacing: spacing(4)` ของ Web)
  regular,

  /// padding 12 (`data-[size=sm]` ของ Web)
  small,
}

/// การ์ดแบบ `Card` ของ Web (`web/src/components/ui/card.tsx`, docs/22 §7.1) —
/// **ต่างจาก Web (docs/22 §4.6):** ใช้เงานุ่ม [AppShadows.card] + ขอบจาง
/// [AppColors.border] แยกการ์ดจากพื้น แทนขอบ foreground 20% แบบเดิมที่ดูแข็ง ·
/// มุม [AppRadius.xl]
///
/// ใส่ [onTap] = การ์ดกดได้ ระหว่างกดค้างเงาลอยขึ้น ([AppShadows.raised]) ขอบเป็นสี
/// primary จาง และการ์ดยุบลงเล็กน้อย (micro-interaction แทน hover ของ Web) · ไม่ใส่ =
/// การ์ดข้อมูลธรรมดา ไม่ถูกประกาศเป็นปุ่ม · ตั้งลดการเคลื่อนไหวในเครื่อง = ไม่ยุบ
///
/// [highlighted] = พื้น [AppColors.accent] สำหรับแถวที่ยังไม่อ่าน (docs/22 §4.1
/// "แถวที่ยังไม่อ่าน" — มติ B Batch 2) · ใช้คู่กับตัวบ่งชี้อื่นเสมอ (ตัวหนา / จุด)
/// เพราะสีพื้นต่างจากการ์ดปกติเล็กน้อย ไม่ควรเป็นสิ่งเดียวที่บอกสถานะ
class AppCard extends StatefulWidget {
  const AppCard({
    super.key,
    required this.child,
    this.onTap,
    this.size = AppCardSize.regular,
    this.highlighted = false,
  });

  final Widget child;
  final VoidCallback? onTap;
  final AppCardSize size;
  final bool highlighted;

  /// ขอบตอนกดค้าง
  static final pressedBorder = AppColors.primary.withValues(alpha: 0.35);

  /// ขนาดตอนกดค้าง (ยุบลง 1.5%)
  static const pressedScale = 0.985;

  @override
  State<AppCard> createState() => _AppCardState();
}

class _AppCardState extends State<AppCard> {
  var _pressed = false;

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(AppRadius.xl);
    final padding = EdgeInsets.all(
      widget.size == AppCardSize.small ? AppSpacing.md : AppSpacing.lg,
    );
    final interactive = widget.onTap != null;
    final pressed = interactive && _pressed;
    final animate = !MediaQuery.of(context).disableAnimations;
    final duration = animate ? AppMotion.fast : Duration.zero;
    final content = Padding(padding: padding, child: widget.child);

    return AnimatedScale(
      scale: pressed && animate ? AppCard.pressedScale : 1,
      duration: duration,
      curve: AppMotion.curve,
      child: AnimatedContainer(
        duration: duration,
        curve: AppMotion.curve,
        decoration: BoxDecoration(
          borderRadius: radius,
          boxShadow: pressed ? AppShadows.raised : AppShadows.card,
        ),
        child: Material(
          color: widget.highlighted ? AppColors.accent : AppColors.card,
          elevation: 0,
          clipBehavior: Clip.antiAlias,
          shape: RoundedRectangleBorder(
            borderRadius: radius,
            side: BorderSide(
              color: pressed ? AppCard.pressedBorder : AppColors.border,
            ),
          ),
          // InkWell ไม่ประกาศตัวเป็นปุ่มให้ screen reader เอง ต้องใส่ button เอง
          child: interactive
              ? Semantics(
                  button: true,
                  child: InkWell(
                    onTap: widget.onTap,
                    onHighlightChanged: (value) =>
                        setState(() => _pressed = value),
                    child: content,
                  ),
                )
              : content,
        ),
      ),
    );
  }
}
