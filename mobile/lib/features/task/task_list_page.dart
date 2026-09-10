import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/router/app_router.dart';
import 'task_repository.dart';
import 'task_status_ui.dart';

/// "งานของฉัน" palette. Scoped to this file, same values as Home / Task Detail.
class _TaskColors {
  const _TaskColors._();

  static const navy = Color(0xFF12344D);
  static const background = Color(0xFFF4F6F8);
  static const surface = Colors.white;
  static const textPrimary = Color(0xFF12344D);
  static const textSecondary = Color(0xFF5F6E79);
  static const error = Color(0xFFC0392B);
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

    return Scaffold(
      backgroundColor: _TaskColors.background,
      appBar: AppBar(
        backgroundColor: _TaskColors.navy,
        foregroundColor: Colors.white,
        elevation: 0,
        title: const Text('งานของฉัน'),
      ),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(taskListProvider),
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
      color: _TaskColors.surface,
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
                        color: _TaskColors.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'อุปกรณ์: ${task.deviceId ?? '—'}',
                      style: const TextStyle(
                        fontSize: 13,
                        color: _TaskColors.textSecondary,
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
              Icon(Icons.inbox_outlined, color: _TaskColors.textSecondary),
              SizedBox(height: 8),
              Text(
                'ยังไม่มีงานที่ได้รับมอบหมาย',
                key: Key('my_tasks_empty'),
                style: TextStyle(
                  fontSize: 13,
                  color: _TaskColors.textSecondary,
                ),
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
        Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(
                  Icons.error_outline,
                  color: _TaskColors.error,
                  size: 32,
                ),
                const SizedBox(height: 12),
                Text(
                  message,
                  key: const Key('my_tasks_error'),
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 14,
                    color: _TaskColors.textSecondary,
                  ),
                ),
                const SizedBox(height: 16),
                FilledButton(
                  key: const Key('my_tasks_retry'),
                  onPressed: onRetry,
                  style: FilledButton.styleFrom(
                    backgroundColor: _TaskColors.navy,
                    foregroundColor: Colors.white,
                  ),
                  child: const Text('ลองอีกครั้ง'),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
