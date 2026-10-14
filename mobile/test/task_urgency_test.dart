import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/features/task/task_status_ui.dart';

Task _task({TaskStatus status = TaskStatus.pending, DateTime? dueDate}) => Task(
  id: 't1',
  title: 'ทดสอบ',
  assignedTo: 'u1',
  status: status,
  createdAt: DateTime(2026, 1, 1),
  updatedAt: DateTime(2026, 1, 1),
  dueDate: dueDate,
);

void main() {
  final now = DateTime(2026, 10, 14, 12, 0);

  group('TaskUrgencyStyle.of — เกณฑ์เร่งด่วน', () {
    test('ไม่มี dueDate -> none เสมอ ไม่ว่า status จะเป็นอะไร', () {
      expect(
        TaskUrgencyStyle.of(_task(dueDate: null), now: now),
        TaskUrgency.none,
      );
    });

    test('dueDate เลยมาแล้ว + status pending -> overdue', () {
      final task = _task(dueDate: now.subtract(const Duration(hours: 1)));
      expect(TaskUrgencyStyle.of(task, now: now), TaskUrgency.overdue);
    });

    test('dueDate เลยมาแล้ว + status inProgress -> overdue เหมือนกัน', () {
      final task = _task(
        status: TaskStatus.inProgress,
        dueDate: now.subtract(const Duration(days: 3)),
      );
      expect(TaskUrgencyStyle.of(task, now: now), TaskUrgency.overdue);
    });

    test('dueDate เหลือน้อยกว่า 1 วัน (ยังไม่เลย) -> dueSoon', () {
      final task = _task(dueDate: now.add(const Duration(hours: 12)));
      expect(TaskUrgencyStyle.of(task, now: now), TaskUrgency.dueSoon);
    });

    test('dueDate เหลือพอดี 1 วัน (ขอบเขต inclusive) -> dueSoon', () {
      final task = _task(dueDate: now.add(const Duration(days: 1)));
      expect(TaskUrgencyStyle.of(task, now: now), TaskUrgency.dueSoon);
    });

    test('dueDate เหลือมากกว่า 1 วัน -> none', () {
      final task = _task(dueDate: now.add(const Duration(days: 1, minutes: 1)));
      expect(TaskUrgencyStyle.of(task, now: now), TaskUrgency.none);
    });

    test('status completed -> none แม้ dueDate เลยมาแล้ว', () {
      final task = _task(
        status: TaskStatus.completed,
        dueDate: now.subtract(const Duration(days: 5)),
      );
      expect(TaskUrgencyStyle.of(task, now: now), TaskUrgency.none);
    });

    test('status cancelled -> none แม้ dueDate เลยมาแล้ว', () {
      final task = _task(
        status: TaskStatus.cancelled,
        dueDate: now.subtract(const Duration(days: 5)),
      );
      expect(TaskUrgencyStyle.of(task, now: now), TaskUrgency.none);
    });
  });

  group('TaskUrgencyStyle.isUrgent', () {
    test('overdue/dueSoon -> true, none -> false', () {
      expect(
        TaskUrgencyStyle.isUrgent(
          _task(dueDate: now.subtract(const Duration(hours: 1))),
          now: now,
        ),
        isTrue,
      );
      expect(
        TaskUrgencyStyle.isUrgent(
          _task(dueDate: now.add(const Duration(hours: 1))),
          now: now,
        ),
        isTrue,
      );
      expect(
        TaskUrgencyStyle.isUrgent(_task(dueDate: null), now: now),
        isFalse,
      );
    });
  });

  group('TaskUrgencyStyle.sorted', () {
    test(
      'overdue มาก่อน dueSoon มาก่อน none เสมอ และคงลำดับเดิมในกลุ่มเดียวกัน',
      () {
        final overdue1 = _task(dueDate: now.subtract(const Duration(days: 2)));
        final overdue2 = _task(dueDate: now.subtract(const Duration(hours: 1)));
        final dueSoon = _task(dueDate: now.add(const Duration(hours: 2)));
        final none1 = _task(dueDate: now.add(const Duration(days: 10)));
        final none2 = _task(dueDate: null);

        final tasks = [none1, dueSoon, none2, overdue1, overdue2];
        final sorted = TaskUrgencyStyle.sorted(tasks, now: now);

        expect(sorted, [overdue1, overdue2, dueSoon, none1, none2]);
      },
    );
  });
}
