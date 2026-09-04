import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/auth/auth_controller.dart';
import 'package:mobile/core/auth/token_store.dart';
import 'package:mobile/core/router/app_router.dart';
import 'package:mobile/features/home/home_page.dart';
import 'package:mobile/features/task/task_repository.dart';

class _FakeAuthController extends AuthController {
  _FakeAuthController(this._role);

  final UserRole? _role;

  @override
  AuthState build() => AuthState(
    status: AuthStatus.authenticated,
    role: _role,
    username: 'somchai.t',
  );
}

final _fakeTasks = <Task>[
  Task(
    id: 't1',
    title: 'ติดตั้งกล่อง GPS รถบรรทุก',
    assignedTo: 'u1',
    status: TaskStatus.pending,
    createdAt: DateTime(2026, 9, 1),
    updatedAt: DateTime(2026, 9, 1),
    deviceId: 'DVC-40271',
  ),
  Task(
    id: 't2',
    title: 'ตรวจเช็คสัญญาณรถโดยสาร',
    assignedTo: 'u1',
    status: TaskStatus.inProgress,
    createdAt: DateTime(2026, 9, 2),
    updatedAt: DateTime(2026, 9, 2),
  ),
];

class _FakeTaskRepository implements TaskRepository {
  _FakeTaskRepository({List<Task>? tasks, this.error})
    : _tasks = tasks ?? _fakeTasks;

  final List<Task> _tasks;
  final Object? error;

  int listCalls = 0;

  @override
  Future<List<Task>> listTasks() async {
    listCalls++;
    if (error != null) throw error!;
    return _tasks;
  }

  @override
  Future<Task> getTask(String id) async => _tasks.firstWhere((t) => t.id == id);

  @override
  Future<Task> updateStatus(String id, TaskStatus status) async =>
      throw UnimplementedError();
}

/// Plain pump — no router. Fine for visibility / snackbar assertions.
Future<void> _pumpHome(
  WidgetTester tester,
  UserRole? role, {
  TaskRepository? taskRepo,
}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        authControllerProvider.overrideWith(() => _FakeAuthController(role)),
        tokenStoreProvider.overrideWithValue(InMemoryTokenStore()),
        taskRepositoryProvider.overrideWithValue(
          taskRepo ?? _FakeTaskRepository(),
        ),
      ],
      child: const MaterialApp(home: HomePage()),
    ),
  );
  await tester.pump(); // resolve the task list future
}

/// Router-backed pump with stub destinations, so `context.push(...)` from the
/// shortcut tiles and task cards can be asserted.
Future<void> _pumpHomeRouted(
  WidgetTester tester,
  UserRole? role, {
  TaskRepository? taskRepo,
}) async {
  final router = GoRouter(
    initialLocation: '/home',
    routes: [
      GoRoute(path: '/home', builder: (_, _) => const HomePage()),
      GoRoute(
        path: AppRoutes.simulator,
        builder: (_, _) => const Scaffold(body: Text('SIMULATOR_PAGE_STUB')),
      ),
      GoRoute(
        path: AppRoutes.deviceConnectionTest,
        builder: (_, _) => const Scaffold(body: Text('DEVICE_TEST_PAGE_STUB')),
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
        authControllerProvider.overrideWith(() => _FakeAuthController(role)),
        taskRepositoryProvider.overrideWithValue(
          taskRepo ?? _FakeTaskRepository(),
        ),
      ],
      child: MaterialApp.router(routerConfig: router),
    ),
  );
  await tester.pump();
}

void main() {
  final deviceTestTile = find.byKey(const Key('shortcut_device_test'));

  group('RBAC — ปุ่ม "ทดสอบสัญญาณ" ในกริดทางลัด', () {
    testWidgets('ST เห็นทางลัด "ทดสอบสัญญาณ"', (tester) async {
      await _pumpHome(tester, UserRole.st);
      expect(deviceTestTile, findsOneWidget);
    });

    testWidgets('OT เห็นทางลัด "ทดสอบสัญญาณ"', (tester) async {
      await _pumpHome(tester, UserRole.ot);
      expect(deviceTestTile, findsOneWidget);
    });

    testWidgets('SW ไม่เห็นทางลัด "ทดสอบสัญญาณ"', (tester) async {
      await _pumpHome(tester, UserRole.sw);
      expect(deviceTestTile, findsNothing);
    });

    testWidgets('role ว่าง ไม่เห็นทางลัด "ทดสอบสัญญาณ"', (tester) async {
      await _pumpHome(tester, null);
      expect(deviceTestTile, findsNothing);
    });
  });

  group('"งานวันนี้" — task list จริงจาก GET /tasks', () {
    testWidgets('แสดงการ์ดงานจาก repository + จำนวนใน greeting', (
      tester,
    ) async {
      await _pumpHome(tester, UserRole.st);

      expect(find.text('ติดตั้งกล่อง GPS รถบรรทุก'), findsOneWidget);
      expect(find.text('ตรวจเช็คสัญญาณรถโดยสาร'), findsOneWidget);
      expect(find.text('Device: DVC-40271'), findsOneWidget);
      expect(find.text('Device: —'), findsOneWidget); // t2 has no deviceId
      expect(find.text('วันนี้ 2 งานที่ได้รับมอบหมาย'), findsOneWidget);
    });

    testWidgets('empty state เมื่อไม่มีงาน', (tester) async {
      await _pumpHome(
        tester,
        UserRole.st,
        taskRepo: _FakeTaskRepository(tasks: const []),
      );

      expect(find.text('ยังไม่มีงานที่ได้รับมอบหมาย'), findsOneWidget);
      expect(find.text('วันนี้ 0 งานที่ได้รับมอบหมาย'), findsOneWidget);
    });

    testWidgets('error state + ปุ่มลองอีกครั้ง', (tester) async {
      await _pumpHome(
        tester,
        UserRole.st,
        taskRepo: _FakeTaskRepository(
          error: ApiException('เซิร์ฟเวอร์ล่ม', statusCode: 500),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('เซิร์ฟเวอร์ล่ม'), findsOneWidget);
      expect(find.byKey(const Key('tasks_retry')), findsOneWidget);
      // greeting must not stay stuck on the loading line, and shows no count
      expect(find.textContaining('กำลังโหลดงานที่ได้รับมอบหมาย'), findsNothing);
      expect(find.textContaining('งานที่ได้รับมอบหมาย'), findsNothing);
    });

    testWidgets('แตะการ์ดงาน -> navigate ไปหน้า Task Detail ของงานนั้น', (
      tester,
    ) async {
      await _pumpHomeRouted(tester, UserRole.st);

      await tester.tap(find.byKey(const Key('task_card_0')));
      await tester.pumpAndSettle();

      expect(find.text('TASK_DETAIL_STUB t1'), findsOneWidget);
    });
  });

  group(
    'RBAC — "งานวันนี้" เฉพาะ ST/OT (backend GET /tasks self-scope 2 role นี้)',
    () {
      for (final role in [UserRole.sw, UserRole.operation, UserRole.auditor]) {
        testWidgets('${role.wireName}: ไม่เห็น section + ไม่ยิง GET /tasks', (
          tester,
        ) async {
          final repo = _FakeTaskRepository();
          await _pumpHome(tester, role, taskRepo: repo);
          await tester.pumpAndSettle();

          expect(find.text('งานวันนี้'), findsNothing);
          expect(find.byKey(const Key('task_card_0')), findsNothing);
          expect(find.textContaining('งานที่ได้รับมอบหมาย'), findsNothing);
          expect(repo.listCalls, 0);
        });
      }

      testWidgets('role ว่าง (session ที่ยังไม่มี role): ไม่ยิง GET /tasks', (
        tester,
      ) async {
        final repo = _FakeTaskRepository();
        await _pumpHome(tester, null, taskRepo: repo);
        await tester.pumpAndSettle();

        expect(find.text('งานวันนี้'), findsNothing);
        expect(repo.listCalls, 0);
      });

      testWidgets('ST: ยังเห็น section + ยิง GET /tasks ตามเดิม', (
        tester,
      ) async {
        final repo = _FakeTaskRepository();
        await _pumpHome(tester, UserRole.st, taskRepo: repo);
        await tester.pumpAndSettle();

        expect(find.text('งานวันนี้'), findsOneWidget);
        expect(repo.listCalls, 1);
      });
    },
  );

  group('การ navigate ของทางลัดของจริง (ต้องทำงานเหมือนเดิม)', () {
    testWidgets('แตะ "ทดสอบการตั้งค่า" -> ไปหน้า Config Simulator', (
      tester,
    ) async {
      await _pumpHomeRouted(tester, UserRole.sw);
      await tester.tap(find.byKey(const Key('shortcut_simulator')));
      await tester.pumpAndSettle();
      expect(find.text('SIMULATOR_PAGE_STUB'), findsOneWidget);
    });

    testWidgets('ST แตะ "ทดสอบสัญญาณ" -> ไปหน้าทดสอบสัญญาณ', (tester) async {
      await _pumpHomeRouted(tester, UserRole.st);
      await tester.tap(find.byKey(const Key('shortcut_device_test')));
      await tester.pumpAndSettle();
      expect(find.text('DEVICE_TEST_PAGE_STUB'), findsOneWidget);
    });
  });

  group('ส่วน mock -> snackbar "เร็ว ๆ นี้" (ไม่เงียบ ไม่ crash)', () {
    testWidgets('แตะทางลัด mock "ค้นหาอุปกรณ์"', (tester) async {
      await _pumpHome(tester, UserRole.st);
      final tile = find.byKey(const Key('shortcut_find_device'));
      await tester.ensureVisible(tile);
      await tester.pumpAndSettle();
      await tester.tap(tile);
      await tester.pump();
      expect(find.textContaining('เร็ว'), findsOneWidget);
    });

    testWidgets('แตะไอคอนกระดิ่งแจ้งเตือน mock', (tester) async {
      await _pumpHome(tester, UserRole.st);
      await tester.tap(find.byKey(const Key('home_notifications')));
      await tester.pump();
      expect(find.textContaining('เร็ว'), findsOneWidget);
    });
  });

  testWidgets('ปุ่ม logout เรียก logout ของ controller', (tester) async {
    final container = ProviderContainer(
      overrides: [
        authControllerProvider.overrideWith(
          () => _FakeAuthController(UserRole.st),
        ),
        tokenStoreProvider.overrideWithValue(InMemoryTokenStore()),
        taskRepositoryProvider.overrideWithValue(_FakeTaskRepository()),
      ],
    );
    addTearDown(container.dispose);
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: const MaterialApp(home: HomePage()),
      ),
    );
    await tester.pump();

    await tester.tap(find.byKey(const Key('home_logout')));
    await tester.pumpAndSettle();

    expect(
      container.read(authControllerProvider).status,
      AuthStatus.unauthenticated,
    );
  });
}
