import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/models.dart';
import '../../core/sync/sync_providers.dart';
import '../../core/theme/app_tokens.dart';
import '../../core/ui/app_card.dart';
import '../../core/widgets/sync_status_widgets.dart';
import '../task/task_repository.dart';
import '../task/task_status_ui.dart';

/// ส่วนบนสุดของหน้าแรกสำหรับช่าง — แยกไฟล์จาก home_page.dart
///
/// - แถบออฟไลน์เมื่อกำลังแสดงข้อมูลงานจาก cache (UX audit #14)
/// - banner session หมดอายุ / ซิงค์ไม่สำเร็จ (UX audit #15)
/// - แถบสรุป "ค้าง N งาน ด่วน M งาน" — หน้า "งานของฉัน" ถูกรวมเข้าหน้าแรกแล้ว
///   (docs/22 §7.2) แตะแล้วเลื่อนไปส่วน "ต้องทำ" บนหน้าเดียวกัน ([onSummaryTap])
class HomeStatusBanners extends ConsumerWidget {
  const HomeStatusBanners({super.key, this.onSummaryTap});

  final VoidCallback? onSummaryTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final offline = ref.watch(taskListCacheSnapshotProvider);
    final pendingIds = ref.watch(pendingTaskIdsProvider).value ?? const {};
    final failedCount = ref.watch(failedSyncActionsProvider).value?.length ?? 0;
    // เตือนเฉพาะเมื่อมีรายการค้างที่จะหายถ้า logout
    final authExpired =
        ref.watch(syncAuthExpiredProvider) && pendingIds.isNotEmpty;
    final tasks = ref.watch(taskListProvider).valueOrNull;

    final items = <Widget>[
      if (offline != null) OfflineCacheBanner(cachedAt: offline.cachedAt),
      if (authExpired) const SyncAuthExpiredBanner(),
      if (failedCount > 0) SyncFailedBanner(count: failedCount),
      if (tasks != null) _TaskSummary(tasks: tasks, onTap: onSummaryTap),
    ];
    if (items.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final (i, item) in items.indexed) ...[
            if (i > 0) const SizedBox(height: 10),
            item,
          ],
        ],
      ),
    );
  }
}

/// งานค้าง = ยังไม่เสร็จและไม่ถูกยกเลิก · ด่วน = เลยกำหนด/ใกล้ถึงกำหนด ใช้เกณฑ์
/// [TaskUrgencyStyle] ตัวเดียวกับการเรียงส่วน "ต้องทำ"
class _TaskSummary extends StatelessWidget {
  const _TaskSummary({required this.tasks, this.onTap});

  final List<Task> tasks;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final open = tasks
        .where(
          (t) =>
              t.status != TaskStatus.completed &&
              t.status != TaskStatus.cancelled,
        )
        .toList();
    final urgent = open.where(TaskUrgencyStyle.isUrgent).length;
    return AppCard(
      key: const Key('home_task_summary'),
      size: AppCardSize.small,
      onTap: onTap,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 24),
        child: Row(
          children: [
            Icon(
              Icons.assignment_outlined,
              color: urgent > 0 ? AppColors.destructive : AppColors.primary,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                'ค้าง ${open.length} งาน ด่วน $urgent งาน',
                style: const TextStyle(
                  fontSize: AppTypography.sm,
                  height: AppTypography.smHeight,
                  fontWeight: FontWeight.w600,
                  color: AppColors.foreground,
                ),
              ),
            ),
            const Icon(Icons.arrow_downward, color: AppColors.mutedForeground),
          ],
        ),
      ),
    );
  }
}
