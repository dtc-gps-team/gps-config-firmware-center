import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/models.dart';
import '../../core/router/app_router.dart';
import '../../core/sync/sync_providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/sync_status_widgets.dart';
import '../task/task_repository.dart';
import '../task/task_status_ui.dart';

/// ส่วนบนสุดของ Home สำหรับช่าง — แยกไฟล์จาก home_page.dart (ไฟล์นั้นมีหลาย PR
/// แก้คนละส่วนอยู่)
///
/// - แถบออฟไลน์เมื่อกำลังแสดงข้อมูลงานจาก cache (UX audit #14)
/// - banner session หมดอายุ / ซิงค์ไม่สำเร็จ (UX audit #15) เดิมมีแค่หน้ารายการงาน
///   ใช้ widget และเงื่อนไขเดียวกับหน้านั้น
/// - แถบสรุป "ค้าง N งาน ด่วน M งาน" แตะแล้วไปหน้างานของฉัน (UX audit #15)
class HomeStatusBanners extends ConsumerWidget {
  const HomeStatusBanners({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final offline = ref.watch(taskListCacheSnapshotProvider);
    final pendingIds = ref.watch(pendingTaskIdsProvider).value ?? const {};
    final failedCount = ref.watch(failedSyncActionsProvider).value?.length ?? 0;
    // เกณฑ์เดียวกับหน้ารายการงาน: เตือนเฉพาะเมื่อมีรายการค้างที่จะหายถ้า logout
    final authExpired =
        ref.watch(syncAuthExpiredProvider) && pendingIds.isNotEmpty;
    final tasks = ref.watch(taskListProvider).valueOrNull;

    final items = <Widget>[
      if (offline != null) OfflineCacheBanner(cachedAt: offline.cachedAt),
      if (authExpired) const SyncAuthExpiredBanner(),
      if (failedCount > 0) SyncFailedBanner(count: failedCount),
      if (tasks != null) _TaskSummary(tasks: tasks),
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
/// [TaskUrgencyStyle] ตัวเดียวกับส่วน "งานค้างวันนี้" และหน้ารายการงาน
class _TaskSummary extends StatelessWidget {
  const _TaskSummary({required this.tasks});

  final List<Task> tasks;

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
    return Material(
      key: const Key('home_task_summary'),
      color: Colors.white,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: () => context.push(AppRoutes.myTasks),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 48),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            child: Row(
              children: [
                Icon(
                  Icons.assignment_outlined,
                  color: urgent > 0 ? AppTheme.error : AppTheme.navy,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    'ค้าง ${open.length} งาน ด่วน $urgent งาน',
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                      color: AppTheme.mockTextPrimary,
                    ),
                  ),
                ),
                const Icon(Icons.chevron_right, color: AppTheme.textSecondary),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
