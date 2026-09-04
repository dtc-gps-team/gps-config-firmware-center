import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/auth/auth_controller.dart';
import 'task_repository.dart';
import 'task_status_ui.dart';

/// Task Detail palette. Scoped to this file, same values as the Home / Login
/// redesigns — nothing here touches the shared [AppTheme].
class _TaskColors {
  const _TaskColors._();

  static const navy = Color(0xFF12344D);
  static const background = Color(0xFFF4F6F8);
  static const surface = Colors.white;
  static const textPrimary = Color(0xFF12344D);
  static const textSecondary = Color(0xFF5F6E79);
  static const error = Color(0xFFC0392B);
}

String _formatDate(DateTime dt) {
  final d = dt.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(d.day)}/${two(d.month)}/${d.year} ${two(d.hour)}:${two(d.minute)}';
}

/// "รายละเอียดงาน" — opened from a task card on Home. Shows one task from
/// `GET /tasks/{id}` and, for ST/OT, lets the assignee change its status via
/// `PATCH /tasks/{id}` (backend restricts them to the `status` field of their
/// own tasks).
class TaskDetailPage extends ConsumerWidget {
  const TaskDetailPage({super.key, required this.taskId});

  final String taskId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final taskAsync = ref.watch(taskDetailProvider(taskId));

    return Scaffold(
      backgroundColor: _TaskColors.background,
      appBar: AppBar(
        backgroundColor: _TaskColors.navy,
        foregroundColor: Colors.white,
        elevation: 0,
        title: const Text('รายละเอียดงาน'),
      ),
      body: taskAsync.when(
        skipLoadingOnRefresh: true,
        data: (task) => _TaskDetailView(
          key: ValueKey('${task.id}:${task.status}:${task.updatedAt}'),
          taskId: taskId,
          task: task,
        ),
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => _DetailError(
          message: _errorMessage(error),
          onRetry: () => ref.invalidate(taskDetailProvider(taskId)),
        ),
      ),
    );
  }

  static String _errorMessage(Object error) {
    if (error is ApiException) {
      switch (error.statusCode) {
        case 404:
          return 'ไม่พบงานนี้ อาจถูกลบไปแล้ว';
        case 403:
          return 'ไม่มีสิทธิ์ดูงานนี้';
        default:
          return error.message;
      }
    }
    return 'โหลดรายละเอียดงานไม่สำเร็จ';
  }
}

class _TaskDetailView extends ConsumerStatefulWidget {
  const _TaskDetailView({super.key, required this.taskId, required this.task});

  final String taskId;
  final Task task;

  @override
  ConsumerState<_TaskDetailView> createState() => _TaskDetailViewState();
}

class _TaskDetailViewState extends ConsumerState<_TaskDetailView> {
  late TaskStatus _selected = widget.task.status;
  bool _saving = false;
  String? _saveError;

  bool get _dirty => _selected != widget.task.status;

  Future<void> _save() async {
    setState(() {
      _saving = true;
      _saveError = null;
    });
    try {
      await ref
          .read(taskRepositoryProvider)
          .updateStatus(widget.taskId, _selected);
      ref.invalidate(taskListProvider);
      ref.invalidate(taskDetailProvider(widget.taskId));
      if (!mounted) return;
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(const SnackBar(content: Text('อัปเดตสถานะงานแล้ว')));
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _saveError = _saveErrorMessage(e));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  static String _saveErrorMessage(ApiException e) {
    switch (e.statusCode) {
      case 403:
        return 'แก้สถานะได้เฉพาะงานที่มอบหมายให้คุณเท่านั้น';
      case 404:
        return 'ไม่พบงานนี้ อาจถูกลบไปแล้ว';
      case 400:
        return 'สถานะที่เลือกไม่ถูกต้อง';
      default:
        return e.message;
    }
  }

  @override
  Widget build(BuildContext context) {
    final task = widget.task;
    final role = ref.watch(authControllerProvider).role;
    final canEditStatus = role == UserRole.st || role == UserRole.ot;

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: [
        Text(
          task.title,
          style: const TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.w700,
            color: _TaskColors.textPrimary,
          ),
        ),
        const SizedBox(height: 10),
        Align(
          alignment: Alignment.centerLeft,
          child: TaskStatusPill(status: task.status),
        ),
        const SizedBox(height: 20),
        _InfoCard(
          rows: [
            ('อุปกรณ์', task.deviceId ?? '—'),
            (
              'กำหนดส่ง',
              task.dueDate == null ? '—' : _formatDate(task.dueDate!),
            ),
            ('สร้างเมื่อ', _formatDate(task.createdAt)),
            ('แก้ไขล่าสุด', _formatDate(task.updatedAt)),
          ],
        ),
        if ((task.description ?? '').trim().isNotEmpty) ...[
          const SizedBox(height: 16),
          const _SectionLabel('รายละเอียด'),
          const SizedBox(height: 8),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: _TaskColors.surface,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Text(
              task.description!.trim(),
              style: const TextStyle(
                fontSize: 14,
                height: 1.4,
                color: _TaskColors.textPrimary,
              ),
            ),
          ),
        ],
        if (canEditStatus) ...[
          const SizedBox(height: 24),
          const _SectionLabel('เปลี่ยนสถานะงาน'),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final status in TaskStatus.values)
                ChoiceChip(
                  key: Key('status_choice_${status.wireName}'),
                  label: Text(TaskStatusStyle.label(status)),
                  selected: _selected == status,
                  onSelected: _saving
                      ? null
                      : (_) => setState(() => _selected = status),
                ),
            ],
          ),
          if (_saveError != null) ...[
            const SizedBox(height: 12),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(
                  Icons.error_outline,
                  size: 18,
                  color: _TaskColors.error,
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    _saveError!,
                    key: const Key('task_status_error'),
                    style: const TextStyle(
                      color: _TaskColors.error,
                      fontSize: 13,
                    ),
                  ),
                ),
              ],
            ),
          ],
          const SizedBox(height: 16),
          FilledButton(
            key: const Key('task_status_save'),
            onPressed: (!_dirty || _saving) ? null : _save,
            style: FilledButton.styleFrom(
              minimumSize: const Size.fromHeight(48),
              backgroundColor: _TaskColors.navy,
              foregroundColor: Colors.white,
              disabledBackgroundColor: _TaskColors.navy.withValues(alpha: 0.4),
              disabledForegroundColor: Colors.white,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
              ),
              textStyle: const TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w600,
              ),
            ),
            child: _saving
                ? const SizedBox(
                    height: 20,
                    width: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                : const Text('บันทึกสถานะ'),
          ),
        ],
      ],
    );
  }
}

class _InfoCard extends StatelessWidget {
  const _InfoCard({required this.rows});

  final List<(String, String)> rows;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
      decoration: BoxDecoration(
        color: _TaskColors.surface,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        children: [
          for (final (label, value) in rows)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 10),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 96,
                    child: Text(
                      label,
                      style: const TextStyle(
                        fontSize: 13,
                        color: _TaskColors.textSecondary,
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      value,
                      style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: _TaskColors.textPrimary,
                      ),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: const TextStyle(
        fontSize: 15,
        fontWeight: FontWeight.w700,
        color: _TaskColors.textPrimary,
      ),
    );
  }
}

class _DetailError extends StatelessWidget {
  const _DetailError({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline, color: _TaskColors.error, size: 32),
            const SizedBox(height: 12),
            Text(
              message,
              key: const Key('task_detail_error'),
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 14,
                color: _TaskColors.textSecondary,
              ),
            ),
            const SizedBox(height: 16),
            FilledButton(
              key: const Key('task_detail_retry'),
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
    );
  }
}
