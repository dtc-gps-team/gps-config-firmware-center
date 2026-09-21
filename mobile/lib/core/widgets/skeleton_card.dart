import 'package:flutter/material.dart';
import 'package:shimmer/shimmer.dart';

import '../theme/app_theme.dart';

/// Shimmering placeholder card for list-loading states (first load only —
/// `skipLoadingOnRefresh: true` on the callers keeps this off pull-to-refresh).
/// Sized/rounded to match the real task/device cards (`borderRadius: 12`) so
/// the swap from skeleton to real data doesn't jump the layout.
class SkeletonCard extends StatelessWidget {
  const SkeletonCard({super.key, this.height = 72});

  final double height;

  @override
  Widget build(BuildContext context) {
    return Shimmer.fromColors(
      baseColor: AppTheme.fieldBorder,
      highlightColor: AppTheme.surface,
      child: Container(
        height: height,
        decoration: BoxDecoration(
          color: AppTheme.surface,
          borderRadius: BorderRadius.circular(12),
        ),
      ),
    );
  }
}
