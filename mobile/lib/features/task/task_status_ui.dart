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

/// งานหนึ่งงาน "เร่งด่วน" แค่ไหน — ใช้ร่วมกันทั้ง Home ("งานค้างวันนี้") และ
/// Task List (sort + indicator) กันไม่ให้สอง section ตัดสิน "เร่งด่วน" ต่างกัน
enum TaskUrgency {
  /// ไม่เร่งด่วน — ไม่มี dueDate, งานจบแล้ว/ยกเลิกแล้ว, หรือ dueDate ยังอีกไกล
  none,

  /// dueDate เหลือ ≤ 1 วัน แต่ยังไม่เลยกำหนด
  dueSoon,

  /// dueDate เลยมาแล้ว
  overdue,
}

class TaskUrgencyStyle {
  const TaskUrgencyStyle._();

  /// เกณฑ์ "เร่งด่วน" (Mobile UI Roadmap Phase 1): งานที่ยังไม่เสร็จ
  /// (`pending`/`inProgress`) ที่มี `dueDate` และ — เลยกำหนดแล้ว (`overdue`)
  /// หรือเหลือ ≤ 1 วัน (`dueSoon`, ขอบเขต inclusive) ถือว่าเร่งด่วน งานที่
  /// `completed`/`cancelled` หรือไม่มี `dueDate` เลย ไม่ถือว่าเร่งด่วนเลยไม่ว่า
  /// วันที่จะเป็นอย่างไร (งานจบไปแล้วไม่มีอะไรต้องเร่ง)
  static TaskUrgency of(Task task, {DateTime? now}) {
    if (task.status == TaskStatus.completed ||
        task.status == TaskStatus.cancelled) {
      return TaskUrgency.none;
    }
    final due = task.dueDate;
    if (due == null) return TaskUrgency.none;
    final current = now ?? DateTime.now();
    if (due.isBefore(current)) return TaskUrgency.overdue;
    if (due.difference(current) <= const Duration(days: 1)) {
      return TaskUrgency.dueSoon;
    }
    return TaskUrgency.none;
  }

  static bool isUrgent(Task task, {DateTime? now}) =>
      of(task, now: now) != TaskUrgency.none;

  static int _rank(TaskUrgency urgency) => switch (urgency) {
    TaskUrgency.overdue => 0,
    TaskUrgency.dueSoon => 1,
    TaskUrgency.none => 2,
  };

  /// เรียง overdue มาก่อน แล้ว dueSoon แล้วที่เหลือ — คงลำดับเดิมภายในกลุ่ม
  /// ความเร่งด่วนเดียวกัน (stable) ไม่พึ่ง `List.sort` ตรงๆ เพราะ Dart ไม่การันตี
  /// ว่า stable
  static List<Task> sorted(List<Task> tasks, {DateTime? now}) {
    final indexed = tasks.indexed.toList()
      ..sort((a, b) {
        final rankCompare = _rank(
          of(a.$2, now: now),
        ).compareTo(_rank(of(b.$2, now: now)));
        if (rankCompare != 0) return rankCompare;
        return a.$1.compareTo(b.$1);
      });
    return [for (final (_, task) in indexed) task];
  }

  /// `(background, foreground)` สำหรับ indicator — reuse โทนสีเดียวกับ
  /// `IncidentStyle` (แดง = error/overdue, ส้ม = warning/dueSoon)
  static (Color, Color) colors(TaskUrgency urgency) => switch (urgency) {
    TaskUrgency.overdue => (Color(0xFFFCE8E6), Color(0xFFC0392B)),
    TaskUrgency.dueSoon => (Color(0xFFFDF0E3), Color(0xFFB9770E)),
    TaskUrgency.none => (Colors.transparent, Colors.transparent),
  };

  static String label(TaskUrgency urgency) => switch (urgency) {
    TaskUrgency.overdue => 'เลยกำหนด',
    TaskUrgency.dueSoon => 'ใกล้ถึงกำหนด',
    TaskUrgency.none => '',
  };

  static IconData icon(TaskUrgency urgency) => switch (urgency) {
    TaskUrgency.overdue => Icons.warning_amber_rounded,
    TaskUrgency.dueSoon => Icons.schedule,
    TaskUrgency.none => Icons.circle,
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
