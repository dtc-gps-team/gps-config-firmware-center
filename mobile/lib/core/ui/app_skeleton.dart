import 'package:flutter/material.dart';

import '../theme/app_tokens.dart';
import 'app_card.dart';

/// กล่องเทาจำลองข้อความระหว่างรอ fetch ครั้งแรก แบบ `Skeleton` ของ Web
/// (`bg-muted animate-pulse rounded-md`) — กะพริบช้าๆ แทนข้อความ "กำลังโหลด…"
/// · ปิดการเคลื่อนไหวเมื่อเครื่องตั้งลดการเคลื่อนไหว (`disableAnimations`)
class AppSkeletonBox extends StatefulWidget {
  const AppSkeletonBox({super.key, required this.height, this.widthFactor = 1});

  final double height;

  /// ความกว้างเป็นสัดส่วนของพื้นที่ (Web ใช้ `w-1/3`, `w-2/3`, `w-1/2`)
  final double widthFactor;

  @override
  State<AppSkeletonBox> createState() => _AppSkeletonBoxState();
}

class _AppSkeletonBoxState extends State<AppSkeletonBox>
    with SingleTickerProviderStateMixin {
  late final _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1000),
    lowerBound: 0.5,
  );

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.of(context).disableAnimations) {
      _controller
        ..stop()
        ..value = 1;
    } else if (!_controller.isAnimating) {
      _controller.repeat(reverse: true);
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FractionallySizedBox(
      alignment: Alignment.centerLeft,
      widthFactor: widget.widthFactor,
      child: FadeTransition(
        opacity: _controller,
        child: Container(
          height: widget.height,
          decoration: BoxDecoration(
            color: AppColors.muted,
            borderRadius: BorderRadius.circular(AppRadius.md),
          ),
        ),
      ),
    );
  }
}

/// skeleton ของรายการแบบการ์ด แบบ `CardListSkeleton` ของ Web — การ์ดว่าง [count]
/// ใบ แต่ละใบมีแถบ 3 เส้น (หัวข้อ 1/3, บรรทัด 2/3, บรรทัด 1/2) · ใช้แทน
/// `SkeletonCard` เดิมในหน้าที่ย้ายแล้ว (docs/22 §7.1)
class AppListSkeleton extends StatelessWidget {
  const AppListSkeleton({super.key, this.count = 3, this.padding});

  final int count;
  final EdgeInsetsGeometry? padding;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'กำลังโหลด',
      child: ExcludeSemantics(
        child: ListView.separated(
          padding: padding ?? const EdgeInsets.all(16),
          physics: const NeverScrollableScrollPhysics(),
          itemCount: count,
          separatorBuilder: (_, _) => const SizedBox(height: 12),
          itemBuilder: (_, _) => const AppCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                AppSkeletonBox(height: 20, widthFactor: 1 / 3),
                SizedBox(height: 8),
                AppSkeletonBox(height: 16, widthFactor: 2 / 3),
                SizedBox(height: 8),
                AppSkeletonBox(height: 16, widthFactor: 1 / 2),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// skeleton ของหน้ารายละเอียด แบบ `DetailSkeleton` ของ Web — หัวข้อ 1 แถบ +
/// เนื้อหา [lines] บรรทัดในการ์ด
class AppDetailSkeleton extends StatelessWidget {
  const AppDetailSkeleton({super.key, this.lines = 4, this.padding});

  final int lines;
  final EdgeInsetsGeometry? padding;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'กำลังโหลด',
      child: ExcludeSemantics(
        child: Padding(
          padding: padding ?? const EdgeInsets.all(16),
          child: AppCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                const AppSkeletonBox(height: 28, widthFactor: 0.5),
                const SizedBox(height: 16),
                for (var i = 0; i < lines; i++) ...[
                  if (i > 0) const SizedBox(height: 12),
                  const AppSkeletonBox(height: 16),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
