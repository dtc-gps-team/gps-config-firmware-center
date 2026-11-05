import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../theme/app_tokens.dart';

/// หัวหน้าลูกพื้นเข้มตามภาพ r4 (Device Detail / ประวัติเครื่อง · R4-04) — โทนเดียวกับ
/// หัว Home (R4-02) แต่เตี้ยกว่า: ปุ่มกลับ ชื่อหน้า และบรรทัดรอง
/// ชื่อหน้าตัดได้ไม่เกิน 2 บรรทัด ข้อความใหญ่ยังอ่านครบด้วย Semantics ของ header
class AppInkHeader extends StatelessWidget {
  const AppInkHeader({
    super.key,
    required this.title,
    this.titleKey,
    this.subtitle,
    this.onBack,
    this.trailing,
  });

  final String title;
  final Key? titleKey;
  final String? subtitle;
  final VoidCallback? onBack;
  final Widget? trailing;

  static const double radius = 32;

  @override
  Widget build(BuildContext context) {
    final subtitle = this.subtitle;
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: Container(
        key: const Key('app_ink_header'),
        decoration: const BoxDecoration(
          color: AppColors.primary,
          borderRadius: BorderRadius.vertical(bottom: Radius.circular(radius)),
        ),
        child: SafeArea(
          bottom: false,
          child: Padding(
            padding: EdgeInsets.fromLTRB(onBack == null ? 20 : 4, 8, 20, 22),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (onBack != null)
                  IconButton(
                    key: const Key('app_ink_header_back'),
                    tooltip: 'ย้อนกลับ',
                    onPressed: onBack,
                    color: AppColors.onInk,
                    icon: const Icon(Icons.arrow_back),
                  ),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Semantics(
                          header: true,
                          child: Text(
                            key: titleKey,
                            title,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 20,
                              height: 1.3,
                              fontWeight: FontWeight.w700,
                              color: AppColors.onInk,
                            ),
                          ),
                        ),
                        if (subtitle != null) ...[
                          const SizedBox(height: 6),
                          Text(
                            subtitle,
                            style: const TextStyle(
                              fontSize: 13,
                              height: 1.4,
                              color: AppColors.onInkMuted,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
                if (trailing != null) ...[const SizedBox(width: 8), trailing!],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
