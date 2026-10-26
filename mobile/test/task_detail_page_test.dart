import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/core/theme/app_tokens.dart';
import 'package:mobile/core/db/app_database.dart';
import 'package:mobile/core/db/providers/database_provider.dart';
import 'package:mobile/core/sync/sync_providers.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/auth/auth_controller.dart';
import 'package:mobile/core/auth/token_store.dart';
import 'package:mobile/core/router/app_router.dart';
import 'package:mobile/core/ui/app_page_header.dart';
import 'package:mobile/core/ui/app_v2_theme.dart';
import 'package:mobile/features/task/config_apply_request_repository.dart';
import 'package:mobile/features/task/task_detail_page.dart';
import 'package:mobile/features/task/task_event_repository.dart';
import 'package:mobile/features/task/task_repository.dart';

import 'support/fake_config_apply_request_repository.dart';

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
  String? configId,
}) => Task(
  id: id,
  title: 'ติดตั้งกล่อง GPS',
  assignedTo: 'u1',
  status: status,
  createdAt: DateTime(2026, 9, 1, 8),
  updatedAt: DateTime(2026, 9, 2, 9, 30),
  description: description,
  deviceId: deviceId,
  configId: configId,
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

class _FakeTaskEventRepository implements TaskEventRepository {
  _FakeTaskEventRepository({List<TaskEvent>? events, this.getError})
    : events = events ?? [];

  final List<TaskEvent> events;
  Object? getError;

  /// Thrown by [addNote] while set.
  Object? addError;
  final List<String> addedNotes = [];
  int getCalls = 0;

  @override
  Future<List<TaskEvent>> getEvents(String taskId) async {
    getCalls++;
    if (getError != null) throw getError!;
    return List.of(events);
  }

  @override
  Future<TaskEvent> addNote(String taskId, String note) async {
    if (addError != null) throw addError!;
    addedNotes.add(note);
    final event = TaskEvent(
      id: 'n${addedNotes.length}',
      taskId: taskId,
      changedBy: 'u1',
      changedByName: 'ช่างสมชาย',
      changedAt: DateTime(2026, 9, 3, 10),
      note: note,
    );
    events.add(event);
    return event;
  }
}

Future<void> _pump(
  WidgetTester tester, {
  required TaskRepository repo,
  UserRole? role = UserRole.st,
  String taskId = 't1',
  ConfigApplyRequestRepository? applyRepo,
  Set<String> pendingIds = const {},
  TaskEventRepository? eventRepo,
  GoRouter? router,
}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        taskRepositoryProvider.overrideWithValue(repo),
        taskEventRepositoryProvider.overrideWithValue(
          eventRepo ?? _FakeTaskEventRepository(),
        ),
        // no real Drift DB / live queries in widget tests (drift stream
        // timers outlive the tree) — the sync queue has its own tests
        pendingTaskIdsProvider.overrideWith((ref) => Stream.value(pendingIds)),
        failedSyncActionsProvider.overrideWith(
          (ref) => Stream.value(const <PendingActionRow>[]),
        ),
        appDatabaseProvider.overrideWith((ref) {
          final db = AppDatabase.forTesting(NativeDatabase.memory());
          ref.onDispose(db.close);
          return db;
        }),
        authControllerProvider.overrideWith(() => _FakeAuthController(role)),
        tokenStoreProvider.overrideWithValue(InMemoryTokenStore()),
        sessionProfileStoreProvider.overrideWithValue(
          InMemorySessionProfileStore(),
        ),
        configApplyRequestRepositoryProvider.overrideWithValue(
          applyRepo ?? FakeConfigApplyRequestRepository(),
        ),
      ],
      child: router == null
          ? MaterialApp(home: TaskDetailPage(taskId: taskId))
          : MaterialApp.router(routerConfig: router),
    ),
  );
  await tester.pump(); // resolve getTask
  await tester.pump(); // resolve คำขอส่ง Config ล่าสุด (docs/25)
}

/// go_router จริง: `/tasks/:id` = หน้าจริง, `/devices/:deviceId` = หน้าปลอมที่
/// บอก deviceId ที่ได้รับ (ใช้ยืนยันว่านำทางไป path ไหน)
GoRouter _taskToDeviceRouter() => GoRouter(
  initialLocation: AppRoutes.taskDetail('t1'),
  routes: [
    GoRoute(
      path: AppRoutes.taskDetailPattern,
      builder: (_, state) =>
          TaskDetailPage(taskId: state.pathParameters['id']!),
    ),
    GoRoute(
      path: AppRoutes.deviceDetailPattern,
      builder: (_, state) =>
          Text('DEVICE_PAGE ${state.pathParameters['deviceId']}'),
    ),
  ],
);

// Filled หรือ Outlined ตามว่าแถบล่างมีปุ่มส่ง Config ด้วยไหม (docs/21 #11)
ButtonStyleButton _saveButton(WidgetTester tester) =>
    tester.widget<ButtonStyleButton>(find.byKey(const Key('task_status_save')));

Finder get _confirmInstallButton =>
    find.byKey(const Key('confirm_install_button'));

void main() {
  group('ลิงก์ไปหน้าอุปกรณ์ (UX audit #1)', () {
    testWidgets('แตะเลขอุปกรณ์ -> ไปหน้ารายละเอียดอุปกรณ์ของเครื่องนั้น', (
      tester,
    ) async {
      final router = _taskToDeviceRouter();
      addTearDown(router.dispose);
      await _pump(tester, repo: _FakeTaskRepository(), router: router);
      await tester.pump();

      await tester.tap(find.byKey(const Key('task_detail_device_link')));
      await tester.pumpAndSettle();

      expect(find.text('DEVICE_PAGE DVC-1'), findsOneWidget);
    });

    testWidgets('เป้ากดของลิงก์สูงอย่างน้อย 48dp (กดด้วยนิ้วหน้างาน)', (
      tester,
    ) async {
      await _pump(tester, repo: _FakeTaskRepository());
      await tester.pump();

      final size = tester.getSize(
        find.byKey(const Key('task_detail_device_link')),
      );
      expect(size.height, greaterThanOrEqualTo(48));
    });

    testWidgets('งานไม่มีอุปกรณ์ -> แสดง "-" และไม่มีลิงก์', (tester) async {
      await _pump(
        tester,
        repo: _FakeTaskRepository(task: _makeTask(deviceId: null)),
      );
      await tester.pump();

      expect(find.byKey(const Key('task_detail_device_link')), findsNothing);
      // ค่าว่างแสดง "-" ตาม AppInfoRow (docs/22 Batch 4 §9.1 — เดิม "—")
      expect(find.text('-'), findsWidgets);
    });
  });

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
    expect(find.text('u1'), findsOneWidget); // assignedTo
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

  // คำตอบ A ใน #303 ข้อ 1 — งานที่เสร็จแล้วห้ามเปลี่ยนสถานะย้อนกลับ (backend
  // ตอบ 409) ต้องซ่อนทั้งแถวเปลี่ยนสถานะและปุ่มบันทึก ไม่ใช่แค่ disable
  for (final role in [UserRole.st, UserRole.ot]) {
    testWidgets('${role.wireName} งานที่ completed -> ไม่เห็นแถวเปลี่ยนสถานะ '
        'และไม่มีปุ่มบันทึก', (tester) async {
      await _pump(
        tester,
        repo: _FakeTaskRepository(
          task: _makeTask(status: TaskStatus.completed),
        ),
        role: role,
      );

      expect(find.text('เปลี่ยนสถานะงาน'), findsNothing);
      expect(find.byKey(const Key('status_choice_in_progress')), findsNothing);
      expect(find.byKey(const Key('status_choice_completed')), findsNothing);
      expect(find.byKey(const Key('task_status_save')), findsNothing);
      // Scaffold ตัวใน (_TaskDetailView) เป็นตัวที่มี bottomNavigationBar
      final scaffold = tester.widget<Scaffold>(find.byType(Scaffold).last);
      expect(scaffold.bottomNavigationBar, isNull);
    });
  }

  testWidgets('Operation ไม่เห็นตัวเลือกเปลี่ยนสถานะ', (tester) async {
    await _pump(
      tester,
      repo: _FakeTaskRepository(task: _makeTask()),
      role: UserRole.operation,
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

  testWidgets(
    'backend เข้าไม่ถึง (connection error, ไม่มี statusCode) -> ข้อความไทย '
    'อ่านเข้าใจได้ + ปุ่มลองอีกครั้ง ไม่ใช่ raw exception message '
    '(regression test: เคยหลุดข้อความ Dio ดิบไปที่ UI พบตอนทดสอบบน Android '
    'Emulator 7 กันยายน 2569 — ApiClient._toApiException คือจุดที่แก้จริง, '
    'เทสนี้ยืนยันว่า task detail page แสดงข้อความที่ ApiException.message '
    'ถืออยู่ตรง ๆ ถูกต้อง)',
    (tester) async {
      await _pump(
        tester,
        repo: _FakeTaskRepository(
          getError: ApiException(
            'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ต/เซิร์ฟเวอร์แล้วลองใหม่อีกครั้ง',
          ),
        ),
      );

      expect(find.byKey(const Key('task_detail_error')), findsOneWidget);
      expect(
        find.text(
          'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ต/เซิร์ฟเวอร์แล้วลองใหม่อีกครั้ง',
        ),
        findsOneWidget,
      );
      expect(
        find.textContaining('cannot be solved by the library'),
        findsNothing,
      );
      expect(find.byKey(const Key('task_detail_retry')), findsOneWidget);
    },
  );

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

  group('Confirm Install', () {
    testWidgets(
      'ST + configId + deviceId + in_progress -> เห็นปุ่มขอส่ง Config',
      (tester) async {
        await _pump(
          tester,
          repo: _FakeTaskRepository(
            task: _makeTask(status: TaskStatus.inProgress, configId: 'cfg-1'),
          ),
          role: UserRole.st,
        );

        expect(_confirmInstallButton, findsOneWidget);
      },
    );

    testWidgets('configId เป็น null -> ไม่เห็นปุ่ม', (tester) async {
      await _pump(
        tester,
        repo: _FakeTaskRepository(
          task: _makeTask(status: TaskStatus.inProgress),
        ),
        role: UserRole.st,
      );

      expect(_confirmInstallButton, findsNothing);
    });

    testWidgets('สถานะงานยัง pending (ยังไม่เริ่ม) -> ไม่เห็นปุ่ม', (
      tester,
    ) async {
      await _pump(
        tester,
        repo: _FakeTaskRepository(
          task: _makeTask(status: TaskStatus.pending, configId: 'cfg-1'),
        ),
        role: UserRole.st,
      );

      expect(_confirmInstallButton, findsNothing);
    });

    testWidgets('สถานะงาน completed (จบไปแล้ว) -> ไม่เห็นปุ่ม', (tester) async {
      await _pump(
        tester,
        repo: _FakeTaskRepository(
          task: _makeTask(status: TaskStatus.completed, configId: 'cfg-1'),
        ),
        role: UserRole.st,
      );

      expect(_confirmInstallButton, findsNothing);
    });

    testWidgets(
      'role Operation (ไม่ใช่ ST/OT) -> ไม่เห็นปุ่มแม้เงื่อนไขอื่นครบ',
      (tester) async {
        await _pump(
          tester,
          repo: _FakeTaskRepository(
            task: _makeTask(status: TaskStatus.inProgress, configId: 'cfg-1'),
          ),
          role: UserRole.operation,
        );

        expect(_confirmInstallButton, findsNothing);
      },
    );

    testWidgets('deviceId เป็น null -> ไม่เห็นปุ่มแม้มี configId', (
      tester,
    ) async {
      await _pump(
        tester,
        repo: _FakeTaskRepository(
          task: _makeTask(
            status: TaskStatus.inProgress,
            configId: 'cfg-1',
            deviceId: null,
          ),
        ),
        role: UserRole.ot,
      );

      expect(_confirmInstallButton, findsNothing);
    });
  });

  // docs/25 — ปุ่มเดิม "ส่ง Config เข้าเครื่อง" (apply-config แบบ mock) เปลี่ยนเป็น
  // "ขอส่ง" ให้ Operation อีกคนอนุมัติ · การ์ดแสดงสถานะของคำขอล่าสุดตามตาราง §3.3
  group('คำขอส่ง Config เข้าเครื่อง (docs/25)', () {
    Task installTask() => _makeTask(
      status: TaskStatus.inProgress,
      configId: 'cfg-1',
      deviceId: 'DVC-1',
    );

    Future<FakeConfigApplyRequestRepository> pumpWith(
      WidgetTester tester, {
      List<ConfigApplyRequest>? requests,
      Object? createError,
      Object? cancelError,
      Object? listError,
    }) async {
      // จอสูงพอให้การ์ดสถานะคำขอ + ปุ่มยกเลิกอยู่ในจอ (เนื้อหาหน้านี้ยาวกว่า 600)
      tester.view.physicalSize = const Size(1080, 4000);
      tester.view.devicePixelRatio = 2;
      addTearDown(tester.view.reset);
      final applyRepo = FakeConfigApplyRequestRepository(
        requests: requests,
        createError: createError,
        cancelError: cancelError,
        listError: listError,
      );
      await _pump(
        tester,
        repo: _FakeTaskRepository(task: installTask()),
        role: UserRole.st,
        applyRepo: applyRepo,
      );
      return applyRepo;
    }

    Finder statusNotice() => find.byKey(const Key('apply_request_status'));
    Finder cancelButton() =>
        find.byKey(const Key('cancel_apply_request_button'));

    testWidgets(
      'ยังไม่เคยขอ -> ปุ่ม "ขอส่ง Config เข้าเครื่อง" กดได้ ไม่มีการ์ดสถานะ',
      (tester) async {
        await pumpWith(tester);

        expect(find.text('ขอส่ง Config เข้าเครื่อง'), findsOneWidget);
        expect(
          tester.widget<FilledButton>(_confirmInstallButton).onPressed,
          isNotNull,
        );
        expect(statusNotice(), findsNothing);
      },
    );

    testWidgets('กดขอส่ง -> สร้างคำขอด้วย taskId (ไม่ส่ง config/device เอง) + '
        'snackbar + การ์ดเป็น "รอ Operation อนุมัติ" + ปุ่มขอหายไป', (
      tester,
    ) async {
      final applyRepo = await pumpWith(tester);

      await tester.tap(_confirmInstallButton);
      await tester.pump(); // create
      await tester.pump(); // reload คำขอล่าสุด
      await tester.pump();

      expect(applyRepo.createCalls, 1);
      expect(applyRepo.lastCreateTaskId, 't1');
      expect(
        find.text(
          'ส่งคำขอแล้ว — รอ Operation อีกคนอนุมัติก่อนระบบส่งเข้ากล่อง',
        ),
        findsOneWidget,
      );
      expect(find.text('รอ Operation อนุมัติ'), findsOneWidget);
      expect(_confirmInstallButton, findsNothing);
      expect(cancelButton(), findsOneWidget);

      await tester.pump(const Duration(seconds: 5)); // snackbar timeout
      await tester.pumpAndSettle();
    });

    testWidgets('มีคำขอ pending -> เห็นเวลาขอ/หมดอายุ + ปุ่มยกเลิก, '
        'แถบล่างไม่มีปุ่มขอซ้ำ', (tester) async {
      await pumpWith(tester, requests: [fakeApplyRequest()]);

      expect(statusNotice(), findsOneWidget);
      expect(find.textContaining('ส่งคำขอเมื่อ'), findsOneWidget);
      expect(find.textContaining('หมดอายุ'), findsOneWidget);
      expect(cancelButton(), findsOneWidget);
      expect(_confirmInstallButton, findsNothing);
    });

    testWidgets('กดยกเลิกคำขอ -> เรียก cancel ด้วย id + snackbar + '
        'กลับมาขอใหม่ได้ด้วยปุ่ม "ขอส่งอีกครั้ง"', (tester) async {
      final applyRepo = await pumpWith(
        tester,
        requests: [fakeApplyRequest(id: 'car-9')],
      );

      await tester.ensureVisible(cancelButton());
      await tester.tap(cancelButton());
      await tester.pump();
      await tester.pump();
      await tester.pump();

      expect(applyRepo.cancelCalls, 1);
      expect(applyRepo.lastCancelId, 'car-9');
      expect(find.text('ยกเลิกคำขอแล้ว'), findsWidgets);
      expect(find.text('ขอส่งอีกครั้ง'), findsOneWidget);
      expect(cancelButton(), findsNothing);

      await tester.pump(const Duration(seconds: 5));
      await tester.pumpAndSettle();
    });

    testWidgets('ยกเลิกไม่สำเร็จ (409 ถูกตัดสินไปแล้ว) -> ข้อความจาก backend', (
      tester,
    ) async {
      await pumpWith(
        tester,
        requests: [fakeApplyRequest()],
        cancelError: ApiException(
          'ยกเลิกได้เฉพาะคำขอที่รออนุมัติ — สถานะปัจจุบัน: sending',
          statusCode: 409,
        ),
      );

      await tester.ensureVisible(cancelButton());
      await tester.tap(cancelButton());
      await tester.pump();
      await tester.pump();

      expect(
        find.byKey(const Key('cancel_apply_request_error')),
        findsOneWidget,
      );
    });

    testWidgets(
      'sending -> "อนุมัติแล้ว กำลังส่ง รอกล่องยืนยัน" ไม่มีปุ่มขอ/ยกเลิก',
      (tester) async {
        await pumpWith(
          tester,
          requests: [
            fakeApplyRequest(
              status: ConfigApplyRequestStatus.sending,
              decidedAt: DateTime.utc(2026, 10, 22, 4),
            ),
          ],
        );

        expect(find.text('อนุมัติแล้ว กำลังส่ง รอกล่องยืนยัน'), findsOneWidget);
        expect(find.textContaining('อนุมัติเมื่อ'), findsOneWidget);
        expect(_confirmInstallButton, findsNothing);
        expect(cancelButton(), findsNothing);
      },
    );

    testWidgets('succeeded -> "กล่องรับ Config แล้ว" ไม่มีปุ่มขอซ้ำ', (
      tester,
    ) async {
      await pumpWith(
        tester,
        requests: [
          fakeApplyRequest(
            status: ConfigApplyRequestStatus.succeeded,
            completedAt: DateTime.utc(2026, 10, 22, 5),
          ),
        ],
      );

      expect(find.text('กล่องรับ Config แล้ว'), findsOneWidget);
      expect(_confirmInstallButton, findsNothing);
    });

    testWidgets(
      'rejected -> เหตุผลของ Operation + ปุ่ม "ขอส่งอีกครั้ง" กดได้',
      (tester) async {
        await pumpWith(
          tester,
          requests: [
            fakeApplyRequest(
              status: ConfigApplyRequestStatus.rejected,
              rejectReason: 'ค่า APN ไม่ตรงกับซิมของลูกค้า',
            ),
          ],
        );

        expect(find.text('Operation ปฏิเสธคำขอ'), findsOneWidget);
        expect(
          find.text('เหตุผล: ค่า APN ไม่ตรงกับซิมของลูกค้า'),
          findsOneWidget,
        );
        expect(find.text('ขอส่งอีกครั้ง'), findsOneWidget);
        expect(
          tester.widget<FilledButton>(_confirmInstallButton).onPressed,
          isNotNull,
        );
      },
    );

    for (final (status, detail) in [
      (ConfigApplyRequestStatus.failed, 'กล่องปฏิเสธค่า SERVER_PORT'),
      (ConfigApplyRequestStatus.skippedOffline, 'กล่องออฟไลน์เกินเวลาส่ง'),
      (
        ConfigApplyRequestStatus.expired,
        'ไม่มี Operation ตัดสินภายใน 24 ชั่วโมง คำขอหมดอายุ',
      ),
      (
        ConfigApplyRequestStatus.cancelled,
        'งานถูกยกเลิก ระบบยกเลิกคำขอให้อัตโนมัติ',
      ),
    ]) {
      testWidgets('${status.wireName} -> แสดงเหตุผล + ขอส่งอีกครั้งได้', (
        tester,
      ) async {
        await pumpWith(
          tester,
          requests: [fakeApplyRequest(status: status, resultDetail: detail)],
        );

        expect(find.text(detail), findsOneWidget);
        expect(find.text('ขอส่งอีกครั้ง'), findsOneWidget);
      });
    }

    testWidgets('409 ตอนขอ (เช่น งานไม่มีข้อมูลผู้ผูก Config) -> ข้อความจาก '
        'backend เหนือปุ่ม และกดใหม่ได้', (tester) async {
      await pumpWith(
        tester,
        createError: ApiException(
          'งานนี้ยังไม่มีข้อมูลผู้ผูก Config ให้ Operation ผูก Config ใหม่ก่อน',
          statusCode: 409,
        ),
      );

      await tester.tap(_confirmInstallButton);
      await tester.pump();
      await tester.pump();
      await tester.pump();

      expect(find.byKey(const Key('confirm_install_error')), findsOneWidget);
      expect(
        find.text(
          'งานนี้ยังไม่มีข้อมูลผู้ผูก Config ให้ Operation ผูก Config ใหม่ก่อน',
        ),
        findsOneWidget,
      );
      expect(
        tester.widget<FilledButton>(_confirmInstallButton).onPressed,
        isNotNull,
      );
    });

    testWidgets('ออฟไลน์ตอนขอ -> ข้อความไทยจาก ApiException (ไม่เข้าคิว offline)', (
      tester,
    ) async {
      final applyRepo = await pumpWith(
        tester,
        createError: ApiException(
          'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ต/เซิร์ฟเวอร์แล้วลองใหม่อีกครั้ง',
        ),
      );

      await tester.tap(_confirmInstallButton);
      await tester.pump();
      await tester.pump();

      expect(
        find.text(
          'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ต/เซิร์ฟเวอร์แล้วลองใหม่อีกครั้ง',
        ),
        findsOneWidget,
      );
      expect(applyRepo.requests, isEmpty);
    });

    testWidgets(
      'โหลดสถานะคำขอไม่สำเร็จ -> ปุ่มขอกดไม่ได้ (ไม่รู้ว่ามีคำขอค้าง) '
      '+ ลองใหม่แล้วโหลดได้',
      (tester) async {
        final applyRepo = await pumpWith(
          tester,
          listError: ApiException('เซิร์ฟเวอร์ล่ม', statusCode: 500),
        );

        expect(
          find.byKey(const Key('apply_request_load_error')),
          findsOneWidget,
        );
        expect(
          tester.widget<FilledButton>(_confirmInstallButton).onPressed,
          isNull,
        );

        applyRepo.listError = null;
        await tester.ensureVisible(
          find.byKey(const Key('apply_request_retry')),
        );
        await tester.tap(find.byKey(const Key('apply_request_retry')));
        await tester.pump();
        await tester.pump();

        expect(find.byKey(const Key('apply_request_load_error')), findsNothing);
        expect(
          tester.widget<FilledButton>(_confirmInstallButton).onPressed,
          isNotNull,
        );
      },
    );
  });

  group('Bottom action bar', () {
    // แถบล่างวัดความกว้าง label ด้วยฟอนต์จริง (ตัดสินว่าวางเคียงกันได้ไหม) —
    // ฟอนต์ทดสอบของ flutter_test กว้าง 1em ทุกตัวอักษร ยาวเกินจริงหลายเท่า โหลด
    // Anuphan จริงแบบเดียวกับ large_text_layout_test.dart
    setUpAll(() async {
      final loader = FontLoader(AppTypography.fontFamily)
        ..addFont(rootBundle.load('assets/fonts/Anuphan[wght].ttf'));
      await loader.load();
    });

    testWidgets(
      'ทั้ง 2 ปุ่มโชว์พร้อมกันได้จริง (ST + in_progress + configId/deviceId '
      'ครบ) -> เรียงกันเป็น Column ไม่ซ้อนทับ, ไม่ต้อง scroll หาปุ่มเลย',
      (tester) async {
        await _pump(
          tester,
          repo: _FakeTaskRepository(
            task: _makeTask(status: TaskStatus.inProgress, configId: 'cfg-1'),
          ),
          role: UserRole.st,
        );

        // ไม่มีการ scroll ก่อนเลย — ปุ่มต้องเจอทันทีเพราะอยู่ใน
        // bottomNavigationBar ไม่ใช่ท้าย ListView อีกต่อไป
        expect(find.byKey(const Key('task_status_save')), findsOneWidget);
        expect(_confirmInstallButton, findsOneWidget);

        final save = tester.getRect(find.byKey(const Key('task_status_save')));
        final confirm = tester.getRect(_confirmInstallButton);
        // ไม่ซ้อนทับกัน — บันทึกสถานะซ้าย, ส่ง Config (ปุ่มหลัก) ขวา
        expect(save.overlaps(confirm), isFalse);
        expect(save.right, lessThanOrEqualTo(confirm.left));
      },
    );

    group('2 ปุ่มบนจอโทรศัพท์ (411dp): เคียงกันแถวเดียว แถบเตี้ยลง', () {
      // เดิมวางซ้อน 2 แถว แถบสูง ~156dp (17% ของจอ) บังเนื้อหา · ตอนนี้แถวเดียว
      // บันทึกสถานะ (รอง) ซ้าย 2 ส่วน, ส่ง Config (หลัก) ขวา 3 ส่วน สูง 48 เท่าเดิม
      void phoneView(WidgetTester tester, {double textScale = 1}) {
        tester.view.physicalSize = const Size(1080, 2424);
        tester.view.devicePixelRatio = 2.625;
        tester.platformDispatcher.textScaleFactorTestValue = textScale;
        addTearDown(tester.view.reset);
        addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      }

      Future<void> pumpBoth(WidgetTester tester) => _pump(
        tester,
        repo: _FakeTaskRepository(
          task: _makeTask(status: TaskStatus.inProgress, configId: 'cfg-1'),
        ),
        role: UserRole.st,
      );

      testWidgets('แถวเดียวกัน สูง 48 ปุ่มหลักขวาและกว้างกว่า ชิดขอบ 16', (
        tester,
      ) async {
        phoneView(tester);
        await pumpBoth(tester);

        final save = tester.getRect(find.byKey(const Key('task_status_save')));
        final confirm = tester.getRect(_confirmInstallButton);
        final width =
            tester.view.physicalSize.width / tester.view.devicePixelRatio;

        expect(save.top, confirm.top);
        expect(save.height, 48);
        expect(confirm.height, 48);
        expect(save.left, 16);
        expect(confirm.right, width - 16);
        expect(confirm.left - save.right, 8);
        expect(confirm.width, greaterThan(save.width));
        // label ทั้งสองอยู่บรรทัดเดียว (ไม่ตัดขึ้นบรรทัดใหม่จนปุ่มสูงเกิน)
        expect(
          tester.getSize(find.text('ขอส่ง Config เข้าเครื่อง')).height,
          lessThan(32),
        );
      });

      testWidgets('ตัวอักษรใหญ่ (×1.6) ไม่พอแถวเดียว -> ซ้อน 2 แถวแบบเดิม '
          'ไม่ย่อหรือตัดข้อความ', (tester) async {
        phoneView(tester, textScale: 1.6);
        await pumpBoth(tester);

        final save = tester.getRect(find.byKey(const Key('task_status_save')));
        final confirm = tester.getRect(_confirmInstallButton);
        final width =
            tester.view.physicalSize.width / tester.view.devicePixelRatio;
        expect(save.bottom, lessThan(confirm.top));
        expect(save.width, width - 32);
        expect(confirm.width, width - 32);
      });

      testWidgets('error ของทั้งสองปุ่มอยู่เหนือแถวปุ่ม เต็มความกว้าง', (
        tester,
      ) async {
        phoneView(tester);
        final repo = _FakeTaskRepository(
          task: _makeTask(status: TaskStatus.inProgress, configId: 'cfg-1'),
          updateError: ApiException('forbidden', statusCode: 403),
        );
        await _pump(tester, repo: repo, role: UserRole.st);
        await tester.tap(find.byKey(const Key('status_choice_completed')));
        await tester.pump();
        await tester.tap(find.byKey(const Key('task_status_save')));
        await tester.pump();
        await tester.pump();

        final error = find.byKey(const Key('task_status_error'));
        expect(error, findsOneWidget);
        expect(
          tester.getBottomLeft(error).dy,
          lessThan(tester.getTopLeft(_confirmInstallButton).dy),
        );
        expect(
          tester.getBottomLeft(error).dy,
          lessThan(
            tester.getTopLeft(find.byKey(const Key('task_status_save'))).dy,
          ),
        );
      });

      testWidgets('ปุ่มเดียว -> เต็มความกว้างเหมือนเดิม', (tester) async {
        phoneView(tester);
        await _pump(
          tester,
          repo: _FakeTaskRepository(
            task: _makeTask(status: TaskStatus.pending),
          ),
          role: UserRole.st,
        );
        final save = tester.getRect(find.byKey(const Key('task_status_save')));
        final width =
            tester.view.physicalSize.width / tester.view.devicePixelRatio;
        expect(save.left, 16);
        expect(save.width, width - 32);
        expect(save.height, 48);
      });
    });

    testWidgets(
      'error ของแต่ละปุ่มอยู่เหนือปุ่มของมันเองใน bottom bar (ไม่ใช่ลอยอยู่'
      'บนเนื้อหาด้านบน)',
      (tester) async {
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

        final errorOffset = tester.getTopLeft(
          find.byKey(const Key('task_status_error')),
        );
        final buttonOffset = tester.getTopLeft(
          find.byKey(const Key('task_status_save')),
        );
        expect(errorOffset.dy, lessThan(buttonOffset.dy));
      },
    );

    testWidgets('Operation (ไม่เห็นปุ่มไหนเลย) -> ไม่มี bottomNavigationBar', (
      tester,
    ) async {
      await _pump(
        tester,
        repo: _FakeTaskRepository(
          task: _makeTask(status: TaskStatus.inProgress, configId: 'cfg-1'),
        ),
        role: UserRole.operation,
      );

      // 2 Scaffold ซ้อนกัน (นอก: TaskDetailPage มีหัวหน้าจอ, ใน: _TaskDetailView
      // มี bottomNavigationBar) — ตัวที่ deepest คือตัวใน
      final scaffold = tester.widget<Scaffold>(find.byType(Scaffold).last);
      expect(scaffold.bottomNavigationBar, isNull);
    });
  });

  group('ประวัติงาน (Task Event History, issue #296)', () {
    final timeline = [
      TaskEvent(
        id: 'e1',
        taskId: 't1',
        toStatus: TaskStatus.pending,
        changedBy: 'op1',
        changedByName: 'คุณสั่งงาน',
        changedAt: DateTime(2026, 9, 1, 8),
      ),
      TaskEvent(
        id: 'e2',
        taskId: 't1',
        fromStatus: TaskStatus.pending,
        toStatus: TaskStatus.inProgress,
        changedBy: 'u1',
        changedByName: 'ช่างสมชาย',
        changedAt: DateTime(2026, 9, 2, 9, 15),
      ),
      TaskEvent(
        id: 'e3',
        taskId: 't1',
        changedBy: 'u1',
        changedByName: 'ช่างสมชาย',
        changedAt: DateTime(2026, 9, 2, 9, 40),
        note: 'ลูกค้าไม่อยู่ นัดใหม่พรุ่งนี้',
      ),
    ];

    // the timeline is the last section — scroll the detail list to its end
    // so nothing in it sits under the bottom action bar
    Future<void> scrollToTimeline(WidgetTester tester) async {
      await tester.pump(); // resolve getEvents
      await tester.drag(find.byType(ListView).first, const Offset(0, -3000));
      await tester.pump();
    }

    testWidgets(
      'แสดง สร้างงาน → เปลี่ยนสถานะ → บันทึก ตามลำดับเวลา พร้อมชื่อผู้ทำ',
      (tester) async {
        await _pump(
          tester,
          repo: _FakeTaskRepository(
            task: _makeTask(status: TaskStatus.inProgress),
          ),
          eventRepo: _FakeTaskEventRepository(events: timeline),
        );
        await scrollToTimeline(tester);

        final created = tester.getTopLeft(find.text('สร้างงาน')).dy;
        final changed = tester
            .getTopLeft(find.text('เปลี่ยนสถานะ: รอดำเนินการ → กำลังทำ'))
            .dy;
        final note = tester
            .getTopLeft(find.text('ลูกค้าไม่อยู่ นัดใหม่พรุ่งนี้'))
            .dy;
        expect(created < changed && changed < note, isTrue);
        expect(find.text('คุณสั่งงาน · 01/09/2026 08:00'), findsOneWidget);
        expect(find.text('ช่างสมชาย · 02/09/2026 09:15'), findsOneWidget);
      },
    );

    testWidgets(
      'event ที่ไม่รู้ผู้ทำ (backfill งานเก่า) แสดง "ไม่ทราบผู้ทำรายการ"',
      (tester) async {
        await _pump(
          tester,
          repo: _FakeTaskRepository(),
          eventRepo: _FakeTaskEventRepository(
            events: [
              TaskEvent(
                id: 'e1',
                taskId: 't1',
                toStatus: TaskStatus.pending,
                changedAt: DateTime(2026, 9, 1, 8),
              ),
            ],
          ),
        );
        await scrollToTimeline(tester);

        expect(
          find.text('ไม่ทราบผู้ทำรายการ · 01/09/2026 08:00'),
          findsOneWidget,
        );
      },
    );

    testWidgets('โหลดไม่สำเร็จ -> ข้อความ + ปุ่มลองใหม่ที่โหลดซ้ำได้', (
      tester,
    ) async {
      final events = _FakeTaskEventRepository(
        getError: ApiException('offline'),
      );
      await _pump(tester, repo: _FakeTaskRepository(), eventRepo: events);
      await scrollToTimeline(tester);

      expect(find.byKey(const Key('task_timeline_error')), findsOneWidget);

      events
        ..getError = null
        ..events.addAll(timeline);
      await tester.tap(find.byKey(const Key('task_timeline_retry')));
      await tester.pump();
      await tester.pump();

      expect(find.text('สร้างงาน'), findsOneWidget);
    });

    for (final (label, role, status, visible) in [
      ('ST งานที่ยังไม่ยกเลิก', UserRole.st, TaskStatus.pending, true),
      ('OT งานที่ยังไม่ยกเลิก', UserRole.ot, TaskStatus.inProgress, true),
      ('Operation', UserRole.operation, TaskStatus.completed, true),
      ('ST งานที่ถูกยกเลิกแล้ว', UserRole.st, TaskStatus.cancelled, false),
      ('role อื่น (Auditor)', UserRole.auditor, TaskStatus.pending, false),
    ]) {
      testWidgets(
        'ปุ่มเพิ่มบันทึก: $label -> ${visible ? 'เห็น' : 'ไม่เห็น'}',
        (tester) async {
          await _pump(
            tester,
            role: role,
            repo: _FakeTaskRepository(task: _makeTask(status: status)),
          );
          await scrollToTimeline(tester);

          expect(
            find.byKey(const Key('task_add_note_button')),
            visible ? findsOneWidget : findsNothing,
          );
        },
      );
    }

    testWidgets(
      'เพิ่มบันทึก: กดบันทึกไม่ได้จนกว่าจะพิมพ์, ส่งข้อความที่ตัดช่องว่างแล้ว, ปิด sheet และ timeline โหลดใหม่',
      (tester) async {
        final events = _FakeTaskEventRepository(events: [timeline.first]);
        await _pump(tester, repo: _FakeTaskRepository(), eventRepo: events);
        await scrollToTimeline(tester);
        final callsBefore = events.getCalls;

        await tester.tap(find.byKey(const Key('task_add_note_button')));
        await tester.pumpAndSettle();

        FilledButton save() => tester.widget<FilledButton>(
          find.byKey(const Key('task_note_save')),
        );
        expect(save().onPressed, isNull);
        await tester.enterText(find.byKey(const Key('task_note_field')), '   ');
        await tester.pump();
        expect(save().onPressed, isNull);

        await tester.enterText(
          find.byKey(const Key('task_note_field')),
          '  ถึงหน้างานแล้ว  ',
        );
        await tester.pump();
        await tester.tap(find.byKey(const Key('task_note_save')));
        await tester.pumpAndSettle();

        expect(events.addedNotes, ['ถึงหน้างานแล้ว']);
        expect(find.byKey(const Key('task_note_field')), findsNothing);
        expect(find.text('เพิ่มบันทึกแล้ว'), findsOneWidget);
        expect(events.getCalls, greaterThan(callsBefore));
        expect(find.text('ถึงหน้างานแล้ว'), findsOneWidget);
      },
    );

    for (final (label, error, message) in [
      (
        'offline (ไม่มี statusCode) -> บอกว่าต้องใช้อินเทอร์เน็ต ไม่เข้าคิว',
        ApiException('offline'),
        'เพิ่มบันทึกต้องใช้อินเทอร์เน็ต กรุณาลองใหม่เมื่อเชื่อมต่อได้',
      ),
      (
        '409 งานถูกยกเลิกระหว่างนั้น',
        ApiException('cancelled', statusCode: 409),
        'งานนี้ถูกยกเลิกแล้ว เพิ่มบันทึกไม่ได้',
      ),
    ]) {
      testWidgets(
        'เพิ่มบันทึกไม่สำเร็จ: $label (sheet ยังเปิดอยู่ ข้อความไม่หาย)',
        (tester) async {
          final events = _FakeTaskEventRepository()..addError = error;
          await _pump(tester, repo: _FakeTaskRepository(), eventRepo: events);
          await scrollToTimeline(tester);

          await tester.tap(find.byKey(const Key('task_add_note_button')));
          await tester.pumpAndSettle();
          await tester.enterText(find.byKey(const Key('task_note_field')), 'x');
          await tester.pump();
          await tester.tap(find.byKey(const Key('task_note_save')));
          await tester.pumpAndSettle();

          expect(find.byKey(const Key('task_note_error')), findsOneWidget);
          expect(find.text(message), findsOneWidget);
          expect(find.byKey(const Key('task_note_field')), findsOneWidget);
        },
      );
    }
  });

  // docs/22 Batch 5 — หัวหน้าจอแบบ AppPageHeader แทน AppBar สีกรมท่า
  group('หัวหน้าจอ (AppPageHeader)', () {
    testWidgets('ชื่อหน้า + ป้ายสถานะงานบนหัวหน้าจอ ไม่มี AppBar', (
      tester,
    ) async {
      await _pump(
        tester,
        repo: _FakeTaskRepository(
          task: _makeTask(status: TaskStatus.inProgress),
        ),
      );

      expect(find.byType(AppBar), findsNothing);
      final header = find.byType(AppPageHeader);
      expect(
        find.descendant(of: header, matching: find.text('รายละเอียดงาน')),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: header,
          matching: find.byKey(const Key('task_detail_status_badge')),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(of: header, matching: find.text('กำลังทำ')),
        findsOneWidget,
      );
      expect(AppV2Theme.isActive(tester.element(header)), isTrue);
    });

    testWidgets('งานที่ยังรอซิงค์ -> ป้าย "รอซิงค์" อยู่ข้างป้ายสถานะ', (
      tester,
    ) async {
      await _pump(
        tester,
        repo: _FakeTaskRepository(task: _makeTask()),
        pendingIds: {'t1'},
      );
      await tester.pump();

      expect(
        find.descendant(
          of: find.byType(AppPageHeader),
          matching: find.byKey(const Key('pending_sync_badge')),
        ),
        findsOneWidget,
      );
    });
  });

  // docs/21 #11 — เดิมแถบล่างมี FilledButton 2 ปุ่มหน้าตาเหมือนกัน ไม่รู้ว่าปุ่มไหน
  // สำคัญกว่า → ปุ่มหลักได้ปุ่มเดียว ขนาดเท่าเดิม
  group('ปุ่มหลัก/รองในแถบล่าง (docs/21 #11)', () {
    testWidgets(
      'มีทั้งบันทึกสถานะและส่ง Config -> ส่ง Config เป็นปุ่มหลัก (ขวาสุด) '
      'บันทึกสถานะเป็น outline สูงเท่ากัน',
      (tester) async {
        await _pump(
          tester,
          repo: _FakeTaskRepository(
            task: _makeTask(status: TaskStatus.inProgress, configId: 'cfg-1'),
          ),
        );

        final save = find.byKey(const Key('task_status_save'));
        expect(tester.widget(save), isA<OutlinedButton>());
        expect(tester.widget(_confirmInstallButton), isA<FilledButton>());
        // ในแถบล่างมีปุ่มหลัก (FilledButton) ปุ่มเดียว
        final scaffold = find.byType(Scaffold).last;
        final bar = tester.widget<Scaffold>(scaffold).bottomNavigationBar!;
        expect(
          find.descendant(
            of: find.byWidget(bar),
            matching: find.byType(FilledButton),
          ),
          findsOneWidget,
        );
        // ปุ่มหลักอยู่ท้าย (ขวา) แถวเดียวกัน สูงเท่ากัน >= 48 — เดิมซ้อนกันโดย
        // ปุ่มหลักอยู่ล่างสุด เปลี่ยนเป็นเคียงกันเพื่อลดความสูงแถบล่าง
        expect(
          tester.getTopLeft(_confirmInstallButton).dx,
          greaterThan(tester.getTopLeft(save).dx),
        );
        expect(
          tester.getTopLeft(_confirmInstallButton).dy,
          tester.getTopLeft(save).dy,
        );
        expect(
          tester.getSize(save).height,
          tester.getSize(_confirmInstallButton).height,
        );
        expect(tester.getSize(save).height, greaterThanOrEqualTo(48));
      },
    );

    testWidgets('มีแค่บันทึกสถานะ -> เป็นปุ่มหลัก', (tester) async {
      await _pump(tester, repo: _FakeTaskRepository(task: _makeTask()));

      expect(
        tester.widget(find.byKey(const Key('task_status_save'))),
        isA<FilledButton>(),
      );
      expect(_confirmInstallButton, findsNothing);
    });
  });
}
