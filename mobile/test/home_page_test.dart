import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/db/providers/database_provider.dart';
import 'package:mobile/core/db/app_database.dart';
import 'package:drift/drift.dart' show Value;
import 'package:drift/native.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/auth/auth_controller.dart';
import 'package:mobile/core/auth/token_store.dart';
import 'package:mobile/core/router/app_router.dart';
import 'package:mobile/core/sync/sync_providers.dart';
import 'package:mobile/features/device_connection_test/recent_device_id_store.dart';
import 'package:mobile/features/home/home_page.dart';
import 'package:mobile/features/notification/notification_repository.dart';
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

/// One completed task (this month), one completed task (a different month,
/// so it does not count toward "งานที่เสร็จเดือนนี้"), and one still-pending
/// task (must never show up in the history section).
final _now = DateTime.now();
final _fakeTasks = <Task>[
  Task(
    id: 't1',
    title: 'ติดตั้งกล่อง GPS รถบรรทุก',
    assignedTo: 'u1',
    status: TaskStatus.completed,
    createdAt: DateTime(_now.year, _now.month, 1),
    updatedAt: DateTime(_now.year, _now.month, 2),
    deviceId: 'DVC-40271',
  ),
  Task(
    id: 't2',
    title: 'ตรวจเช็คสัญญาณรถโดยสาร',
    assignedTo: 'u1',
    status: TaskStatus.completed,
    createdAt: DateTime(2020, 1, 1),
    updatedAt: DateTime(2020, 1, 2),
  ),
  Task(
    id: 't3',
    title: 'เปลี่ยนซิมการ์ดอุปกรณ์',
    assignedTo: 'u1',
    status: TaskStatus.pending,
    createdAt: DateTime(_now.year, _now.month, 3),
    updatedAt: DateTime(_now.year, _now.month, 3),
    deviceId: 'DVC-38004',
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

class _FakeNotificationRepository implements NotificationRepository {
  _FakeNotificationRepository({this.unreadCount = 0});

  final int unreadCount;

  AppNotification _n(int i, bool read) => AppNotification(
    id: 'n$i',
    userId: 'u1',
    type: NotificationType.taskAssigned,
    payload: const {},
    read: read,
    createdAt: DateTime(2026, 9, 4, 8, i),
  );

  @override
  Future<List<AppNotification>> list({bool? unread}) async {
    final items = [
      for (var i = 0; i < unreadCount; i++) _n(i, false),
      _n(99, true),
    ];
    return unread == true ? items.where((n) => !n.read).toList() : items;
  }

  @override
  Future<AppNotification> markRead(String id) async =>
      throw UnimplementedError();
}

/// Plain pump — no router. Fine for visibility / snackbar assertions.
Future<void> _pumpHome(
  WidgetTester tester,
  UserRole? role, {
  TaskRepository? taskRepo,
  NotificationRepository? notiRepo,
}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        authControllerProvider.overrideWith(() => _FakeAuthController(role)),
        tokenStoreProvider.overrideWithValue(InMemoryTokenStore()),
        sessionProfileStoreProvider.overrideWithValue(
          InMemorySessionProfileStore(),
        ),
        taskRepositoryProvider.overrideWithValue(
          taskRepo ?? _FakeTaskRepository(),
        ),
        notificationRepositoryProvider.overrideWithValue(
          notiRepo ?? _FakeNotificationRepository(),
        ),
        // HomeStatusBanners (UX audit #15) — ไม่ใช้ Drift live query ในเทส widget
        // (timer ของ stream ค้างหลังปิด tree)
        pendingTaskIdsProvider.overrideWith(
          (ref) => Stream.value(const <String>{}),
        ),
        failedSyncActionsProvider.overrideWith(
          (ref) => Stream.value(const <PendingActionRow>[]),
        ),
      ],
      child: const MaterialApp(home: HomePage()),
    ),
  );
  await tester.pump(); // resolve the task list future
}

/// Router-backed pump with stub destinations, so `context.push(...)` from the
/// shortcut tiles and history cards can be asserted.
Future<void> _pumpHomeRouted(
  WidgetTester tester,
  UserRole? role, {
  TaskRepository? taskRepo,
  NotificationRepository? notiRepo,
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
        path: AppRoutes.deviceSearch,
        builder: (_, _) =>
            const Scaffold(body: Text('DEVICE_SEARCH_PAGE_STUB')),
      ),
      GoRoute(
        path: AppRoutes.myTasks,
        builder: (_, _) => const Scaffold(body: Text('MY_TASKS_PAGE_STUB')),
      ),
      GoRoute(
        path: AppRoutes.incidents,
        builder: (_, _) =>
            const Scaffold(body: Text('INCIDENT_LIST_PAGE_STUB')),
      ),
      GoRoute(
        path: AppRoutes.taskDetailPattern,
        builder: (_, state) => Scaffold(
          body: Text('TASK_DETAIL_STUB ${state.pathParameters['id']}'),
        ),
      ),
      GoRoute(
        path: AppRoutes.notifications,
        builder: (_, _) => const Scaffold(body: Text('NOTIFICATION_LIST_STUB')),
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
        notificationRepositoryProvider.overrideWithValue(
          notiRepo ?? _FakeNotificationRepository(),
        ),
        // HomeStatusBanners (UX audit #15) — ไม่ใช้ Drift live query ในเทส widget
        // (timer ของ stream ค้างหลังปิด tree)
        pendingTaskIdsProvider.overrideWith(
          (ref) => Stream.value(const <String>{}),
        ),
        failedSyncActionsProvider.overrideWith(
          (ref) => Stream.value(const <PendingActionRow>[]),
        ),
      ],
      child: MaterialApp.router(routerConfig: router),
    ),
  );
  await tester.pump();
}

void main() {
  final deviceTestTile = find.byKey(const Key('shortcut_device_test'));

  group('role badge label', () {
    testWidgets('SuperAdmin -> "SuperAdmin • ผู้ดูแลระบบสูงสุด"', (
      tester,
    ) async {
      await _pumpHome(tester, UserRole.superAdmin);
      expect(find.text('SuperAdmin • ผู้ดูแลระบบสูงสุด'), findsOneWidget);
    });
  });

  group('RBAC — ปุ่ม "ทดสอบสัญญาณ" ในกริดทางลัด', () {
    testWidgets('ST เห็นทางลัด "ทดสอบสัญญาณ"', (tester) async {
      await _pumpHome(tester, UserRole.st);
      expect(deviceTestTile, findsOneWidget);
    });

    testWidgets('OT เห็นทางลัด "ทดสอบสัญญาณ"', (tester) async {
      await _pumpHome(tester, UserRole.ot);
      expect(deviceTestTile, findsOneWidget);
    });

    testWidgets('Operation ไม่เห็นทางลัด "ทดสอบสัญญาณ"', (tester) async {
      await _pumpHome(tester, UserRole.operation);
      expect(deviceTestTile, findsNothing);
    });

    testWidgets('role ว่าง ไม่เห็นทางลัด "ทดสอบสัญญาณ"', (tester) async {
      await _pumpHome(tester, null);
      expect(deviceTestTile, findsNothing);
    });
  });

  group('"งานค้างวันนี้" — Mobile UI Roadmap Phase 1 (เร่งด่วน)', () {
    testWidgets('ไม่มีงานเร่งด่วนเลย -> section ไม่โผล่มาทั้งก้อน', (
      tester,
    ) async {
      // _fakeTasks ปกติ: t3 (pending) ไม่มี dueDate เลย = ไม่เร่งด่วนตามเกณฑ์
      await _pumpHome(tester, UserRole.st);

      expect(find.byKey(const Key('urgent_tasks_section')), findsNothing);
      expect(find.text('งานค้างวันนี้'), findsNothing);
    });

    testWidgets(
      'มีงานเลยกำหนด + ใกล้ถึงกำหนด -> section โผล่ เรียง overdue ก่อน dueSoon',
      (tester) async {
        final now = DateTime.now();
        final overdueTask = Task(
          id: 'u1',
          title: 'งานเลยกำหนดแล้ว',
          assignedTo: 'u1',
          status: TaskStatus.pending,
          createdAt: now,
          updatedAt: now,
          deviceId: 'DVC-001',
          dueDate: now.subtract(const Duration(days: 1)),
        );
        final dueSoonTask = Task(
          id: 'u2',
          title: 'งานใกล้ถึงกำหนด',
          assignedTo: 'u1',
          status: TaskStatus.inProgress,
          createdAt: now,
          updatedAt: now,
          deviceId: 'DVC-002',
          dueDate: now.add(const Duration(hours: 6)),
        );
        // งานเสร็จแล้วแม้ dueDate เลยกำหนดก็ต้องไม่ถูกนับเป็นเร่งด่วน
        final completedOverdueLooking = Task(
          id: 'u3',
          title: 'งานเสร็จแล้ว (ไม่ควรนับเร่งด่วน)',
          assignedTo: 'u1',
          status: TaskStatus.completed,
          createdAt: now,
          updatedAt: now,
          dueDate: now.subtract(const Duration(days: 10)),
        );

        await _pumpHome(
          tester,
          UserRole.st,
          taskRepo: _FakeTaskRepository(
            tasks: [dueSoonTask, overdueTask, completedOverdueLooking],
          ),
        );

        expect(find.byKey(const Key('urgent_tasks_section')), findsOneWidget);
        expect(find.text('งานค้างวันนี้'), findsOneWidget);
        // งานเสร็จแล้วอาจโผล่ใน "ประวัติงานล่าสุด" ได้ตามปกติ แต่ต้องไม่ถูกนับ
        // เป็นการ์ดเร่งด่วน — section เร่งด่วนต้องมีแค่ 2 การ์ด (overdue+dueSoon)
        expect(find.byKey(const Key('urgent_task_card_0')), findsOneWidget);
        expect(find.byKey(const Key('urgent_task_card_1')), findsOneWidget);
        expect(find.byKey(const Key('urgent_task_card_2')), findsNothing);

        // overdue ต้องมาก่อน dueSoon ในลำดับการ์ด
        final overdueFinder = find.text('งานเลยกำหนดแล้ว');
        final dueSoonFinder = find.text('งานใกล้ถึงกำหนด');
        expect(overdueFinder, findsOneWidget);
        expect(dueSoonFinder, findsOneWidget);
        final overdueY = tester.getTopLeft(overdueFinder).dy;
        final dueSoonY = tester.getTopLeft(dueSoonFinder).dy;
        expect(overdueY, lessThan(dueSoonY));
      },
    );

    testWidgets('แตะการ์ดงานเร่งด่วน -> navigate ไป Task Detail ของงานนั้น', (
      tester,
    ) async {
      final now = DateTime.now();
      final overdueTask = Task(
        id: 'u9',
        title: 'งานเลยกำหนดแล้ว',
        assignedTo: 'u1',
        status: TaskStatus.pending,
        createdAt: now,
        updatedAt: now,
        dueDate: now.subtract(const Duration(days: 1)),
      );

      await _pumpHomeRouted(
        tester,
        UserRole.st,
        taskRepo: _FakeTaskRepository(tasks: [overdueTask]),
      );

      await tester.tap(find.byKey(const Key('urgent_task_card_0')));
      await tester.pumpAndSettle();

      expect(find.text('TASK_DETAIL_STUB u9'), findsOneWidget);
    });
  });

  group('"ประวัติงานล่าสุด" — ประวัติงานที่เสร็จแล้วจริงจาก GET /tasks', () {
    testWidgets('แสดงเฉพาะงานที่เสร็จแล้ว + สถิติงานเดือนนี้', (tester) async {
      await _pumpHome(tester, UserRole.st);

      // t1 (completed, this month) และ t2 (completed, เดือนอื่น) โผล่ในประวัติ
      expect(find.text('ติดตั้งกล่อง GPS รถบรรทุก'), findsOneWidget);
      expect(find.text('ตรวจเช็คสัญญาณรถโดยสาร'), findsOneWidget);
      // t3 (pending) ต้องไม่โผล่ในหน้า Home อีกต่อไป
      expect(find.text('เปลี่ยนซิมการ์ดอุปกรณ์'), findsNothing);

      // สถิติ: เดือนนี้เสร็จ 1 งาน (t1), ประวัติทั้งหมด 2 งาน (t1+t2)
      expect(find.text('1'), findsOneWidget);
      expect(find.text('2'), findsOneWidget);
      expect(find.text('2 รายการ'), findsOneWidget);
    });

    testWidgets('การ์ดประวัติแสดงวันที่เสร็จงาน (updatedAt) ต่อกับ deviceId', (
      tester,
    ) async {
      await _pumpHome(tester, UserRole.st);

      // t1.updatedAt = DateTime(year, month, 2) — รูปแบบเดียวกับ
      // _formatDate ใน task_detail_page.dart (dd/mm/yyyy HH:mm)
      final two = _now.month.toString().padLeft(2, '0');
      expect(
        find.text('DVC-40271 · 02/$two/${_now.year} 00:00'),
        findsOneWidget,
      );
    });

    testWidgets('empty state เมื่อไม่มีงานที่เสร็จแล้ว', (tester) async {
      await _pumpHome(
        tester,
        UserRole.st,
        taskRepo: _FakeTaskRepository(tasks: const []),
      );

      expect(find.text('ยังไม่มีประวัติงานที่เสร็จสิ้น'), findsOneWidget);
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
    });

    testWidgets(
      'แตะการ์ดประวัติงาน -> navigate ไปหน้า Task Detail ของงานนั้น',
      (tester) async {
        await _pumpHomeRouted(tester, UserRole.st);

        await tester.tap(find.byKey(const Key('history_card_0')));
        await tester.pumpAndSettle();

        expect(find.text('TASK_DETAIL_STUB t1'), findsOneWidget);
      },
    );

    testWidgets('แตะ "ดูประวัติงานทั้งหมด" -> navigate ไปหน้ารายการงาน', (
      tester,
    ) async {
      await _pumpHomeRouted(tester, UserRole.st);

      final btn = find.byKey(const Key('view_all_history'));
      await tester.ensureVisible(btn);
      await tester.pumpAndSettle();
      await tester.tap(btn);
      await tester.pumpAndSettle();

      expect(find.text('MY_TASKS_PAGE_STUB'), findsOneWidget);
    });
  });

  group(
    'RBAC — ประวัติงานเฉพาะ ST/OT (backend GET /tasks self-scope 2 role นี้)',
    () {
      for (final role in [UserRole.operation, UserRole.auditor]) {
        testWidgets('${role.wireName}: ไม่เห็น section + ไม่ยิง GET /tasks', (
          tester,
        ) async {
          final repo = _FakeTaskRepository();
          await _pumpHome(tester, role, taskRepo: repo);
          await tester.pumpAndSettle();

          expect(find.text('ประวัติงานล่าสุด'), findsNothing);
          expect(find.byKey(const Key('history_card_0')), findsNothing);
          expect(repo.listCalls, 0);
        });
      }

      testWidgets('role ว่าง (session ที่ยังไม่มี role): ไม่ยิง GET /tasks', (
        tester,
      ) async {
        final repo = _FakeTaskRepository();
        await _pumpHome(tester, null, taskRepo: repo);
        await tester.pumpAndSettle();

        expect(find.text('ประวัติงานล่าสุด'), findsNothing);
        expect(repo.listCalls, 0);
      });

      testWidgets('ST: ยังเห็น section + ยิง GET /tasks ตามเดิม', (
        tester,
      ) async {
        final repo = _FakeTaskRepository();
        await _pumpHome(tester, UserRole.st, taskRepo: repo);
        await tester.pumpAndSettle();

        expect(find.text('ประวัติงานล่าสุด'), findsOneWidget);
        expect(repo.listCalls, 1);
      });
    },
  );

  group('การ navigate ของทางลัดของจริง (ต้องทำงานเหมือนเดิม)', () {
    testWidgets('แตะ "ทดสอบการตั้งค่า" -> ไปหน้า Config Simulator', (
      tester,
    ) async {
      await _pumpHomeRouted(tester, UserRole.st);
      // แถบสรุปงานค้างบนสุด (UX audit #15) ดันทางลัดลงล่าง เลื่อนหาก่อนแตะ
      await tester.ensureVisible(find.byKey(const Key('shortcut_simulator')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('shortcut_simulator')));
      await tester.pumpAndSettle();
      expect(find.text('SIMULATOR_PAGE_STUB'), findsOneWidget);
    });

    testWidgets('ST แตะ "ทดสอบสัญญาณ" -> ไปหน้าทดสอบสัญญาณ', (tester) async {
      await _pumpHomeRouted(tester, UserRole.st);
      // แถบสรุปงานค้างบนสุด (UX audit #15) ดันทางลัดลงล่าง เลื่อนหาก่อนแตะ
      await tester.ensureVisible(find.byKey(const Key('shortcut_device_test')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('shortcut_device_test')));
      await tester.pumpAndSettle();
      expect(find.text('DEVICE_TEST_PAGE_STUB'), findsOneWidget);
    });

    testWidgets('ST แตะ "งานของฉัน" -> ไปหน้ารายการงาน (ไม่ใช่ snackbar)', (
      tester,
    ) async {
      await _pumpHomeRouted(tester, UserRole.st);
      final tile = find.byKey(const Key('shortcut_my_tasks'));
      await tester.ensureVisible(tile);
      await tester.pumpAndSettle();
      await tester.tap(tile);
      await tester.pumpAndSettle();
      expect(find.text('MY_TASKS_PAGE_STUB'), findsOneWidget);
      expect(find.textContaining('เร็ว'), findsNothing);
    });
  });

  // คำตอบ A ใน #303 ข้อ 2 — simulate-config ใช้สิทธิ์ device-connection-test
  // (ST/OT เท่านั้น) role อื่นเห็นทางลัดแล้วใช้ไม่ได้
  group('RBAC — ทางลัด "ทดสอบการตั้งค่า" เฉพาะ ST/OT', () {
    final simulatorTile = find.byKey(const Key('shortcut_simulator'));

    for (final role in [UserRole.st, UserRole.ot]) {
      testWidgets('${role.wireName} เห็นทางลัด "ทดสอบการตั้งค่า"', (
        tester,
      ) async {
        await _pumpHome(tester, role);
        expect(simulatorTile, findsOneWidget);
      });
    }

    for (final role in [UserRole.operation, UserRole.auditor, UserRole.admin]) {
      testWidgets('${role.wireName} ไม่เห็นทางลัด "ทดสอบการตั้งค่า"', (
        tester,
      ) async {
        await _pumpHome(tester, role);
        expect(simulatorTile, findsNothing);
      });
    }
  });

  group('RBAC — ทางลัด "งานของฉัน" เฉพาะ ST/OT', () {
    final myTasksTile = find.byKey(const Key('shortcut_my_tasks'));

    for (final role in [UserRole.st, UserRole.ot]) {
      testWidgets('${role.wireName} เห็นทางลัด "งานของฉัน"', (tester) async {
        await _pumpHome(tester, role);
        expect(myTasksTile, findsOneWidget);
      });
    }

    for (final role in [UserRole.operation, UserRole.auditor, UserRole.admin]) {
      testWidgets('${role.wireName} ไม่เห็นทางลัด "งานของฉัน"', (tester) async {
        await _pumpHome(tester, role);
        expect(myTasksTile, findsNothing);
      });
    }

    testWidgets('role ว่าง ไม่เห็นทางลัด "งานของฉัน"', (tester) async {
      await _pumpHome(tester, null);
      expect(myTasksTile, findsNothing);
    });
  });

  group(
    'ทางลัด "ดู Incident" — read-only, ทุก role (GET /incidents = R ทุก Role)',
    () {
      for (final role in [
        UserRole.st,
        UserRole.operation,
        UserRole.auditor,
        UserRole.admin,
      ]) {
        testWidgets('${role.wireName} เห็นทางลัด "ดู Incident"', (
          tester,
        ) async {
          await _pumpHome(tester, role);
          final tile = find.byKey(const Key('shortcut_report_incident'));
          expect(tile, findsOneWidget);
          // label = "ดู Incident" ไม่ใช่ "แจ้งเหตุ" (read-only ดูอย่างเดียว)
          expect(
            find.descendant(of: tile, matching: find.text('ดู Incident')),
            findsOneWidget,
          );
        });
      }

      testWidgets(
        'แตะแล้ว navigate ไปหน้า Incident (ไม่ใช่ snackbar อีกต่อไป)',
        (tester) async {
          await _pumpHomeRouted(tester, UserRole.st);
          final tile = find.byKey(const Key('shortcut_report_incident'));
          await tester.ensureVisible(tile);
          await tester.pumpAndSettle();
          await tester.tap(tile);
          await tester.pumpAndSettle();
          expect(find.text('INCIDENT_LIST_PAGE_STUB'), findsOneWidget);
          expect(find.textContaining('เร็ว'), findsNothing);
        },
      );
    },
  );

  group('ทางลัด "แจ้งปัญหา" (Field Incident Report, design issue #236)', () {
    for (final role in [UserRole.st, UserRole.ot]) {
      testWidgets('${role.wireName} -> เห็นทางลัด', (tester) async {
        await _pumpHome(tester, role);
        expect(find.byKey(const Key('shortcut_field_report')), findsOneWidget);
      });
    }

    for (final role in [
      UserRole.operation,
      UserRole.auditor,
      UserRole.admin,
      UserRole.superAdmin,
    ]) {
      testWidgets('${role.wireName} -> ไม่เห็น (ST/OT เท่านั้น)', (
        tester,
      ) async {
        await _pumpHome(tester, role);
        expect(find.byKey(const Key('shortcut_field_report')), findsNothing);
      });
    }
  });

  group('ทางลัด "ค้นหาอุปกรณ์" — ทุก role (GET /devices เปิดให้ทุก Role)', () {
    for (final role in [
      UserRole.st,
      UserRole.operation,
      UserRole.auditor,
      UserRole.admin,
    ]) {
      testWidgets('${role.wireName} เห็นทางลัด "ค้นหาอุปกรณ์"', (tester) async {
        await _pumpHome(tester, role);
        expect(find.byKey(const Key('shortcut_find_device')), findsOneWidget);
      });
    }

    testWidgets(
      'แตะแล้ว navigate ไปหน้าค้นหาอุปกรณ์ (ไม่ใช่ snackbar อีกต่อไป)',
      (tester) async {
        await _pumpHomeRouted(tester, UserRole.operation);
        final tile = find.byKey(const Key('shortcut_find_device'));
        await tester.ensureVisible(tile);
        await tester.pumpAndSettle();
        await tester.tap(tile);
        await tester.pumpAndSettle();
        expect(find.text('DEVICE_SEARCH_PAGE_STUB'), findsOneWidget);
        expect(find.textContaining('เร็ว'), findsNothing);
      },
    );
  });

  group('กระดิ่งแจ้งเตือน — badge จริง + navigate', () {
    testWidgets('unread > 0 -> badge โชว์จำนวน', (tester) async {
      await _pumpHome(
        tester,
        UserRole.st,
        notiRepo: _FakeNotificationRepository(unreadCount: 3),
      );
      await tester.pumpAndSettle();

      expect(find.byType(Badge), findsOneWidget);
      expect(
        find.descendant(of: find.byType(Badge), matching: find.text('3')),
        findsOneWidget,
      );
    });

    testWidgets('unread = 0 -> ไม่มี badge', (tester) async {
      await _pumpHome(
        tester,
        UserRole.st,
        notiRepo: _FakeNotificationRepository(unreadCount: 0),
      );
      await tester.pumpAndSettle();

      expect(find.byType(Badge), findsNothing);
    });

    testWidgets('แตะกระดิ่ง -> navigate ไปหน้ารายการแจ้งเตือน', (tester) async {
      await _pumpHomeRouted(
        tester,
        UserRole.st,
        notiRepo: _FakeNotificationRepository(unreadCount: 2),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('home_notifications')));
      await tester.pumpAndSettle();

      expect(find.text('NOTIFICATION_LIST_STUB'), findsOneWidget);
    });
  });

  group('logout', () {
    Future<ProviderContainer> pumpHome(
      WidgetTester tester,
      AppDatabase db,
    ) async {
      final container = ProviderContainer(
        overrides: [
          authControllerProvider.overrideWith(
            () => _FakeAuthController(UserRole.st),
          ),
          tokenStoreProvider.overrideWithValue(InMemoryTokenStore()),
          sessionProfileStoreProvider.overrideWithValue(
            InMemorySessionProfileStore(),
          ),
          taskRepositoryProvider.overrideWithValue(_FakeTaskRepository()),
          notificationRepositoryProvider.overrideWithValue(
            _FakeNotificationRepository(),
          ),
          // logout() clears this too (issue #204) — without an override it
          // falls through to the real SharedPreferences-backed store, which
          // throws (no plugin binding in this test) before logout() reaches
          // `state = ...unauthenticated`.
          appDatabaseProvider.overrideWithValue(db),
          recentDeviceIdStoreProvider.overrideWithValue(
            InMemoryRecentDeviceIdStore(),
          ),
          // HomeStatusBanners (UX audit #15) — ไม่ใช้ Drift live query ในเทส widget
          // (timer ของ stream ค้างหลังปิด tree)
          pendingTaskIdsProvider.overrideWith(
            (ref) => Stream.value(const <String>{}),
          ),
          failedSyncActionsProvider.overrideWith(
            (ref) => Stream.value(const <PendingActionRow>[]),
          ),
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
      return container;
    }

    Future<void> queueAction(AppDatabase db, String id, String status) =>
        db.pendingActionDao.insertAction(
          PendingActionsCompanion.insert(
            id: id,
            userId: 'u1',
            type: 'task_status',
            entityId: 't-$id',
            payload: '{"status":"completed"}',
            status: Value(status),
            createdAt: DateTime.utc(2026, 10, 7),
          ),
        );

    testWidgets('ไม่มีรายการค้างในคิว -> logout ทันที ไม่มี dialog', (
      tester,
    ) async {
      final db = AppDatabase.forTesting(NativeDatabase.memory());
      addTearDown(db.close);
      final container = await pumpHome(tester, db);

      await tester.tap(find.byKey(const Key('home_logout')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('logout_unsynced_dialog')), findsNothing);
      expect(
        container.read(authControllerProvider).status,
        AuthStatus.unauthenticated,
      );
    });

    testWidgets('มีรายการค้าง (pending + failed) -> dialog แสดงจำนวน, '
        'ยกเลิก = ยังไม่ logout และข้อมูลในคิวอยู่ครบ', (tester) async {
      final db = AppDatabase.forTesting(NativeDatabase.memory());
      addTearDown(db.close);
      await queueAction(db, 'p', 'pending');
      await queueAction(db, 'f', 'failed');
      final container = await pumpHome(tester, db);

      await tester.tap(find.byKey(const Key('home_logout')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('logout_unsynced_dialog')), findsOneWidget);
      expect(find.textContaining('มี 2 รายการยังไม่ซิงค์'), findsOneWidget);

      await tester.tap(find.byKey(const Key('logout_unsynced_cancel')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('logout_unsynced_dialog')), findsNothing);
      expect(
        container.read(authControllerProvider).status,
        AuthStatus.authenticated,
      );
      expect(await db.pendingActionDao.countUnsynced(), 2);
    });

    testWidgets('มีรายการค้าง + ยืนยัน -> logout และล้างคิว', (tester) async {
      final db = AppDatabase.forTesting(NativeDatabase.memory());
      addTearDown(db.close);
      await queueAction(db, 'p', 'pending');
      final container = await pumpHome(tester, db);

      await tester.tap(find.byKey(const Key('home_logout')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('logout_unsynced_confirm')));
      await tester.pumpAndSettle();

      expect(
        container.read(authControllerProvider).status,
        AuthStatus.unauthenticated,
      );
      expect(await db.pendingActionDao.countUnsynced(), 0);
    });
  });
}

AppDatabase inMemoryAppDatabase(Ref ref) {
  final db = AppDatabase.forTesting(NativeDatabase.memory());
  ref.onDispose(db.close);
  return db;
}
