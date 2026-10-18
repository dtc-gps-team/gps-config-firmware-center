import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/router/app_router.dart';
import '../../core/sync/sync_providers.dart';
import '../../core/widgets/sync_status_widgets.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/app_error_view.dart';
import '../../core/widgets/skeleton_card.dart';
import '../../core/widgets/text_scale.dart';
import 'task_repository.dart';
import 'task_status_ui.dart';

String _formatDate(DateTime dt) {
  final d = dt.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(d.day)}/${two(d.month)}/${d.year}';
}

/// "งานของฉัน" — full-screen list of the tasks the backend self-scopes to the
/// caller for ST/OT (`GET /tasks`, no date filter). Opened from the Home
/// shortcut. Uses the **same** `taskListProvider` as the "งานวันนี้" preview on
/// Home — one data set, two places it renders (Home keeps its preview).
class TaskListPage extends ConsumerWidget {
  const TaskListPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tasksAsync = ref.watch(taskListProvider);
    final pendingIds = ref.watch(pendingTaskIdsProvider).value ?? const {};
    final failedCount = ref.watch(failedSyncActionsProvider).value?.length ?? 0;
    final authExpired =
        ref.watch(syncAuthExpiredProvider) && pendingIds.isNotEmpty;
    // UX audit #14 — ออฟไลน์ กำลังแสดง cache ในเครื่อง
    final offline = ref.watch(taskListCacheSnapshotProvider);

    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        backgroundColor: AppTheme.navy,
        foregroundColor: Colors.white,
        elevation: 0,
        title: const Text('งานของฉัน'),
      ),
      body: RefreshIndicator(
        // await refetch จริง (pattern เดียวกับ DeviceSearchPage #137) —
        // spinner ค้างจนข้อมูลใหม่มา ไม่หายก่อน
        onRefresh: () => ref.refresh(taskListProvider.future),
        child: tasksAsync.when(
          skipLoadingOnRefresh: true,
          data: (rawTasks) {
            if (rawTasks.isEmpty) return const _TasksEmpty();
            // เรียงงานเลยกำหนด/ใกล้ถึงกำหนดไว้บนสุด (Mobile UI Roadmap Phase 1
            // — เกณฑ์เดียวกับ Home "งานค้างวันนี้" ใช้ shared helper ตัวเดียวกัน
            // กันไม่ให้สองหน้าตัดสิน "เร่งด่วน" ต่างกัน)
            final tasks = TaskUrgencyStyle.sorted(rawTasks);
            final offlineRow = offline == null ? 0 : 1;
            final offset =
                offlineRow + (failedCount > 0 ? 1 : 0) + (authExpired ? 1 : 0);
            return ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: tasks.length + offset,
              separatorBuilder: (_, _) => const SizedBox(height: 10),
              itemBuilder: (context, i) {
                if (offline != null && i == 0) {
                  return OfflineCacheBanner(cachedAt: offline.cachedAt);
                }
                if (authExpired && i == offlineRow) {
                  return const SyncAuthExpiredBanner();
                }
                if (failedCount > 0 &&
                    i == offlineRow + (authExpired ? 1 : 0)) {
                  return SyncFailedBanner(count: failedCount);
                }
                final task = tasks[i - offset];
                return _TaskCard(
                  key: Key('my_task_card_${i - offset}'),
                  task: task,
                  pendingSync: pendingIds.contains(task.id),
                  onTap: () => context.push(AppRoutes.taskDetail(task.id)),
                );
              },
            );
          },
          loading: () => ListView.separated(
            padding: const EdgeInsets.all(16),
            itemCount: 5,
            separatorBuilder: (_, _) => const SizedBox(height: 10),
            itemBuilder: (_, _) => const SkeletonCard(),
          ),
          error: (error, _) => _TasksError(
            message: error is ApiException ? error.message : 'โหลดงานไม่สำเร็จ',
            onRetry: () => ref.invalidate(taskListProvider),
          ),
        ),
      ),
    );
  }
}

class _TaskCard extends StatelessWidget {
  const _TaskCard({
    super.key,
    required this.task,
    required this.onTap,
    this.pendingSync = false,
  });

  final Task task;
  final bool pendingSync;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final urgency = TaskUrgencyStyle.of(task);
    final (urgencyBg, urgencyFg) = TaskUrgencyStyle.colors(urgency);
    // ตัวอักษรใหญ่: ป้ายสถานะย้ายจากด้านขวามาอยู่ใต้รายละเอียด (UX audit #9)
    // ไม่งั้นป้ายกินความกว้างจนการ์ดล้นขอบและวันที่ขึ้นบรรทัดใหม่กลางตัวเลข
    final largeText = isLargeTextScale(context);
    final badges = Column(
      crossAxisAlignment: largeText
          ? CrossAxisAlignment.start
          : CrossAxisAlignment.end,
      children: [
        TaskStatusPill(status: task.status),
        if (pendingSync) ...[
          const SizedBox(height: 6),
          const PendingSyncBadge(),
        ],
      ],
    );
    return Material(
      color: AppTheme.surface,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          decoration: urgency == TaskUrgency.none
              ? null
              : BoxDecoration(
                  borderRadius: BorderRadius.circular(12),
                  border: Border(left: BorderSide(color: urgencyFg, width: 4)),
                ),
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      task.title,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                        color: AppTheme.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'อุปกรณ์: ${task.deviceId ?? '—'}',
                      style: const TextStyle(
                        fontSize: 13,
                        color: AppTheme.textSecondary,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'กำหนดส่ง: '
                      '${task.dueDate == null ? '—' : _formatDate(task.dueDate!)}',
                      style: const TextStyle(
                        fontSize: 13,
                        color: AppTheme.textSecondary,
                      ),
                    ),
                    if (urgency != TaskUrgency.none) ...[
                      const SizedBox(height: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 3,
                        ),
                        decoration: BoxDecoration(
                          color: urgencyBg,
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              TaskUrgencyStyle.icon(urgency),
                              size: 13,
                              color: urgencyFg,
                            ),
                            const SizedBox(width: 4),
                            // Flexible: ตัวอักษรใหญ่ / จอแคบ ข้อความขึ้นบรรทัด
                            // ใหม่แทนล้นขอบ (UX audit #9) ไม่ตัดด้วย ellipsis
                            // เพราะเป็นข้อความสั้นที่ช่างใช้จัดลำดับงาน
                            Flexible(
                              child: Text(
                                TaskUrgencyStyle.label(urgency),
                                style: TextStyle(
                                  fontSize: 11,
                                  fontWeight: FontWeight.w700,
                                  color: urgencyFg,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                    if (largeText) ...[const SizedBox(height: 8), badges],
                  ],
                ),
              ),
              if (!largeText) ...[const SizedBox(width: 12), badges],
            ],
          ),
        ),
      ),
    );
  }
}

class _TasksEmpty extends StatelessWidget {
  const _TasksEmpty();

  @override
  Widget build(BuildContext context) {
    return ListView(
      children: const [
        SizedBox(height: 80),
        Center(
          child: Column(
            children: [
              Icon(Icons.inbox_outlined, color: AppTheme.textSecondary),
              SizedBox(height: 8),
              Text(
                'ยังไม่มีงานที่ได้รับมอบหมาย',
                key: Key('my_tasks_empty'),
                style: TextStyle(fontSize: 13, color: AppTheme.textSecondary),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _TasksError extends StatelessWidget {
  const _TasksError({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return ListView(
      children: [
        const SizedBox(height: 64),
        AppErrorView(
          message: message,
          onRetry: onRetry,
          messageKey: const Key('my_tasks_error'),
          retryKey: const Key('my_tasks_retry'),
        ),
      ],
    );
  }
}
