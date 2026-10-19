import 'package:flutter/material.dart';

import '../theme/app_tokens.dart';

enum AppCardSize {
  /// padding 16 (`--card-spacing: spacing(4)` ของ Web)
  regular,

  /// padding 12 (`data-[size=sm]` ของ Web)
  small,
}

/// การ์ดแบบ `Card` ของ Web (`web/src/components/ui/card.tsx`, docs/22 §7.1) —
/// **ขอบบาง ไม่มีเงา** โดยตั้งใจ ใช้แทน `mockShadowCard` / `mockShadowRow` เดิม
///
/// ขอบ = [AppColors.foreground] 20% (Web คำนวณไว้ว่า /10 จางจนแทบมองไม่เห็น)
/// · ใส่ [onTap] = การ์ดกดได้ ขอบเข้มขึ้นเป็น 40% ระหว่างกดค้าง แทน hover ของ
/// Web ที่มือถือไม่มี · ไม่ใส่ = การ์ดข้อมูลธรรมดา ไม่ถูกประกาศเป็นปุ่ม
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

  @override
  State<AppCard> createState() => _AppCardState();
}

class _AppCardState extends State<AppCard> {
  var _pressed = false;

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(AppRadius.lg);
    final padding = EdgeInsets.all(widget.size == AppCardSize.small ? 12 : 16);
    final interactive = widget.onTap != null;
    final content = Padding(padding: padding, child: widget.child);

    return Material(
      color: widget.highlighted ? AppColors.accent : AppColors.card,
      elevation: 0,
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(
        borderRadius: radius,
        side: BorderSide(
          color: AppColors.foreground.withValues(
            alpha: interactive && _pressed ? 0.4 : 0.2,
          ),
        ),
      ),
      // InkWell ไม่ประกาศตัวเป็นปุ่มให้ screen reader เอง ต้องใส่ button เอง
      child: interactive
          ? Semantics(
              button: true,
              child: InkWell(
                onTap: widget.onTap,
                onHighlightChanged: (value) => setState(() => _pressed = value),
                child: content,
              ),
            )
          : content,
    );
  }
}
