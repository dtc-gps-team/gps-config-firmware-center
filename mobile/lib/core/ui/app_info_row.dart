import 'package:flutter/material.dart';

import '../theme/app_tokens.dart';

/// แถว label / value ในหน้ารายละเอียด แบบ `InfoRow` ของ Web
/// (`web/src/components/info-row.tsx`, docs/22 §7.1) — label สีเทาชิดซ้าย (+ icon
/// เล็กได้) ค่าชิดขวา · ค่าไม่พอที่ข้าง label จะขึ้นบรรทัดใหม่ใต้ label · ขนาด
/// `sm` ระยะบนล่าง 6 (`py-1.5`)
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

  /// ที่ว่างที่ [SelectableText] กันไว้ขวาข้อความให้ cursor (กว้าง 2 + ช่องห่าง 1
  /// ของ `RenderEditable`) — เทสเทียบขอบขวาจริงไว้ ถ้า Flutter เปลี่ยนค่าเทสจะแดง
  static const caretInset = 3.0;

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
            // SelectableText กว้างเต็มที่ที่ได้เสมอ — IntrinsicWidth ให้กว้างเท่าข้อความ
            // จะได้อยู่บรรทัดเดียวกับ label ได้
            ? IntrinsicWidth(
                child: SelectableText(text, key: valueKey, style: _style),
              )
            // SelectableText กันที่ขวาไว้ให้ cursor ([caretInset]) ค่าธรรมดาเว้นเท่ากัน
            // ขอบขวาของค่าทุกแถวในการ์ดจึงตรงกัน
            : Padding(
                padding: const EdgeInsets.only(right: caretInset),
                child: Text(text, key: valueKey, style: _style),
              ));

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      // label กับค่าอยู่บรรทัดเดียวกัน (label ซ้าย ค่าชิดขวา) เมื่อพอดี — ถ้าไม่พอ ค่า
      // ทั้งก้อนขึ้นบรรทัดใหม่ใต้ label แทนการบีบ label ให้ตัดบรรทัด (label ยาวอย่าง
      // "Firmware ที่เกี่ยวข้อง" กับค่า "-" จึงไม่ wrap โดยไม่จำเป็น)
      // Wrap กว้างเท่าเนื้อหา — ขยายเต็มแถว (แบบ Row + Expanded เดิม) ค่าจึงชิดขวาได้
      // แม้ parent จะไม่ stretch
      child: SizedBox(
        width: double.infinity,
        child: Wrap(
          alignment: WrapAlignment.spaceBetween,
          spacing: 16,
          runSpacing: 2,
          children: [
            Row(
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
            valueWidget,
          ],
        ),
      ),
    );
  }
}
