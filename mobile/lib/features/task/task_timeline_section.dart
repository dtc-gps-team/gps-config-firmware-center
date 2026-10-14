import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/theme/app_theme.dart';
import 'task_event_repository.dart';
import 'task_status_ui.dart';

String _formatDate(DateTime dt) {
  final d = dt.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(d.day)}/${two(d.month)}/${d.year} ${two(d.hour)}:${two(d.minute)}';
}

/// Same limit as the backend `CreateTaskNoteDto`.
const _noteMaxLength = 2000;

/// "ประวัติงาน" section of Task Detail (Task Event History, issue #296): the
/// task's timeline oldest-first (created → status changes → notes) plus an
/// "เพิ่มบันทึก" button. Text notes only — attaching photos is out of this
/// round's scope.
class TaskTimelineSection extends ConsumerWidget {
  const TaskTimelineSection({
    super.key,
    required this.taskId,
    required this.canAddNote,
  });

  final String taskId;

  /// Operation, or the ST/OT the task is assigned to, on a task that isn't
  /// cancelled — mirrors `POST /tasks/{id}/notes` (the backend enforces it).
  final bool canAddNote;

  Future<void> _openAddNote(BuildContext context, WidgetRef ref) async {
    final added = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (_) => _AddNoteSheet(taskId: taskId),
    );
    if (added != true) return;
    ref.invalidate(taskEventsProvider(taskId));
    if (!context.mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(const SnackBar(content: Text('เพิ่มบันทึกแล้ว')));
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final eventsAsync = ref.watch(taskEventsProvider(taskId));

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            const Expanded(
              child: Text(
                'ประวัติงาน',
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w700,
                  color: AppTheme.textPrimary,
                ),
              ),
            ),
            if (canAddNote)
              TextButton.icon(
                key: const Key('task_add_note_button'),
                onPressed: () => _openAddNote(context, ref),
                icon: const Icon(Icons.edit_note, size: 20),
                label: const Text('เพิ่มบันทึก'),
              ),
          ],
        ),
        const SizedBox(height: 8),
        eventsAsync.when(
          skipLoadingOnRefresh: true,
          data: (events) => events.isEmpty
              ? const _TimelineMessage('ยังไม่มีประวัติของงานนี้')
              : Container(
                  key: const Key('task_timeline'),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: AppTheme.surface,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Column(
                    children: [
                      for (var i = 0; i < events.length; i++)
                        _TimelineTile(
                          event: events[i],
                          isLast: i == events.length - 1,
                        ),
                    ],
                  ),
                ),
          loading: () => const Padding(
            padding: EdgeInsets.symmetric(vertical: 12),
            child: Center(
              child: SizedBox(
                height: 20,
                width: 20,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            ),
          ),
          error: (_, _) => Row(
            children: [
              const Expanded(
                child: _TimelineMessage(
                  'โหลดประวัติงานไม่สำเร็จ',
                  key: Key('task_timeline_error'),
                ),
              ),
              TextButton(
                key: const Key('task_timeline_retry'),
                onPressed: () => ref.invalidate(taskEventsProvider(taskId)),
                child: const Text('ลองใหม่'),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _TimelineMessage extends StatelessWidget {
  const _TimelineMessage(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: const TextStyle(fontSize: 13, color: AppTheme.textSecondary),
    );
  }
}

class _TimelineTile extends StatelessWidget {
  const _TimelineTile({required this.event, required this.isLast});

  final TaskEvent event;
  final bool isLast;

  @override
  Widget build(BuildContext context) {
    final (icon, title) = _describe(event);
    final who = event.changedByName ?? 'ไม่ทราบผู้ทำรายการ';

    return Container(
      padding: const EdgeInsets.symmetric(vertical: 10),
      decoration: BoxDecoration(
        border: isLast
            ? null
            : const Border(bottom: BorderSide(color: Color(0x14000000))),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 20, color: AppTheme.navy),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    fontSize: 14,
                    height: 1.4,
                    fontWeight: event.isNote
                        ? FontWeight.w400
                        : FontWeight.w600,
                    color: AppTheme.textPrimary,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  '$who · ${_formatDate(event.changedAt)}',
                  style: const TextStyle(
                    fontSize: 12,
                    color: AppTheme.textSecondary,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  static (IconData, String) _describe(TaskEvent e) {
    final to = e.toStatus;
    if (to == null) return (Icons.sticky_note_2_outlined, e.note ?? '');
    final from = e.fromStatus;
    if (from == null) return (Icons.add_task, 'สร้างงาน');
    return (
      Icons.swap_horiz,
      'เปลี่ยนสถานะ: ${TaskStatusStyle.label(from)} → ${TaskStatusStyle.label(to)}',
    );
  }
}

class _AddNoteSheet extends ConsumerStatefulWidget {
  const _AddNoteSheet({required this.taskId});

  final String taskId;

  @override
  ConsumerState<_AddNoteSheet> createState() => _AddNoteSheetState();
}

class _AddNoteSheetState extends ConsumerState<_AddNoteSheet> {
  final _controller = TextEditingController();
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await ref
          .read(taskEventRepositoryProvider)
          .addNote(widget.taskId, _controller.text.trim());
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = _errorMessage(e);
      });
    }
  }

  static String _errorMessage(ApiException e) {
    switch (e.statusCode) {
      case null:
        // Notes are not queued offline (docs/16 §7) — say so plainly.
        return 'เพิ่มบันทึกต้องใช้อินเทอร์เน็ต กรุณาลองใหม่เมื่อเชื่อมต่อได้';
      case 409:
        return 'งานนี้ถูกยกเลิกแล้ว เพิ่มบันทึกไม่ได้';
      case 404:
        return 'ไม่พบงานนี้ อาจถูกลบไปแล้ว';
      case 403:
        return 'ไม่มีสิทธิ์เพิ่มบันทึกในงานนี้';
      default:
        return e.message;
    }
  }

  @override
  Widget build(BuildContext context) {
    final canSave = !_saving && _controller.text.trim().isNotEmpty;

    return Padding(
      padding: EdgeInsets.fromLTRB(
        16,
        16,
        16,
        16 + MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'เพิ่มบันทึก',
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w700,
              color: AppTheme.textPrimary,
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            key: const Key('task_note_field'),
            controller: _controller,
            autofocus: true,
            enabled: !_saving,
            minLines: 3,
            maxLines: 6,
            maxLength: _noteMaxLength,
            decoration: const InputDecoration(
              hintText: 'เช่น ลูกค้าไม่อยู่ นัดเข้าใหม่พรุ่งนี้',
              border: OutlineInputBorder(),
            ),
            onChanged: (_) => setState(() {}),
          ),
          if (_error != null) ...[
            const SizedBox(height: 4),
            Text(
              _error!,
              key: const Key('task_note_error'),
              style: const TextStyle(color: AppTheme.error, fontSize: 13),
            ),
          ],
          const SizedBox(height: 12),
          FilledButton(
            key: const Key('task_note_save'),
            onPressed: canSave ? _save : null,
            style: FilledButton.styleFrom(
              minimumSize: const Size.fromHeight(48),
              backgroundColor: AppTheme.navy,
              foregroundColor: Colors.white,
              disabledBackgroundColor: AppTheme.navy.withValues(alpha: 0.4),
              disabledForegroundColor: Colors.white,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
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
                : const Text('บันทึก'),
          ),
        ],
      ),
    );
  }
}
