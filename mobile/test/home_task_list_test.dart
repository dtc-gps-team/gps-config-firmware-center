import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/db/app_database.dart';
import 'package:mobile/core/db/providers/database_provider.dart';
import 'package:mobile/core/sync/sync_providers.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/auth/auth_controller.dart';
import 'package:mobile/core/auth/token_store.dart';
import 'package:mobile/core/router/app_router.dart';
import 'package:mobile/core/ui/app_skeleton.dart';
import 'package:mobile/features/home/home_page.dart';
import 'package:mobile/features/task/task_repository.dart';

// หน้า "งานของฉัน" (`/tasks`) ถูกรวมเข้าหน้าแรก (docs/22 §7.2, มติ B ข้อ 12) —
// เทสเดิมของหน้านั้นย้ายมาเทสส่วน "ต้องทำ" ของหน้าแรกแทน (ไม่ลบทิ้ง docs/22 §8.1)

class _FakeAuthController extends AuthController {
  _FakeAuthController(this._role);

  final UserRole? _role;

  @override
  AuthState build() => AuthState(status: AuthStatus.authenticated, role: _role);
}

Task _task({
  String id = 't1',
  String title = 'ติดตั้งกล่อง GPS',
  TaskStatus status = TaskStatus.pending,
  String? deviceId = 'DVC-1',
  DateTime? dueDate,
}) => Task(
  id: id,
  title: title,
  assignedTo: 'u1',
  status: status,
  createdAt: DateTime(2026, 9, 1),
  updatedAt: DateTime(2026, 9, 2),
  deviceId: deviceId,
  dueDate: dueDate,
);

class _FakeTaskRepository implements TaskRepository {
  _FakeTaskRepository({List<Task>? tasks, this.listError})
    : _tasks = tasks ?? [_task()];

  final List<Task> _tasks;
  final Object? listError;

  int listCalls = 0;

  @override
  Future<List<Task>> listTasks() async {
    listCalls++;
    if (listError != null) throw listError!;
    return _tasks;
  }

  @override
  Future<Task> getTask(String id) async => _tasks.firstWhere((t) => t.id == id);

  @override
  Future<Task> updateStatus(String id, TaskStatus status) async =>
      throw UnimplementedError();
}

Future<void> _pump(
  WidgetTester tester, {
  required TaskRepository repo,
  UserRole? role = UserRole.st,
  Set<String> pendingIds = const {},
  bool authExpired = false,
}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        taskRepositoryProvider.overrideWithValue(repo),
        // no real Drift DB / live queries in widget tests (drift stream
        // timers outlive the tree) — the sync queue has its own tests
        pendingTaskIdsProvider.overrideWith((ref) => Stream.value(pendingIds)),
        syncAuthExpiredProvider.overrideWith((ref) => authExpired),
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
      ],
      child: const MaterialApp(home: HomePage()),
    ),
  );
  await tester.pump(); // resolve listTasks
}

Future<void> _pumpRouted(
  WidgetTester tester, {
  required TaskRepository repo,
}) async {
  final router = GoRouter(
    initialLocation: AppRoutes.home,
    routes: [
      GoRoute(path: AppRoutes.home, builder: (_, _) => const HomePage()),
      GoRoute(
        path: AppRoutes.taskDetailPattern,
        builder: (_, state) => Scaffold(
          body: Text('TASK_DETAIL_STUB ${state.pathParameters['id']}'),
        ),
      ),
    ],
  );
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        taskRepositoryProvider.overrideWithValue(repo),
        // no real Drift DB / live queries in widget tests (drift stream
        // timers outlive the tree) — the sync queue has its own tests
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
        authControllerProvider.overrideWith(
          () => _FakeAuthController(UserRole.st),
        ),
      ],
      child: MaterialApp.router(routerConfig: router),
    ),
  );
  await tester.pump();
}

void main() {
  testWidgets(
    'กำลังโหลดครั้งแรก -> โชว์ skeleton (ไม่ใช่ spinner), พอข้อมูลมาแล้ว '
    'skeleton หายไปเหลือแต่การ์ดจริง',
    (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            taskRepositoryProvider.overrideWithValue(_FakeTaskRepository()),
            pendingTaskIdsProvider.overrideWith(
              (ref) => Stream.value(const <String>{}),
            ),
            failedSyncActionsProvider.overrideWith(
              (ref) => Stream.value(const <PendingActionRow>[]),
            ),
            authControllerProvider.overrideWith(
              () => _FakeAuthController(UserRole.st),
            ),
            tokenStoreProvider.overrideWithValue(InMemoryTokenStore()),
            sessionProfileStoreProvider.overrideWithValue(
              InMemorySessionProfileStore(),
            ),
          ],
          child: const MaterialApp(home: HomePage()),
        ),
      );

      expect(find.byType(AppListSkeleton), findsWidgets);
      expect(find.byType(CircularProgressIndicator), findsNothing);

      await tester.pump(); // resolve listTasks
      expect(find.byType(AppListSkeleton), findsNothing);
    },
  );

  testWidgets('loading -> list งานจาก repository', (tester) async {
    await _pump(
      tester,
      repo: _FakeTaskRepository(
        tasks: [
          _task(id: 't1', title: 'ติดตั้งกล่อง GPS รถบรรทุก'),
          _task(id: 't2', title: 'ตรวจเช็คสัญญาณ', deviceId: null),
        ],
      ),
    );

    expect(find.text('ติดตั้งกล่อง GPS รถบรรทุก'), findsOneWidget);
    expect(find.text('ตรวจเช็คสัญญาณ'), findsOneWidget);
    expect(find.text('อุปกรณ์: DVC-1'), findsOneWidget);
    expect(find.text('อุปกรณ์: —'), findsOneWidget);
    expect(find.byKey(const Key('my_task_card_0')), findsOneWidget);
    expect(find.byKey(const Key('my_task_card_1')), findsOneWidget);
  });

  testWidgets('การ์ดงานแสดง dueDate เมื่อมีค่า, "—" เมื่อไม่มี', (
    tester,
  ) async {
    await _pump(
      tester,
      repo: _FakeTaskRepository(
        tasks: [
          _task(id: 't1', dueDate: DateTime(2026, 9, 10)),
          _task(id: 't2', dueDate: null),
        ],
      ),
    );

    expect(find.text('กำหนดส่ง: 10/09/2026'), findsOneWidget);
    expect(find.text('กำหนดส่ง: —'), findsOneWidget);
  });

  testWidgets(
    'เรียงงานเลยกำหนด/ใกล้ถึงกำหนดไว้บนสุด (Mobile UI Roadmap Phase 1)',
    (tester) async {
      final now = DateTime.now();
      final normalTask = _task(id: 't1', title: 'งานปกติ ยังอีกนาน');
      final overdueTask = _task(
        id: 't2',
        title: 'งานเลยกำหนดแล้ว',
        dueDate: now.subtract(const Duration(days: 2)),
      );
      final dueSoonTask = _task(
        id: 't3',
        title: 'งานใกล้ถึงกำหนด',
        status: TaskStatus.inProgress,
        dueDate: now.add(const Duration(hours: 3)),
      );

      await _pump(
        tester,
        repo: _FakeTaskRepository(
          tasks: [normalTask, overdueTask, dueSoonTask],
        ),
      );

      // ลำดับการ์ดต้องเป็น overdue -> dueSoon -> ปกติ ไม่ใช่ลำดับที่ backend ส่งมา
      expect(
        find.descendant(
          of: find.byKey(const Key('my_task_card_0')),
          matching: find.text('งานเลยกำหนดแล้ว'),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: find.byKey(const Key('my_task_card_1')),
          matching: find.text('งานใกล้ถึงกำหนด'),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: find.byKey(const Key('my_task_card_2')),
          matching: find.text('งานปกติ ยังอีกนาน'),
        ),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'งานเลยกำหนด/ใกล้ถึงกำหนด -> มี indicator ป้าย "เลยกำหนด"/"ใกล้ถึงกำหนด"',
    (tester) async {
      final now = DateTime.now();
      await _pump(
        tester,
        repo: _FakeTaskRepository(
          tasks: [
            _task(
              id: 't1',
              title: 'งานเลยกำหนด',
              dueDate: now.subtract(const Duration(days: 1)),
            ),
            _task(
              id: 't2',
              title: 'งานปกติ',
              dueDate: now.add(const Duration(days: 30)),
            ),
          ],
        ),
      );

      expect(find.text('เลยกำหนด'), findsOneWidget);
      // งานปกติไม่มีป้ายเร่งด่วนติดมาด้วย
      expect(find.text('ใกล้ถึงกำหนด'), findsNothing);
    },
  );

  testWidgets('task ที่ค้างในคิว -> badge "รอซิงค์" เฉพาะใบนั้น', (
    tester,
  ) async {
    await _pump(
      tester,
      repo: _FakeTaskRepository(
        tasks: [
          _task(id: 't1', title: 'งานหนึ่ง'),
          _task(id: 't2', title: 'งานสอง'),
        ],
      ),
      pendingIds: {'t2'},
    );

    expect(find.byKey(const Key('pending_sync_badge')), findsOneWidget);
    expect(
      find.descendant(
        of: find.byKey(const Key('my_task_card_1')),
        matching: find.byKey(const Key('pending_sync_badge')),
      ),
      findsOneWidget,
    );
  });

  testWidgets('401 + มีรายการค้าง -> banner เตือนว่าออกจากระบบแล้วรายการหาย', (
    tester,
  ) async {
    await _pump(
      tester,
      repo: _FakeTaskRepository(tasks: [_task(id: 't1')]),
      pendingIds: {'t1'},
      authExpired: true,
    );
    expect(find.byKey(const Key('sync_auth_expired_banner')), findsOneWidget);
  });

  testWidgets('401 แต่ไม่มีรายการค้าง -> ไม่มี banner', (tester) async {
    await _pump(
      tester,
      repo: _FakeTaskRepository(tasks: [_task(id: 't1')]),
      authExpired: true,
    );
    expect(find.byKey(const Key('sync_auth_expired_banner')), findsNothing);
  });

  testWidgets('ไม่มี pending -> ไม่มี badge', (tester) async {
    await _pump(
      tester,
      repo: _FakeTaskRepository(tasks: [_task(id: 't1')]),
    );
    expect(find.byKey(const Key('pending_sync_badge')), findsNothing);
    expect(find.byKey(const Key('sync_failed_banner')), findsNothing);
  });

  testWidgets('ไม่มีงาน -> empty state', (tester) async {
    await _pump(tester, repo: _FakeTaskRepository(tasks: const []));

    expect(find.byKey(const Key('my_tasks_empty')), findsOneWidget);
    expect(find.text('ยังไม่มีงานที่ได้รับมอบหมาย'), findsOneWidget);
  });

  testWidgets('error -> error card + ปุ่มลองอีกครั้ง (แล้วกดยิงซ้ำ)', (
    tester,
  ) async {
    final repo = _FakeTaskRepository(
      listError: ApiException('เซิร์ฟเวอร์ล่ม', statusCode: 500),
    );
    await _pump(tester, repo: repo);
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('my_tasks_error')), findsOneWidget);
    expect(find.text('เซิร์ฟเวอร์ล่ม'), findsOneWidget);
    expect(repo.listCalls, 1);

    await tester.tap(find.byKey(const Key('my_tasks_retry')));
    await tester.pump();
    expect(repo.listCalls, 2);
  });

  testWidgets('แตะการ์ด -> navigate ไป Task Detail ของงานนั้น', (tester) async {
    await _pumpRouted(
      tester,
      repo: _FakeTaskRepository(tasks: [_task(id: 't9')]),
    );

    await tester.tap(find.byKey(const Key('my_task_card_0')));
    await tester.pumpAndSettle();

    expect(find.text('TASK_DETAIL_STUB t9'), findsOneWidget);
  });

  testWidgets('pull-to-refresh -> เรียก repository ใหม่', (tester) async {
    final repo = _FakeTaskRepository(tasks: [_task()]);
    await _pump(tester, repo: repo);
    expect(repo.listCalls, 1);

    await tester.fling(
      find.byKey(const Key('my_task_card_0')),
      const Offset(0, 400),
      1000,
    );
    await tester.pumpAndSettle();

    expect(repo.listCalls, 2);
  });
}
