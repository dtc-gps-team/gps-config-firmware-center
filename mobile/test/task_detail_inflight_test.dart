import 'dart:async';

import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/auth/auth_controller.dart';
import 'package:mobile/core/auth/token_store.dart';
import 'package:mobile/core/db/app_database.dart';
import 'package:mobile/core/db/providers/database_provider.dart';
import 'package:mobile/core/sync/sync_providers.dart';
import 'package:mobile/features/device_search/device_status_repository.dart';
import 'package:mobile/features/task/confirm_install_repository.dart';
import 'package:mobile/features/task/task_detail_page.dart';
import 'package:mobile/features/task/task_event_repository.dart';
import 'package:mobile/features/task/task_repository.dart';

// UX audit #3 — หน้ารายละเอียดงานถูกสร้างใหม่ทั้งหน้าทุกครั้งที่ task เปลี่ยน
// (key รวม status/updatedAt + taskDetailProvider watch syncRevisionProvider)
// ถ้า sync flush เสร็จระหว่างกำลังส่ง apply-config state การส่งจะหาย ปุ่มกดได้
// อีกครั้ง และผลของคำขอแรกถูกทิ้ง

class _FakeAuthController extends AuthController {
  @override
  AuthState build() =>
      const AuthState(status: AuthStatus.authenticated, role: UserRole.st);
}

Task _task({TaskStatus status = TaskStatus.inProgress, DateTime? updatedAt}) =>
    Task(
      id: 't1',
      title: 'ติดตั้งกล่อง GPS',
      assignedTo: 'u1',
      status: status,
      createdAt: DateTime(2026, 9, 1, 8),
      updatedAt: updatedAt ?? DateTime(2026, 9, 2, 9, 30),
      deviceId: 'DVC-1',
      configId: 'cfg-1',
    );

/// `getTask` คืน [current] — เปลี่ยนค่าแล้ว bump syncRevisionProvider เพื่อ
/// จำลองว่า sync flush เสร็จและ server ส่ง task ฉบับใหม่มา
class _FakeTaskRepository implements TaskRepository {
  Task current = _task();

  @override
  Future<List<Task>> listTasks() async => [current];

  @override
  Future<Task> getTask(String id) async => current;

  @override
  Future<Task> updateStatus(String id, TaskStatus status) async =>
      throw UnimplementedError();
}

class _FakeTaskEventRepository implements TaskEventRepository {
  @override
  Future<List<TaskEvent>> getEvents(String taskId) async => const [];

  @override
  Future<TaskEvent> addNote(String taskId, String note) =>
      throw UnimplementedError();
}

/// apply-config ที่ค้างอยู่บนสายจนกว่าจะ [complete]
class _GatedConfirmInstallRepository implements ConfirmInstallRepository {
  final gate = Completer<ConfigApplyResult>();
  int calls = 0;

  @override
  Future<ConfigApplyResult> applyConfig({
    required String deviceId,
    required String configId,
    String? rolloutId,
  }) {
    calls++;
    return gate.future;
  }
}

class _FakeDeviceStatusRepository implements DeviceStatusRepository {
  @override
  Future<DeviceStatus> getDeviceStatus(String deviceId) async => DeviceStatus(
    deviceId: deviceId,
    configStatus: DevicePayloadStatus.unknown,
    firmwareStatus: DevicePayloadStatus.unknown,
  );
}

Future<void> _pump(
  WidgetTester tester, {
  required _FakeTaskRepository repo,
  ConfirmInstallRepository? confirmRepo,
}) async {
  tester.view.physicalSize = const Size(1080, 4000);
  tester.view.devicePixelRatio = 2;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        taskRepositoryProvider.overrideWithValue(repo),
        taskEventRepositoryProvider.overrideWithValue(
          _FakeTaskEventRepository(),
        ),
        pendingTaskIdsProvider.overrideWith(
          (ref) => Stream.value(const <String>{}),
        ),
        failedSyncActionsProvider.overrideWith(
          (ref) => Stream.value(const <PendingActionRow>[]),
        ),
        appDatabaseProvider.overrideWith((ref) {
          final db = AppDatabase.forTesting(NativeDatabase.memory());
          ref.onDispose(db.close);
          return db;
        }),
        authControllerProvider.overrideWith(_FakeAuthController.new),
        tokenStoreProvider.overrideWithValue(InMemoryTokenStore()),
        sessionProfileStoreProvider.overrideWithValue(
          InMemorySessionProfileStore(),
        ),
        confirmInstallRepositoryProvider.overrideWithValue(
          confirmRepo ?? _GatedConfirmInstallRepository(),
        ),
        deviceStatusRepositoryProvider.overrideWithValue(
          _FakeDeviceStatusRepository(),
        ),
      ],
      child: const MaterialApp(home: TaskDetailPage(taskId: 't1')),
    ),
  );
  await tester.pump();
  await tester.pump();
}

/// จำลอง sync flush เสร็จ: server ส่ง task ฉบับใหม่ แล้ว revision ขยับ
Future<void> _syncFlushed(
  WidgetTester tester,
  _FakeTaskRepository repo,
  Task next,
) async {
  repo.current = next;
  ProviderScope.containerOf(
    tester.element(find.byType(TaskDetailPage)),
  ).read(syncRevisionProvider.notifier).state++;
  await tester.pump();
  await tester.pump();
}

Finder get _confirmButton => find.byKey(const Key('confirm_install_button'));

FilledButton _button(WidgetTester tester, String key) =>
    tester.widget<FilledButton>(find.byKey(Key(key)));

void main() {
  group('state การส่ง Config ไม่หายเมื่อ sync flush (UX audit #3)', () {
    testWidgets('sync เสร็จระหว่างกำลังส่ง apply-config -> ปุ่มยัง disabled + '
        'spinner, กดซ้ำไม่ยิงซ้ำ, และเห็นผลของคำขอแรก', (tester) async {
      final repo = _FakeTaskRepository();
      final confirm = _GatedConfirmInstallRepository();
      await _pump(tester, repo: repo, confirmRepo: confirm);

      await tester.ensureVisible(_confirmButton);
      await tester.tap(_confirmButton);
      await tester.pump();
      await tester.pump();
      expect(confirm.calls, 1);
      expect(_button(tester, 'confirm_install_button').onPressed, isNull);

      // sync flush เสร็จพอดี: server ส่ง task ที่ updatedAt ใหม่มา
      await _syncFlushed(
        tester,
        repo,
        _task(updatedAt: DateTime(2026, 9, 3, 10)),
      );

      expect(
        _button(tester, 'confirm_install_button').onPressed,
        isNull,
        reason: 'ปุ่มต้องยัง disabled ระหว่างคำขอแรกยังไม่จบ',
      );
      expect(
        find.descendant(
          of: _confirmButton,
          matching: find.byType(CircularProgressIndicator),
        ),
        findsOneWidget,
      );
      await tester.tap(_confirmButton, warnIfMissed: false);
      await tester.pump();
      expect(confirm.calls, 1, reason: 'ห้ามยิง apply-config ซ้ำ');

      confirm.gate.complete(
        ConfigApplyResult(
          applied: true,
          details: const ['ok'],
          appliedAt: DateTime(2026, 9, 3, 10),
        ),
      );
      await tester.pump();
      await tester.pump();

      expect(find.text('ส่ง Config เข้าเครื่องแล้ว'), findsOneWidget);
      expect(
        find.text(
          'ส่ง Config เข้าเครื่องแล้ว — กล่องจะรับค่าเมื่อเปิดเครื่องครั้งถัดไป',
        ),
        findsOneWidget,
      );
    });

    testWidgets('ยังไม่ได้เลือกสถานะเอง + server เปลี่ยนสถานะ -> ตัวเลือก'
        'ตามสถานะใหม่ (ปุ่มบันทึกไม่ถูกเปิดค้าง)', (tester) async {
      final repo = _FakeTaskRepository()
        ..current = _task(status: TaskStatus.pending);
      await _pump(tester, repo: repo);
      expect(_button(tester, 'task_status_save').onPressed, isNull);

      await _syncFlushed(
        tester,
        repo,
        _task(
          status: TaskStatus.inProgress,
          updatedAt: DateTime(2026, 9, 3, 10),
        ),
      );

      expect(
        _button(tester, 'task_status_save').onPressed,
        isNull,
        reason: 'ไม่มีการแก้ค้าง จึงไม่ควรมีอะไรให้บันทึก',
      );
    });

    testWidgets('เลือกสถานะค้างไว้ยังไม่บันทึก + sync เสร็จ (สถานะเดิม) -> '
        'ตัวเลือกของผู้ใช้ไม่หาย', (tester) async {
      final repo = _FakeTaskRepository()
        ..current = _task(status: TaskStatus.inProgress);
      await _pump(tester, repo: repo);

      await tester.tap(find.byKey(const Key('status_choice_completed')));
      await tester.pump();
      expect(_button(tester, 'task_status_save').onPressed, isNotNull);

      await _syncFlushed(
        tester,
        repo,
        _task(
          status: TaskStatus.inProgress,
          updatedAt: DateTime(2026, 9, 3, 10),
        ),
      );

      expect(_button(tester, 'task_status_save').onPressed, isNotNull);
    });
  });
}
