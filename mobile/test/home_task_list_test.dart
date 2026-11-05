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
import 'package:mobile/features/home/home_tasks_page.dart';
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
  tester.view.physicalSize = const Size(430 * 3, 1600 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
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
      child: const MaterialApp(home: HomeTasksPage()),
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
      GoRoute(path: AppRoutes.home, builder: (_, _) => const HomeTasksPage()),
      GoRoute(
        path: AppRoutes.taskDetailPattern,
        builder: (_, state) => Scaffold(
          body: Text('TASK_DETAIL_STUB ${state.pathParameters['id']}'),
        ),
      ),
    ],
  );
  tester.view.physicalSize = const Size(430 * 3, 1600 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
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
  for (final role in [
    UserRole.operation,
    UserRole.admin,
    UserRole.auditor,
    null,
  ]) {
    testWidgets('รายการเต็มไม่เรียกข้อมูลเมื่อไม่ใช่ช่าง: $role', (
      tester,
    ) async {
      final repo = _FakeTaskRepository();
      await _pump(tester, repo: repo, role: role);
      expect(repo.listCalls, 0);
      expect(find.byKey(const Key('home_tasks_search')), findsNothing);
    });
  }

  testWidgets('หัวข้อหน้าเป็น "Task History"', (tester) async {
    await _pump(
      tester,
      repo: _FakeTaskRepository(tasks: [_task(id: 'p')]),
    );

    expect(find.text('Task History'), findsOneWidget);
  });

  testWidgets('กรองครบทุกสถานะ และล้างกลับเป็นทั้งหมด', (tester) async {
    await _pump(
      tester,
      repo: _FakeTaskRepository(
        tasks: [
          _task(id: 'p', status: TaskStatus.pending),
          _task(id: 'i', status: TaskStatus.inProgress),
          _task(id: 'c', status: TaskStatus.completed),
          _task(id: 'x', status: TaskStatus.cancelled),
        ],
      ),
    );
    for (final (filter, count) in [
      ('open', 2),
      ('completed', 1),
      ('cancelled', 1),
      ('all', 4),
    ]) {
      await tester.tap(find.byKey(Key('home_filter_$filter')));
      await tester.pumpAndSettle();
      expect(find.text('พบ $count รายการ'), findsOneWidget);
    }
  });

  testWidgets('ตัวกรอง 4 ตัวเรียงแถวเดียวบนจอ 360 ไม่ล้น', (tester) async {
    await _pump(tester, repo: _FakeTaskRepository());
    tester.view.physicalSize = const Size(360 * 3, 800 * 3);
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.byKey(const Key('home_filter_row')), findsOneWidget);
    final tops = {
      for (final name in ['all', 'open', 'completed', 'cancelled'])
        tester.getTopLeft(find.byKey(Key('home_filter_$name'))).dy,
    };
    expect(tops, hasLength(1));
  });

  testWidgets('งานยังไม่เสร็จเรียงความเร่งด่วนเดิมและป้ายถูกต้อง', (
    tester,
  ) async {
    final now = DateTime.now();
    await _pump(
      tester,
      repo: _FakeTaskRepository(
        tasks: [
          _task(
            id: 'normal',
            title: 'งานปกติ',
            dueDate: now.add(const Duration(days: 9)),
          ),
          _task(id: 'soon', title: 'ใกล้กำหนด', dueDate: now),
          _task(
            id: 'overdue',
            title: 'เลยกำหนดแล้ว',
            dueDate: now.subtract(const Duration(days: 2)),
          ),
        ],
      ),
    );
    await tester.tap(find.byKey(const Key('home_filter_open')));
    await tester.pumpAndSettle();
    final card = find.byKey(const Key('home_all_overdue'));
    await tester.ensureVisible(card);
    expect(
      find.descendant(of: card, matching: find.text('เลยกำหนด')),
      findsOneWidget,
    );
    expect(
      tester.getTopLeft(card).dy,
      lessThan(tester.getTopLeft(find.byKey(const Key('home_all_soon'))).dy),
    );
    expect(find.textContaining('กำหนดส่ง:'), findsNothing);
  });

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
        of: find.byKey(const Key('home_all_t2')),
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

    expect(find.byKey(const Key('home_all_empty')), findsOneWidget);
    expect(find.text('ไม่มีรายการในตัวกรองนี้'), findsOneWidget);
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

    await tester.ensureVisible(find.byKey(const Key('home_all_t9')));
    await tester.tap(find.byKey(const Key('home_all_t9')));
    await tester.pumpAndSettle();

    expect(find.text('TASK_DETAIL_STUB t9'), findsOneWidget);
  });

  testWidgets('pull-to-refresh -> เรียก repository ใหม่', (tester) async {
    final repo = _FakeTaskRepository(tasks: [_task()]);
    await _pump(tester, repo: repo);
    expect(repo.listCalls, 1);

    await tester.fling(
      find.byType(Scrollable).first,
      const Offset(0, 400),
      1000,
    );
    await tester.pumpAndSettle();

    expect(repo.listCalls, 2);
  });
}
