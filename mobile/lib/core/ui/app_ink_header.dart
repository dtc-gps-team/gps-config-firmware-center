import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../theme/app_tokens.dart';

/// หัวพื้นเข้มของหน้าลูกใน Mobile r4 พร้อมปุ่มกลับและ action ที่ใช้ร่วมกันได้.
class AppInkHeader extends StatelessWidget {
  const AppInkHeader({
    super.key,
    required this.title,
    this.subtitle,
    this.onBack,
    this.trailing,
  });

  final String title;
  final String? subtitle;
  final VoidCallback? onBack;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: Container(
        key: const Key('app_ink_header'),
        decoration: const BoxDecoration(
          color: AppColors.primary,
          borderRadius: BorderRadius.vertical(
            bottom: Radius.circular(AppRadius.xxl),
          ),
        ),
        child: SafeArea(
          bottom: false,
          child: Padding(
            padding: EdgeInsets.fromLTRB(
              onBack == null ? AppSpacing.lg : 0,
              AppSpacing.xs,
              AppSpacing.lg,
              AppSpacing.lg,
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (onBack != null)
                  IconButton(
                    key: const Key('app_ink_header_back'),
                    tooltip: 'ย้อนกลับ',
                    color: AppColors.onInk,
                    icon: const Icon(Icons.arrow_back),
                    onPressed: onBack,
                  ),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.only(top: AppSpacing.sm),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Semantics(
                          header: true,
                          child: Text(
                            title,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: AppTypography.xl,
                              height: AppTypography.xlHeight,
                              fontWeight: FontWeight.w700,
                              color: AppColors.onInk,
                            ),
                          ),
                        ),
                        if (subtitle != null) ...[
                          const SizedBox(height: AppSpacing.xs),
                          Text(
                            subtitle!,
                            style: const TextStyle(
                              fontSize: AppTypography.xs,
                              height: AppTypography.xsHeight,
                              color: AppColors.onInkMuted,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
                if (trailing != null) ...[
                  const SizedBox(width: AppSpacing.sm),
                  trailing!,
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
