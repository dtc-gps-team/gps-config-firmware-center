import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/auth/auth_controller.dart';
import 'package:mobile/core/auth/token_store.dart';
import 'package:mobile/core/router/app_router.dart';
import 'package:mobile/features/task/task_list_page.dart';
import 'package:mobile/features/task/task_repository.dart';

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
}) => Task(
  id: id,
  title: title,
  assignedTo: 'u1',
  status: status,
  createdAt: DateTime(2026, 9, 1),
  updatedAt: DateTime(2026, 9, 2),
  deviceId: deviceId,
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
  Future<Task> getTask(String id) async =>
      _tasks.firstWhere((t) => t.id == id);

  @override
  Future<Task> updateStatus(String id, TaskStatus status) async =>
      throw UnimplementedError();
}

Future<void> _pump(
  WidgetTester tester, {
  required TaskRepository repo,
  UserRole? role = UserRole.st,
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
      ],
      child: const MaterialApp(home: TaskListPage()),
    ),
  );
  await tester.pump(); // resolve listTasks
}

Future<void> _pumpRouted(
  WidgetTester tester, {
  required TaskRepository repo,
}) async {
  final router = GoRouter(
    initialLocation: AppRoutes.myTasks,
    routes: [
      GoRoute(
        path: AppRoutes.myTasks,
        builder: (_, _) => const TaskListPage(),
      ),
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
