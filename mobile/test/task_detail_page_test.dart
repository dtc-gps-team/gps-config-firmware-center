import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/auth/auth_controller.dart';
import 'package:mobile/core/auth/token_store.dart';
import 'package:mobile/features/task/task_detail_page.dart';
import 'package:mobile/features/task/task_repository.dart';

class _FakeAuthController extends AuthController {
  _FakeAuthController(this._role);

  final UserRole? _role;

  @override
  AuthState build() => AuthState(status: AuthStatus.authenticated, role: _role);
}

Task _makeTask({
  String id = 't1',
  TaskStatus status = TaskStatus.pending,
  String? description,
  String? deviceId = 'DVC-1',
}) => Task(
  id: id,
  title: 'ติดตั้งกล่อง GPS',
  assignedTo: 'u1',
  status: status,
  createdAt: DateTime(2026, 9, 1, 8),
  updatedAt: DateTime(2026, 9, 2, 9, 30),
  description: description,
  deviceId: deviceId,
);

class _FakeTaskRepository implements TaskRepository {
  _FakeTaskRepository({Task? task, this.getError, this.updateError})
    : _task = task ?? _makeTask();

  Task _task;
  final Object? getError;
  final Object? updateError;

  int updateCalls = 0;
  TaskStatus? lastStatus;

  @override
  Future<List<Task>> listTasks() async => [_task];

  @override
  Future<Task> getTask(String id) async {
    if (getError != null) throw getError!;
    return _task;
  }

  @override
  Future<Task> updateStatus(String id, TaskStatus status) async {
    updateCalls++;
    lastStatus = status;
    if (updateError != null) throw updateError!;
    _task = Task(
      id: _task.id,
      title: _task.title,
      assignedTo: _task.assignedTo,
      status: status,
      createdAt: _task.createdAt,
      updatedAt: DateTime.now(),
      description: _task.description,
      deviceId: _task.deviceId,
    );
    return _task;
  }
}

Future<void> _pump(
  WidgetTester tester, {
  required TaskRepository repo,
  UserRole? role = UserRole.st,
  String taskId = 't1',
}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        taskRepositoryProvider.overrideWithValue(repo),
        authControllerProvider.overrideWith(() => _FakeAuthController(role)),
        tokenStoreProvider.overrideWithValue(InMemoryTokenStore()),
      ],
      child: MaterialApp(home: TaskDetailPage(taskId: taskId)),
    ),
  );
  await tester.pump(); // resolve getTask
}

FilledButton _saveButton(WidgetTester tester) =>
    tester.widget<FilledButton>(find.byKey(const Key('task_status_save')));

void main() {
  testWidgets('แสดงหัวข้องาน + สถานะ + ข้อมูลอุปกรณ์', (tester) async {
    await _pump(
      tester,
      repo: _FakeTaskRepository(
        task: _makeTask(
          status: TaskStatus.inProgress,
          description: 'โน้ตงานติดตั้งหน้างาน',
        ),
      ),
    );

    expect(find.text('ติดตั้งกล่อง GPS'), findsOneWidget);
    expect(find.text('กำลังทำ'), findsWidgets); // pill + choice chip
    expect(find.text('DVC-1'), findsOneWidget);
    expect(find.text('โน้ตงานติดตั้งหน้างาน'), findsOneWidget);
  });

  testWidgets('ST เห็นตัวเลือกสถานะ + ปุ่มบันทึก (disabled จนกว่าจะเปลี่ยน)', (
    tester,
  ) async {
    await _pump(
      tester,
      repo: _FakeTaskRepository(task: _makeTask()),
      role: UserRole.st,
    );

    expect(find.byKey(const Key('task_status_save')), findsOneWidget);
    expect(_saveButton(tester).onPressed, isNull);

    // ST/OT may only move a task to in_progress / completed — not cancel it
    // (Operation's call) and not back to pending.
    expect(find.byKey(const Key('status_choice_in_progress')), findsOneWidget);
    expect(find.byKey(const Key('status_choice_completed')), findsOneWidget);
    expect(find.byKey(const Key('status_choice_pending')), findsNothing);
    expect(find.byKey(const Key('status_choice_cancelled')), findsNothing);

    await tester.tap(find.byKey(const Key('status_choice_in_progress')));
    await tester.pump();

    expect(_saveButton(tester).onPressed, isNotNull);
  });

  testWidgets('SW ไม่เห็นตัวเลือกเปลี่ยนสถานะ', (tester) async {
    await _pump(
      tester,
      repo: _FakeTaskRepository(task: _makeTask()),
      role: UserRole.sw,
    );

    expect(find.byKey(const Key('task_status_save')), findsNothing);
    expect(find.byKey(const Key('status_choice_in_progress')), findsNothing);
    expect(find.byKey(const Key('status_choice_completed')), findsNothing);
    // still shows the read-only status pill
    expect(find.text('รอดำเนินการ'), findsOneWidget);
  });

  testWidgets('เปลี่ยนสถานะแล้วกดบันทึก -> เรียก repo + ขึ้น snackbar', (
    tester,
  ) async {
    final repo = _FakeTaskRepository(
      task: _makeTask(status: TaskStatus.pending),
    );
    await _pump(tester, repo: repo, role: UserRole.ot);

    await tester.tap(find.byKey(const Key('status_choice_completed')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('task_status_save')));
    await tester.pump(); // kick off _save
    await tester.pump(); // await updateStatus + invalidate
    await tester.pump(); // re-fetch getTask

    expect(repo.updateCalls, 1);
    expect(repo.lastStatus, TaskStatus.completed);
    expect(find.text('อัปเดตสถานะงานแล้ว'), findsOneWidget);

    await tester.pump(const Duration(seconds: 5)); // let the snackbar time out
    await tester.pumpAndSettle();
  });

  testWidgets('โหลดงานไม่เจอ (404) -> error card + ปุ่มลองอีกครั้ง', (
    tester,
  ) async {
    await _pump(
      tester,
      repo: _FakeTaskRepository(
        getError: ApiException('not found', statusCode: 404),
      ),
    );

    expect(find.byKey(const Key('task_detail_error')), findsOneWidget);
    expect(find.text('ไม่พบงานนี้ อาจถูกลบไปแล้ว'), findsOneWidget);
    expect(find.byKey(const Key('task_detail_retry')), findsOneWidget);
  });

  testWidgets('บันทึกแล้วเจอ 403 -> ข้อความ error เฉพาะ', (tester) async {
    final repo = _FakeTaskRepository(
      task: _makeTask(status: TaskStatus.pending),
      updateError: ApiException('forbidden', statusCode: 403),
    );
    await _pump(tester, repo: repo, role: UserRole.st);

    await tester.tap(find.byKey(const Key('status_choice_in_progress')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('task_status_save')));
    await tester.pump();
    await tester.pump();

    expect(find.byKey(const Key('task_status_error')), findsOneWidget);
    expect(
      find.text('แก้สถานะได้เฉพาะงานที่มอบหมายให้คุณเท่านั้น'),
      findsOneWidget,
    );
  });
}
