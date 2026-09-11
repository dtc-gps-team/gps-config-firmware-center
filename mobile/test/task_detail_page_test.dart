import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/auth/auth_controller.dart';
import 'package:mobile/core/auth/token_store.dart';
import 'package:mobile/features/task/confirm_install_repository.dart';
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

class _FakeConfirmInstallRepository implements ConfirmInstallRepository {
  _FakeConfirmInstallRepository({this.result, this.error});

  final ConfigApplyResult? result;
  final Object? error;

  int calls = 0;
  String? lastDeviceId;
  String? lastConfigId;

  @override
  Future<ConfigApplyResult> applyConfig({
    required String deviceId,
    required String configId,
  }) async {
    calls++;
    lastDeviceId = deviceId;
    lastConfigId = configId;
    if (error != null) throw error!;
    return result ??
        ConfigApplyResult(
          applied: true,
          details: const ['ok'],
          appliedAt: DateTime(2026, 9, 11),
        );
  }
}

Future<void> _pump(
  WidgetTester tester, {
  required TaskRepository repo,
  UserRole? role = UserRole.st,
  String taskId = 't1',
  ConfirmInstallRepository? confirmInstallRepo,
}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        taskRepositoryProvider.overrideWithValue(repo),
        authControllerProvider.overrideWith(() => _FakeAuthController(role)),
        tokenStoreProvider.overrideWithValue(InMemoryTokenStore()),
        sessionProfileStoreProvider.overrideWithValue(
          InMemorySessionProfileStore(),
        ),
        confirmInstallRepositoryProvider.overrideWithValue(
          confirmInstallRepo ?? _FakeConfirmInstallRepository(),
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

/// The button sits below the fold on the test surface — `ListView`'s
/// underlying sliver only builds elements within the viewport + cache
/// extent, so `find.byKey` can't see it (and `tap()` can't reach it) until
/// it's scrolled into view.
Future<void> _scrollToConfirmInstallButton(WidgetTester tester) async {
  await tester.dragUntilVisible(
    _confirmInstallButton,
    find.byType(Scrollable),
    const Offset(0, -150),
  );
  await tester.pumpAndSettle();
}

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
        await _scrollToConfirmInstallButton(tester);

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

    testWidgets('role SW (ไม่ใช่ ST/OT) -> ไม่เห็นปุ่มแม้เงื่อนไขอื่นครบ', (
      tester,
    ) async {
      await _pump(
        tester,
        repo: _FakeTaskRepository(
          task: _makeTask(status: TaskStatus.inProgress, configId: 'cfg-1'),
        ),
        role: UserRole.sw,
      );

      expect(_confirmInstallButton, findsNothing);
    });

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
        await _scrollToConfirmInstallButton(tester);

        await tester.tap(_confirmInstallButton);
        await tester.pump(); // kick off _confirmInstall
        await tester.pump(); // await applyConfig

        expect(confirmRepo.calls, 1);
        expect(confirmRepo.lastDeviceId, 'DVC-1');
        expect(confirmRepo.lastConfigId, 'cfg-1');
        expect(
          find.text('ส่ง Config เข้าอุปกรณ์เรียบร้อยแล้ว'),
          findsOneWidget,
        );
        expect(find.text('ยืนยันติดตั้งสำเร็จแล้ว'), findsOneWidget);
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
        await _scrollToConfirmInstallButton(tester);

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
        await _scrollToConfirmInstallButton(tester);

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
        await _scrollToConfirmInstallButton(tester);

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
}
