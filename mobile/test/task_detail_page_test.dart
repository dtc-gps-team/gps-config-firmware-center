import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/db/app_database.dart';
import 'package:mobile/core/db/providers/database_provider.dart';
import 'package:mobile/core/sync/sync_providers.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/auth/auth_controller.dart';
import 'package:mobile/core/auth/token_store.dart';
import 'package:mobile/features/device_search/device_status_repository.dart';
import 'package:mobile/features/task/confirm_install_repository.dart';
import 'package:mobile/features/task/task_detail_page.dart';
import 'package:mobile/features/task/task_event_repository.dart';
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

class _FakeConfirmInstallRepository implements ConfirmInstallRepository {
  _FakeConfirmInstallRepository({this.result, this.error});

  final ConfigApplyResult? result;
  final Object? error;

  int calls = 0;
  String? lastDeviceId;
  String? lastConfigId;
  String? lastRolloutId;

  @override
  Future<ConfigApplyResult> applyConfig({
    required String deviceId,
    required String configId,
    String? rolloutId,
  }) async {
    calls++;
    lastDeviceId = deviceId;
    lastConfigId = configId;
    lastRolloutId = rolloutId;
    if (error != null) throw error!;
    return result ??
        ConfigApplyResult(
          applied: true,
          details: const ['ok'],
          appliedAt: DateTime(2026, 9, 11),
        );
  }
}

class _FakeDeviceStatusRepository implements DeviceStatusRepository {
  _FakeDeviceStatusRepository({
    this.configStatus = DevicePayloadStatus.unknown,
    this.configRolloutId,
    this.error,
  });

  final DevicePayloadStatus configStatus;
  final String? configRolloutId;
  final Object? error;

  @override
  Future<DeviceStatus> getDeviceStatus(String deviceId) async {
    if (error != null) throw error!;
    return DeviceStatus(
      deviceId: deviceId,
      configStatus: configStatus,
      firmwareStatus: DevicePayloadStatus.unknown,
      configRolloutId: configRolloutId,
    );
  }
}

Future<void> _pump(
  WidgetTester tester, {
  required TaskRepository repo,
  UserRole? role = UserRole.st,
  String taskId = 't1',
  ConfirmInstallRepository? confirmInstallRepo,
  DeviceStatusRepository? statusRepo,
  Set<String> pendingIds = const {},
  TaskEventRepository? eventRepo,
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
        confirmInstallRepositoryProvider.overrideWithValue(
          confirmInstallRepo ?? _FakeConfirmInstallRepository(),
        ),
        deviceStatusRepositoryProvider.overrideWithValue(
          statusRepo ?? _FakeDeviceStatusRepository(),
        ),
      ],
      child: MaterialApp(home: TaskDetailPage(taskId: taskId)),
    ),
  );
  await tester.pump(); // resolve getTask
}

FilledButton _saveButton(WidgetTester tester) =>
    tester.widget<FilledButton>(find.byKey(const Key('task_status_save')));

Finder get _confirmInstallButton =>
    find.byKey(const Key('confirm_install_button'));

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
      'ST + configId + deviceId + in_progress -> เห็นปุ่มยืนยันติดตั้ง',
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

    testWidgets(
      'กดยืนยัน -> เรียก repo ด้วย deviceId/configId ของ task + snackbar + '
      'ปุ่มเปลี่ยนเป็น disabled ถาวร (กันกดซ้ำ)',
      (tester) async {
        final confirmRepo = _FakeConfirmInstallRepository(
          result: ConfigApplyResult(
            applied: true,
            details: const ['ส่ง Config 3 ฟิลด์ให้ DVC-1 แล้ว'],
            appliedAt: DateTime(2026, 9, 11),
          ),
        );
        await _pump(
          tester,
          repo: _FakeTaskRepository(
            task: _makeTask(
              status: TaskStatus.inProgress,
              configId: 'cfg-1',
              deviceId: 'DVC-1',
            ),
          ),
          role: UserRole.st,
          confirmInstallRepo: confirmRepo,
        );

        await tester.tap(_confirmInstallButton);
        await tester.pump(); // kick off _confirmInstall
        await tester.pump(); // await applyConfig

        expect(confirmRepo.calls, 1);
        expect(confirmRepo.lastDeviceId, 'DVC-1');
        expect(confirmRepo.lastConfigId, 'cfg-1');
        expect(
          find.text(
            'ส่ง Config เข้าเครื่องแล้ว — กล่องจะรับค่าเมื่อเปิดเครื่องครั้งถัดไป',
          ),
          findsOneWidget,
        );
        expect(find.text('ส่ง Config เข้าเครื่องแล้ว'), findsOneWidget);
        expect(
          tester.widget<FilledButton>(_confirmInstallButton).onPressed,
          isNull,
        );

        await tester.pump(const Duration(seconds: 5)); // snackbar timeout
        await tester.pumpAndSettle();
      },
    );

    testWidgets(
      'applied: false (200 แต่ field ไม่ผ่าน pre-flight) -> แสดง details '
      'เป็น error, ปุ่มกดซ้ำได้',
      (tester) async {
        final confirmRepo = _FakeConfirmInstallRepository(
          result: ConfigApplyResult(
            applied: false,
            details: const ['ฟิลด์ "Timeout" ต้องไม่ติดลบ'],
            appliedAt: DateTime(2026, 9, 11),
          ),
        );
        await _pump(
          tester,
          repo: _FakeTaskRepository(
            task: _makeTask(
              status: TaskStatus.inProgress,
              configId: 'cfg-1',
              deviceId: 'DVC-1',
            ),
          ),
          role: UserRole.st,
          confirmInstallRepo: confirmRepo,
        );

        await tester.tap(_confirmInstallButton);
        await tester.pump();
        await tester.pump();

        expect(find.byKey(const Key('confirm_install_error')), findsOneWidget);
        expect(find.text('ฟิลด์ "Timeout" ต้องไม่ติดลบ'), findsOneWidget);
        expect(
          tester.widget<FilledButton>(_confirmInstallButton).onPressed,
          isNotNull,
        );
      },
    );

    testWidgets(
      '409 (device ยังไม่ installed) -> ข้อความจาก backend, ปุ่มกดซ้ำได้',
      (tester) async {
        final confirmRepo = _FakeConfirmInstallRepository(
          error: ApiException(
            'Device สถานะปัจจุบัน (registered) ยังใส่ Config ไม่ได้ — '
            'ต้องเป็น installed (ติดตั้งจริงแล้ว) เท่านั้น',
            statusCode: 409,
          ),
        );
        await _pump(
          tester,
          repo: _FakeTaskRepository(
            task: _makeTask(
              status: TaskStatus.inProgress,
              configId: 'cfg-1',
              deviceId: 'DVC-1',
            ),
          ),
          role: UserRole.st,
          confirmInstallRepo: confirmRepo,
        );

        await tester.tap(_confirmInstallButton);
        await tester.pump();
        await tester.pump();

        expect(find.byKey(const Key('confirm_install_error')), findsOneWidget);
        expect(
          find.text(
            'Device สถานะปัจจุบัน (registered) ยังใส่ Config ไม่ได้ — '
            'ต้องเป็น installed (ติดตั้งจริงแล้ว) เท่านั้น',
          ),
          findsOneWidget,
        );
        expect(
          tester.widget<FilledButton>(_confirmInstallButton).onPressed,
          isNotNull,
        );
      },
    );

    testWidgets(
      'backend เข้าไม่ถึง (connection error) -> ข้อความไทยจาก ApiException, '
      'ไม่ใช่ raw exception',
      (tester) async {
        final confirmRepo = _FakeConfirmInstallRepository(
          error: ApiException(
            'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ต/เซิร์ฟเวอร์แล้วลองใหม่อีกครั้ง',
          ),
        );
        await _pump(
          tester,
          repo: _FakeTaskRepository(
            task: _makeTask(
              status: TaskStatus.inProgress,
              configId: 'cfg-1',
              deviceId: 'DVC-1',
            ),
          ),
          role: UserRole.st,
          confirmInstallRepo: confirmRepo,
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
      },
    );
  });

  group('Confirm Install — rolloutId (issue #265)', () {
    Future<_FakeConfirmInstallRepository> pressConfirm(
      WidgetTester tester,
      DeviceStatusRepository statusRepo,
    ) async {
      final confirmRepo = _FakeConfirmInstallRepository();
      await _pump(
        tester,
        repo: _FakeTaskRepository(
          task: _makeTask(
            status: TaskStatus.inProgress,
            configId: 'cfg-1',
            deviceId: 'DVC-1',
          ),
        ),
        role: UserRole.st,
        confirmInstallRepo: confirmRepo,
        statusRepo: statusRepo,
      );
      await tester.tap(_confirmInstallButton);
      await tester.pump();
      await tester.pump();
      await tester.pump();
      return confirmRepo;
    }

    testWidgets('configStatus pending + มี configRolloutId -> ส่ง rolloutId', (
      tester,
    ) async {
      final repo = await pressConfirm(
        tester,
        _FakeDeviceStatusRepository(
          configStatus: DevicePayloadStatus.pending,
          configRolloutId: 'rollout-9',
        ),
      );
      expect(repo.calls, 1);
      expect(repo.lastRolloutId, 'rollout-9');
      await tester.pump(const Duration(seconds: 5));
    });

    testWidgets('ไม่ pending (ไม่มี rollout) -> ไม่ส่ง rolloutId', (
      tester,
    ) async {
      final repo = await pressConfirm(tester, _FakeDeviceStatusRepository());
      expect(repo.calls, 1);
      expect(repo.lastRolloutId, isNull);
      await tester.pump(const Duration(seconds: 5));
    });

    testWidgets('โหลดสถานะไม่สำเร็จ -> ยังส่ง Config ได้ โดยไม่มี rolloutId', (
      tester,
    ) async {
      final repo = await pressConfirm(
        tester,
        _FakeDeviceStatusRepository(
          error: ApiException('เซิร์ฟเวอร์ล่ม', statusCode: 500),
        ),
      );
      expect(repo.calls, 1);
      expect(repo.lastRolloutId, isNull);
      await tester.pump(const Duration(seconds: 5));
    });
  });

  group('Bottom action bar', () {
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

        final saveOffset = tester.getTopLeft(
          find.byKey(const Key('task_status_save')),
        );
        final confirmOffset = tester.getTopLeft(_confirmInstallButton);
        // เรียงบน-ล่าง (Column) ไม่ใช่ซ้อนทับกันที่ตำแหน่งเดียวกัน — บันทึก
        // สถานะอยู่บน, ส่ง Config อยู่ล่าง
        expect(saveOffset.dy, lessThan(confirmOffset.dy));
      },
    );

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

      // 2 Scaffold ซ้อนกัน (นอก: TaskDetailPage มี AppBar, ใน: _TaskDetailView
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
}
