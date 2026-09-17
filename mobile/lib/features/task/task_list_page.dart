import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/router/app_router.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/app_error_view.dart';
import 'task_repository.dart';
import 'task_status_ui.dart';

/// "งานของฉัน" — full-screen list of the tasks the backend self-scopes to the
/// caller for ST/OT (`GET /tasks`, no date filter). Opened from the Home
/// shortcut. Uses the **same** `taskListProvider` as the "งานวันนี้" preview on
/// Home — one data set, two places it renders (Home keeps its preview).
class TaskListPage extends ConsumerWidget {
  const TaskListPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tasksAsync = ref.watch(taskListProvider);

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
          data: (tasks) {
            if (tasks.isEmpty) return const _TasksEmpty();
            return ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: tasks.length,
              separatorBuilder: (_, _) => const SizedBox(height: 10),
              itemBuilder: (context, i) => _TaskCard(
                key: Key('my_task_card_$i'),
                task: tasks[i],
                onTap: () => context.push(AppRoutes.taskDetail(tasks[i].id)),
              ),
            );
          },
          loading: () => const Center(child: CircularProgressIndicator()),
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
  const _TaskCard({super.key, required this.task, required this.onTap});

  final Task task;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppTheme.surface,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
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
                  ],
                ),
              ),
              const SizedBox(width: 12),
              TaskStatusPill(status: task.status),
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
