import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/db/providers/database_provider.dart';
import 'package:mobile/core/db/app_database.dart';
import 'package:drift/drift.dart' show Value;
import 'package:drift/native.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/auth/auth_controller.dart';
import 'package:mobile/core/auth/token_store.dart';
import 'package:mobile/core/router/app_router.dart';
import 'package:mobile/core/sync/sync_providers.dart';
import 'package:mobile/features/device_connection_test/recent_device_id_store.dart';
import 'package:mobile/core/ui/app_badge.dart';
import 'package:mobile/core/ui/app_v2_theme.dart';
import 'package:mobile/core/ui/labels.dart';
import 'package:mobile/features/auth/account_sheet.dart';
import 'package:mobile/features/home/home_page.dart';
import 'package:mobile/features/notification/notification_repository.dart';
import 'package:mobile/features/task/task_repository.dart';
import 'package:mobile/core/config/app_config.dart';

/// เทสพฤติกรรมเฉพาะโหมดต่อ backend จริง — default ของแอปเป็น mock (CLAUDE.md
/// Mock Mode Pattern) จึงรันใน CI step `flutter test --dart-define=API_MOCK_MODE=false`
const _realModeOnly =
    'real-mode only: run with --dart-define=API_MOCK_MODE=false';

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
  _FakeTaskRepository({List<Task>? tasks}) : _tasks = tasks ?? _fakeTasks;

  final List<Task> _tasks;

  int listCalls = 0;

  @override
  Future<List<Task>> listTasks() async {
    listCalls++;
    return _tasks;
  }

  @override
  Future<Task> getTask(String id) async => _tasks.firstWhere((t) => t.id == id);

  @override
  Future<Task> updateStatus(String id, TaskStatus status) async =>
      throw UnimplementedError();
}

class _FakeNotificationRepository implements NotificationRepository {
  const _FakeNotificationRepository();

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
    final items = [_n(99, true)];
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
          notiRepo ?? const _FakeNotificationRepository(),
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
/// task cards can be asserted.
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
        path: AppRoutes.deviceSearch,
        builder: (_, _) =>
            const Scaffold(body: Text('DEVICE_SEARCH_PAGE_STUB')),
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
          notiRepo ?? const _FakeNotificationRepository(),
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
  Task task(
    String id,
    TaskStatus status, {
    String? title,
    DateTime? due,
    DateTime? updated,
  }) => Task(
    id: id,
    title: title ?? 'งาน $id',
    assignedTo: 'u1',
    status: status,
    createdAt: DateTime(2026, 9, 1),
    updatedAt: updated ?? DateTime(2026, 9, 2),
    deviceId: 'DVC-$id',
    dueDate: due,
  );

  group('หัวหน้าแรก (docs/22 §7.2)', () {
    testWidgets(
      'title "หน้าแรก" + ชื่อผู้ใช้ใน meta + ปุ่มบัญชี · ไม่มี AppBar',
      (tester) async {
        await _pumpHome(tester, UserRole.st);

        expect(find.text('หน้าแรก'), findsOneWidget);
        expect(find.text('somchai.t'), findsOneWidget);
        expect(find.byKey(const Key('account_button')), findsOneWidget);
        expect(find.byType(AppBar), findsNothing);
        expect(find.byType(AppV2Theme), findsOneWidget);
      },
    );

    testWidgets('ไม่มีทางลัดเดิม / กระดิ่ง / ปุ่ม logout บนหัว (ย้ายไปแท็บ + '
        'แผ่นบัญชี)', (tester) async {
      await _pumpHome(tester, UserRole.st);

      for (final key in [
        'shortcut_simulator',
        'shortcut_device_test',
        'shortcut_my_tasks',
        'shortcut_find_device',
        'shortcut_field_report',
        'shortcut_report_incident',
        'home_notifications',
        'home_logout',
        'view_all_history',
      ]) {
        expect(find.byKey(Key(key)), findsNothing, reason: key);
      }
      expect(find.text('ทางลัด'), findsNothing);
    });
  });

  group('รวม "งานของฉัน" เข้าหน้าแรก (มติ B ข้อ 12)', () {
    testWidgets('งานทุกสถานะอยู่หน้าเดียว: ต้องทำ = pending + กำลังทำ, '
        'ประวัติ = เสร็จ + ยกเลิก', (tester) async {
      await _pumpHome(
        tester,
        UserRole.st,
        taskRepo: _FakeTaskRepository(
          tasks: [
            task('p', TaskStatus.pending, title: 'งานรอทำ'),
            task('w', TaskStatus.inProgress, title: 'งานกำลังทำ'),
            task('c', TaskStatus.completed, title: 'งานเสร็จ'),
            task('x', TaskStatus.cancelled, title: 'งานยกเลิก'),
          ],
        ),
      );

      expect(find.text('ต้องทำ (2)'), findsOneWidget);
      for (final (i, title) in ['งานรอทำ', 'งานกำลังทำ'].indexed) {
        expect(
          find.descendant(
            of: find.byKey(Key('my_task_card_$i')),
            matching: find.text(title),
          ),
          findsOneWidget,
          reason: title,
        );
      }
      expect(find.byKey(const Key('my_task_card_2')), findsNothing);

      final history = [
        for (var i = 0; i < 2; i++)
          tester
              .widgetList<Text>(
                find.descendant(
                  of: find.byKey(Key('history_card_$i'), skipOffstage: false),
                  matching: find.byType(Text, skipOffstage: false),
                  skipOffstage: false,
                ),
              )
              .first
              .data,
      ];
      expect(history, unorderedEquals(['งานเสร็จ', 'งานยกเลิก']));
    });

    testWidgets('ป้ายสถานะใช้ AppBadge + tone ตาม Web (ยกเลิก = danger)', (
      tester,
    ) async {
      await _pumpHome(
        tester,
        UserRole.st,
        taskRepo: _FakeTaskRepository(
          tasks: [
            task('p', TaskStatus.pending),
            task('w', TaskStatus.inProgress),
            task('c', TaskStatus.completed),
            task('x', TaskStatus.cancelled),
          ],
        ),
      );

      final tones = {
        for (final b in tester.widgetList<AppBadge>(
          find.byType(AppBadge, skipOffstage: false),
        ))
          b.label: b.tone,
      };
      expect(tones['รอดำเนินการ'], AppBadgeTone.neutral);
      expect(tones['กำลังทำ'], AppBadgeTone.warning);
      expect(tones['เสร็จแล้ว'], AppBadgeTone.success);
      expect(tones['ยกเลิก'], AppBadgeTone.danger);
    });

    testWidgets('ป้ายเร่งด่วน: เลยกำหนด = danger, ใกล้ถึงกำหนด = warning', (
      tester,
    ) async {
      final now = DateTime.now();
      await _pumpHome(
        tester,
        UserRole.st,
        taskRepo: _FakeTaskRepository(
          tasks: [
            task(
              'o',
              TaskStatus.pending,
              due: now.subtract(const Duration(days: 2)),
            ),
            task(
              's',
              TaskStatus.pending,
              due: now.add(const Duration(hours: 3)),
            ),
          ],
        ),
      );

      final urgency = tester
          .widgetList<AppBadge>(find.byKey(const Key('task_urgency_badge')))
          .toList();
      expect(urgency.map((b) => (b.label, b.tone)), [
        ('เลยกำหนด', AppBadgeTone.danger),
        ('ใกล้ถึงกำหนด', AppBadgeTone.warning),
      ]);
    });

    testWidgets('ไม่มีงานค้างแต่มีประวัติ -> empty state ของส่วนต้องทำ', (
      tester,
    ) async {
      await _pumpHome(
        tester,
        UserRole.st,
        taskRepo: _FakeTaskRepository(tasks: [task('c', TaskStatus.completed)]),
      );

      expect(find.text('ต้องทำ (0)'), findsOneWidget);
      expect(find.byKey(const Key('home_open_empty')), findsOneWidget);
      expect(
        find.byKey(const Key('history_card_0'), skipOffstage: false),
        findsOneWidget,
      );
    });
  });

  group('"ประวัติงานล่าสุด"', () {
    testWidgets('สถิติงานเดือนนี้ + งานค้างไม่อยู่ในประวัติ', (tester) async {
      await _pumpHome(tester, UserRole.st);
      await tester.scrollUntilVisible(
        find.byKey(const Key('history_card_1')),
        200,
      );

      // t1 เสร็จเดือนนี้, t2 เสร็จเดือนอื่น, t3 ยังค้าง (อยู่ส่วนต้องทำ)
      expect(find.text('งานที่เสร็จเดือนนี้'), findsOneWidget);
      expect(find.text('1'), findsOneWidget);
      expect(find.text('2'), findsOneWidget);
      expect(
        find.byKey(const Key('history_card_2'), skipOffstage: false),
        findsNothing,
      );
    });

    testWidgets('เรียงงานที่จบล่าสุดก่อน + แสดง deviceId · วันเวลาที่จบ', (
      tester,
    ) async {
      await _pumpHome(tester, UserRole.st);
      await tester.scrollUntilVisible(
        find.byKey(const Key('history_card_0')),
        200,
      );

      expect(
        find.descendant(
          of: find.byKey(const Key('history_card_0')),
          matching: find.text('ติดตั้งกล่อง GPS รถบรรทุก'),
        ),
        findsOneWidget,
      );
      final d = DateTime(_now.year, _now.month, 2);
      String two(int n) => n.toString().padLeft(2, '0');
      expect(
        find.text('DVC-40271 · ${two(d.day)}/${two(d.month)}/${d.year} 00:00'),
        findsOneWidget,
      );
    });

    testWidgets('ประวัติเกิน 20 งาน -> แสดงแค่ 20 ใบล่าสุด + ข้อความบอก', (
      tester,
    ) async {
      await _pumpHome(
        tester,
        UserRole.st,
        taskRepo: _FakeTaskRepository(
          tasks: [
            for (var i = 0; i < 25; i++)
              task(
                'h$i',
                TaskStatus.completed,
                updated: DateTime(2026, 9, 1).add(Duration(hours: i)),
              ),
          ],
        ),
      );

      expect(
        find.byKey(const Key('history_card_19'), skipOffstage: false),
        findsOneWidget,
      );
      expect(
        find.byKey(const Key('history_card_20'), skipOffstage: false),
        findsNothing,
      );
      expect(
        find.text('แสดง 20 งานล่าสุด', skipOffstage: false),
        findsOneWidget,
      );
      // ตัวเลขสถิติยังนับครบทุกงาน ไม่ใช่แค่ 20 ใบที่แสดง
      expect(find.text('25', skipOffstage: false), findsOneWidget);
    });

    testWidgets('ประวัติไม่เกิน 20 งาน -> ไม่มีข้อความจำกัดจำนวน', (
      tester,
    ) async {
      await _pumpHome(tester, UserRole.st);
      expect(
        find.byKey(const Key('home_history_limit_note'), skipOffstage: false),
        findsNothing,
      );
    });

    testWidgets('ไม่มีประวัติ -> empty state ของส่วนประวัติ', (tester) async {
      await _pumpHome(
        tester,
        UserRole.st,
        taskRepo: _FakeTaskRepository(tasks: [task('p', TaskStatus.pending)]),
      );
      await tester.scrollUntilVisible(
        find.byKey(const Key('home_history_empty')),
        200,
      );
      expect(find.text('ยังไม่มีประวัติงาน'), findsOneWidget);
    });

    testWidgets('แตะการ์ดประวัติ -> ไปหน้า Task Detail ของงานนั้น', (
      tester,
    ) async {
      await _pumpHomeRouted(tester, UserRole.st);
      await tester.scrollUntilVisible(
        find.byKey(const Key('history_card_0')),
        200,
      );
      await tester.tap(find.byKey(const Key('history_card_0')));
      await tester.pumpAndSettle();

      expect(find.text('TASK_DETAIL_STUB t1'), findsOneWidget);
    });
  });

  group('role ที่ไม่ใช่ช่าง: ไม่ยิง GET /tasks (backend ไม่ self-scope ให้ '
      'role อื่น)', () {
    for (final role in [
      UserRole.operation,
      UserRole.auditor,
      UserRole.admin,
      UserRole.superAdmin,
    ]) {
      testWidgets('${role.wireName}: ไม่มีรายการงาน + ไม่ยิง GET /tasks', (
        tester,
      ) async {
        final repo = _FakeTaskRepository();
        await _pumpHome(tester, role, taskRepo: repo);

        expect(find.byKey(const Key('home_open_section')), findsNothing);
        expect(repo.listCalls, 0);
      });
    }

    testWidgets('role ว่าง: ไม่ยิง GET /tasks', (tester) async {
      final repo = _FakeTaskRepository();
      await _pumpHome(tester, null, taskRepo: repo);
      expect(repo.listCalls, 0);
    });

    testWidgets('ST: ยิง GET /tasks และเห็นรายการงาน', (tester) async {
      final repo = _FakeTaskRepository();
      await _pumpHome(tester, UserRole.st, taskRepo: repo);
      expect(find.byKey(const Key('home_open_section')), findsOneWidget);
      expect(repo.listCalls, 1);
    });
  });

  group('แผ่นบัญชีผู้ใช้ (docs/22 §7.2, §6.2)', () {
    testWidgets('ST: ชื่อ + ป้าย "ST" + บรรทัดย่อย "ช่างภาคสนาม"', (
      tester,
    ) async {
      await _pumpHome(tester, UserRole.st);
      await tester.tap(find.byKey(const Key('account_button')));
      await tester.pumpAndSettle();

      expect(
        tester.widget<Text>(find.byKey(const Key('account_username'))).data,
        'somchai.t',
      );
      expect(
        tester
            .widget<AppBadge>(find.byKey(const Key('account_role_badge')))
            .label,
        'ST',
      );
      expect(
        tester
            .widget<Text>(find.byKey(const Key('account_role_description')))
            .data,
        'ช่างภาคสนาม',
      );
      expect(find.byKey(const Key('account_logout')), findsOneWidget);
    });

    test('ป้าย role ตาม Web (formatRoleLabel) + คำอธิบายไทย', () {
      expect(roleLabel(UserRole.operation), 'Operation');
      expect(roleLabel(UserRole.superAdmin), 'Super Admin');
      expect(roleDescription(UserRole.operation), 'ฝ่ายปฏิบัติการ');
      expect(roleDescription(UserRole.ot), 'ช่างภาคสนาม');
      expect(roleDescription(null), 'ผู้ใช้งาน');
    });

    test('อักษรย่อใน avatar มาจากชื่อจริง', () {
      expect(accountInitials('somchai.t'), 'SO');
      expect(accountInitials(null), '?');
      expect(accountInitials('42'), '4');
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
            const _FakeNotificationRepository(),
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

    Future<void> tapLogout(WidgetTester tester) async {
      await tester.tap(find.byKey(const Key('account_button')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('account_logout')));
      await tester.pumpAndSettle();
    }

    testWidgets('เปิดแผ่นบัญชีอย่างเดียว -> ยังไม่ logout และไม่มี dialog', (
      tester,
    ) async {
      final db = AppDatabase.forTesting(NativeDatabase.memory());
      addTearDown(db.close);
      final container = await pumpHome(tester, db);

      await tester.tap(find.byKey(const Key('account_button')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('account_sheet')), findsOneWidget);
      expect(find.byKey(const Key('logout_confirm_dialog')), findsNothing);
      expect(
        container.read(authControllerProvider).status,
        AuthStatus.authenticated,
      );
    });

    testWidgets(
      'ไม่มีรายการค้าง: กดออกจากระบบ -> dialog ยืนยัน, ยกเลิก = ยังไม่ logout',
      (tester) async {
        final db = AppDatabase.forTesting(NativeDatabase.memory());
        addTearDown(db.close);
        final container = await pumpHome(tester, db);

        await tapLogout(tester);

        expect(find.byKey(const Key('logout_confirm_dialog')), findsOneWidget);
        expect(find.byKey(const Key('logout_unsynced_dialog')), findsNothing);

        await tester.tap(find.byKey(const Key('logout_cancel')));
        await tester.pumpAndSettle();

        expect(find.byKey(const Key('logout_confirm_dialog')), findsNothing);
        expect(
          container.read(authControllerProvider).status,
          AuthStatus.authenticated,
        );
      },
    );

    testWidgets('ไม่มีรายการค้าง: กดออกจากระบบ + ยืนยัน -> logout', (
      tester,
    ) async {
      final db = AppDatabase.forTesting(NativeDatabase.memory());
      addTearDown(db.close);
      final container = await pumpHome(tester, db);

      await tapLogout(tester);
      await tester.tap(find.byKey(const Key('logout_confirm')));
      await tester.pumpAndSettle();

      expect(
        container.read(authControllerProvider).status,
        AuthStatus.unauthenticated,
      );
    });

    // dialog เตือนคิวค้างอ่าน PendingActions เฉพาะโหมดจริง (account_sheet.dart
    // `_confirmAndLogout`)
    group('โหมดจริง', () {
      testWidgets('มีรายการค้าง (pending + failed) -> dialog แสดงจำนวน, '
          'ยกเลิก = ยังไม่ logout และข้อมูลในคิวอยู่ครบ', (tester) async {
        final db = AppDatabase.forTesting(NativeDatabase.memory());
        addTearDown(db.close);
        await queueAction(db, 'p', 'pending');
        await queueAction(db, 'f', 'failed');
        final container = await pumpHome(tester, db);

        await tapLogout(tester);

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

        await tapLogout(tester);
        await tester.tap(find.byKey(const Key('logout_unsynced_confirm')));
        await tester.pumpAndSettle();

        expect(
          container.read(authControllerProvider).status,
          AuthStatus.unauthenticated,
        );
        expect(await db.pendingActionDao.countUnsynced(), 0);
      });
    }, skip: AppConfig.apiMockMode ? _realModeOnly : false);
  });
}

AppDatabase inMemoryAppDatabase(Ref ref) {
  final db = AppDatabase.forTesting(NativeDatabase.memory());
  ref.onDispose(db.close);
  return db;
}
