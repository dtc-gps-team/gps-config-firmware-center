import 'package:flutter/material.dart';

import '../theme/app_tokens.dart';

/// แถว label / value ในหน้ารายละเอียด แบบ `InfoRow` ของ Web
/// (`web/src/components/info-row.tsx`, docs/22 §7.1) — label สีเทาชิดซ้าย (+ icon
/// เล็กได้) ค่าชิดขวา ตัดบรรทัดได้ · ขนาด `sm` ระยะบนล่าง 6 (`py-1.5`)
///
/// ส่ง [value] เป็นข้อความ (null / ว่าง แสดง "-" เพราะ backend ไม่ส่ง field ที่
/// ไม่มีค่า) หรือส่ง [child] เป็น widget เอง เช่นลิงก์ไปหน้าอื่น
class AppInfoRow extends StatelessWidget {
  const AppInfoRow({
    super.key,
    required this.label,
    this.value,
    this.child,
    this.icon,
    this.valueKey,
    this.selectable = false,
  }) : assert(
         value == null || child == null,
         'ส่ง value หรือ child อย่างใดอย่างหนึ่ง',
       );

  final String label;
  final String? value;
  final Widget? child;
  final IconData? icon;

  /// ให้หน้าที่ใช้คง `Key` เดิมที่เทสอ้างถึงได้
  final Key? valueKey;

  /// ให้ลากเลือก/คัดลอกค่าได้ (เช่น id ที่ช่างต้องเอาไปแจ้งต่อ)
  final bool selectable;

  static const _style = TextStyle(
    fontSize: AppTypography.sm,
    height: AppTypography.smHeight,
    color: AppColors.foreground,
  );

  @override
  Widget build(BuildContext context) {
    final text = (value == null || value!.isEmpty) ? '-' : value!;
    final valueWidget =
        child ??
        (selectable
            ? SelectableText(
                text,
                key: valueKey,
                textAlign: TextAlign.right,
                style: _style,
              )
            : Text(
                text,
                key: valueKey,
                textAlign: TextAlign.right,
                style: _style,
              ));

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        // ช่องที่ label ไม่ได้ใช้ (ส่วนที่เหลือจาก 2/5) ไปอยู่ตรงกลาง ค่าจึงชิดขวาเสมอ
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // label (+ icon) ได้สูงสุด 2/5 ของความกว้างแล้วตัดบรรทัด (Web ใช้
          // shrink-0 ซึ่งบนจอมือถือแคบ label ยาวจะดันจนแถวล้น) ค่าได้ที่เหลือ
          Flexible(
            flex: 2,
            child: Row(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (icon != null) ...[
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Icon(
                      icon,
                      size: 14,
                      color: AppColors.mutedForeground,
                    ),
                  ),
                  const SizedBox(width: 6),
                ],
                Flexible(
                  child: Text(
                    label,
                    style: _style.copyWith(color: AppColors.mutedForeground),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 16),
          Expanded(
            flex: 3,
            child: Align(alignment: Alignment.topRight, child: valueWidget),
          ),
        ],
      ),
    );
  }
}
