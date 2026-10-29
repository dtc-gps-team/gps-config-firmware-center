import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/models.dart';
import '../../core/sync/sync_providers.dart';
import '../../core/theme/app_tokens.dart';

import '../../core/widgets/sync_status_widgets.dart';
import '../task/task_repository.dart';
import '../task/task_status_ui.dart';
import 'home_tokens.dart';

/// ส่วนบนสุดของหน้าแรกสำหรับช่าง — แยกไฟล์จาก home_page.dart
///
/// - แถบออฟไลน์เมื่อกำลังแสดงข้อมูลงานจาก cache (UX audit #14)
/// - banner session หมดอายุ / ซิงค์ไม่สำเร็จ (UX audit #15)
/// - แถบสรุป "ค้าง N งาน ด่วน M งาน" — หน้า "งานของฉัน" ถูกรวมเข้าหน้าแรกแล้ว
///   (docs/22 §7.2) แตะเพื่อเปิดรายการเต็มที่กรองงานยังไม่เสร็จ ([onSummaryTap])
class HomeStatusBanners extends ConsumerWidget {
  const HomeStatusBanners({
    super.key,
    this.onSummaryTap,
    this.showSummary = true,
    this.showBanners = true,
  });

  final VoidCallback? onSummaryTap;
  final bool showSummary;
  final bool showBanners;

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
      if (showBanners && offline != null)
        OfflineCacheBanner(cachedAt: offline.cachedAt),
      if (showBanners && authExpired) const SyncAuthExpiredBanner(),
      if (showBanners && failedCount > 0) SyncFailedBanner(count: failedCount),
      if (tasks != null &&
          showSummary &&
          tasks.any(
            (t) =>
                t.status == TaskStatus.pending ||
                t.status == TaskStatus.inProgress,
          ))
        _TaskSummary(tasks: tasks, onTap: onSummaryTap),
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
    final large =
        MediaQuery.textScalerOf(context).scale(1) >= HomeTokens.largeTextScale;
    if (open.isEmpty) return const SizedBox.shrink();
    return Material(
      key: const Key('home_task_summary'),
      color: AppColors.accent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppRadius.lg),
        side: const BorderSide(color: AppColors.border),
      ),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppRadius.lg),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          child: Row(
            children: [
              const Icon(
                Icons.schedule,
                size: 20,
                color: AppColors.accentForeground,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (!large)
                      Text(
                        'มี ${open.length} งานที่ยังไม่เสร็จ',
                        style: const TextStyle(
                          fontSize: 13,
                          height: 1.4,
                          fontWeight: FontWeight.w600,
                          color: AppColors.accentForeground,
                        ),
                      ),
                    Text(
                      'ค้าง ${open.length} งาน ด่วน $urgent งาน',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 12,
                        height: 1.4,
                        color: AppColors.mutedForeground,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 4),
              const Icon(
                Icons.chevron_right,
                size: 18,
                color: AppColors.accentForeground,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
