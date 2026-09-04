import 'package:flutter/material.dart';

import '../../core/api/models.dart';

/// Shared labels + palette for [TaskStatus], so the Home task cards and the
/// Task Detail screen render status the same way. Colours reuse the navy
/// design-system palette already used on Login / Home.
class TaskStatusStyle {
  const TaskStatusStyle._();

  static String label(TaskStatus status) => switch (status) {
    TaskStatus.pending => 'รอดำเนินการ',
    TaskStatus.inProgress => 'กำลังทำ',
    TaskStatus.completed => 'เสร็จแล้ว',
    TaskStatus.cancelled => 'ยกเลิก',
  };

  /// `(background, foreground)` for the status pill.
  static (Color, Color) colors(TaskStatus status) => switch (status) {
    TaskStatus.pending => (Color(0xFFECEFF1), Color(0xFF5F6E79)),
    TaskStatus.inProgress => (Color(0xFFE3F0FB), Color(0xFF1F6FB2)),
    TaskStatus.completed => (Color(0xFFE6F4EA), Color(0xFF1E7E34)),
    TaskStatus.cancelled => (Color(0xFFFCE8E6), Color(0xFFC0392B)),
  };
}

/// Rounded status pill. Same shape/typography as the Home redesign (PR #66).
class TaskStatusPill extends StatelessWidget {
  const TaskStatusPill({super.key, required this.status});

  final TaskStatus status;

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = TaskStatusStyle.colors(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        TaskStatusStyle.label(status),
        style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: fg),
      ),
    );
  }
}
