import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/auth/auth_controller.dart';
import 'package:mobile/core/auth/token_store.dart';
import 'package:mobile/core/db/providers/database_provider.dart';
import 'package:mobile/core/router/app_router.dart';
import 'package:mobile/core/router/app_shell.dart';
import 'package:mobile/core/db/app_database.dart';
import 'package:mobile/core/sync/sync_providers.dart';
import 'package:mobile/features/device_connection_test/recent_device_id_store.dart';
import 'package:mobile/features/device_search/device_search_page.dart';
import 'package:mobile/features/device_search/device_search_repository.dart';
import 'package:mobile/features/home/home_page.dart';
import 'package:mobile/features/incident/incident_detail_page.dart';
import 'package:mobile/features/incident/incident_list_page.dart';
import 'package:mobile/features/incident/incident_repository.dart';
import 'package:mobile/features/notification/notification_list_page.dart';
import 'package:mobile/features/notification/notification_repository.dart';
import 'package:mobile/features/task/task_repository.dart';

// docs/22 Batch 3a — แท็บด้านล่างตาม role (§7.2) ผ่าน routerProvider ตัวจริง

class _Auth extends AuthController {
  _Auth(this._role);

  final UserRole _role;

  @override
  AuthState build() => AuthState(
    status: AuthStatus.authenticated,
    role: _role,
    username: 'st.demo',
  );
}

class _Tasks implements TaskRepository {
  @override
  Future<List<Task>> listTasks() async => [
    Task(
      id: 't1',
      title: 'ติดตั้งกล่อง GPS',
      assignedTo: 'u1',
      status: TaskStatus.pending,
      createdAt: DateTime(2026, 10, 1),
      updatedAt: DateTime(2026, 10, 1),
    ),
  ];

  @override
  Future<Task> getTask(String id) => throw UnimplementedError();

  @override
  Future<Task> updateStatus(String id, TaskStatus status) =>
      throw UnimplementedError();
}

class _Notifications implements NotificationRepository {
  _Notifications(this.unread);

  final int unread;

  @override
  Future<List<AppNotification>> list({bool? unread}) async => [
    for (var i = 0; i < this.unread; i++)
      AppNotification(
        id: 'n$i',
        userId: 'u1',
        type: NotificationType.taskAssigned,
        payload: const {},
        read: false,
        createdAt: DateTime(2026, 10, 1, 8, i),
      ),
  ];

  @override
  Future<AppNotification> markRead(String id) => throw UnimplementedError();
}

final _incident = Incident(
  id: 'i-1',
  title: 'เขียน Config ไม่สำเร็จ',
  severity: IncidentSeverity.high,
  status: IncidentStatus.open,
  createdAt: DateTime(2026, 10, 1),
  updatedAt: DateTime(2026, 10, 1),
);

class _Incidents implements IncidentRepository {
  @override
  Future<List<Incident>> listIncidents() async => [_incident];

  @override
  Future<Incident> getIncident(String id) async => _incident;

  @override
  Future<Incident> createFieldReport({
    required String title,
    required String description,
    required IncidentSeverity severity,
    String? deviceId,
  }) => throw UnimplementedError();
}

class _Devices implements DeviceSearchRepository {
  @override
  Future<List<Device>> listDevices() async => const [];

  @override
  Future<Device> getDevice(String deviceId) => throw UnimplementedError();
}

Future<GoRouter> _pumpApp(
  WidgetTester tester,
  UserRole role, {
  int unread = 0,
}) async {
  tester.view.physicalSize = const Size(400 * 3, 900 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final container = ProviderContainer(
    overrides: [
      authControllerProvider.overrideWith(() => _Auth(role)),
      // logout() ล้างของเหล่านี้ — ไม่ใช้ secure storage / SharedPreferences จริง
      tokenStoreProvider.overrideWithValue(InMemoryTokenStore()),
      sessionProfileStoreProvider.overrideWithValue(
        InMemorySessionProfileStore(),
      ),
      recentDeviceIdStoreProvider.overrideWithValue(
        InMemoryRecentDeviceIdStore(),
      ),
      appDatabaseProvider.overrideWith((ref) {
        final db = AppDatabase.forTesting(NativeDatabase.memory());
        ref.onDispose(db.close);
        return db;
      }),
      taskRepositoryProvider.overrideWithValue(_Tasks()),
      notificationRepositoryProvider.overrideWithValue(_Notifications(unread)),
      incidentRepositoryProvider.overrideWithValue(_Incidents()),
      deviceSearchRepositoryProvider.overrideWithValue(_Devices()),
      pendingTaskIdsProvider.overrideWith(
        (ref) => Stream.value(const <String>{}),
      ),
      failedSyncActionsProvider.overrideWith(
        (ref) => Stream.value(const <PendingActionRow>[]),
      ),
    ],
  );
  addTearDown(container.dispose);
  final router = container.read(routerProvider);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp.router(routerConfig: router),
    ),
  );
  await tester.pumpAndSettle();
  return router;
}

List<String> _tabLabels(WidgetTester tester) => [
  for (final d in tester.widgetList<NavigationDestination>(
    find.byType(NavigationDestination),
  ))
    d.label,
];

String _location(GoRouter router) =>
    router.routerDelegate.currentConfiguration.uri.path;

/// ทุก path ที่ประกาศใน router (รวม route ใน shell)
List<String> _allPaths(List<RouteBase> routes) => [
  for (final r in routes) ...[if (r is GoRoute) r.path, ..._allPaths(r.routes)],
];

void main() {
  group('แท็บตาม role (docs/22 §7.2)', () {
    for (final role in [UserRole.st, UserRole.ot]) {
      testWidgets('${role.wireName}: 4 แท็บ หน้าแรก · Device Search · '
          'Incidents · แจ้งเตือน และเปิดมาที่หน้าแรก', (tester) async {
        final router = await _pumpApp(tester, role);

        expect(_tabLabels(tester), [
          'หน้าแรก',
          'Device Search',
          'Incidents',
          'แจ้งเตือน',
        ]);
        expect(_location(router), AppRoutes.home);
        expect(find.byType(HomePage), findsOneWidget);
      });
    }

    testWidgets('Operation: 3 แท็บ (ไม่มีแท็บงาน) เปิดมาที่ Device Search', (
      tester,
    ) async {
      final router = await _pumpApp(tester, UserRole.operation);

      expect(_tabLabels(tester), ['Device Search', 'Incidents', 'แจ้งเตือน']);
      expect(_location(router), AppRoutes.deviceSearch);
      expect(find.byType(DeviceSearchPage), findsOneWidget);
    });

    testWidgets('Operation เข้า /home ตรงๆ -> ถูกพาไป Device Search', (
      tester,
    ) async {
      final router = await _pumpApp(tester, UserRole.operation);

      router.go(AppRoutes.home);
      await tester.pumpAndSettle();

      expect(_location(router), AppRoutes.deviceSearch);
      expect(find.byType(HomePage), findsNothing);
    });

    test('tabsFor / landingFor', () {
      expect(tabsFor(UserRole.st), AppTab.values);
      expect(tabsFor(UserRole.operation).contains(AppTab.home), isFalse);
      expect(tabsFor(null).contains(AppTab.home), isFalse);
      expect(landingFor(UserRole.ot), AppRoutes.home);
      expect(landingFor(UserRole.operation), AppRoutes.deviceSearch);
    });
  });

  group('สลับแท็บ', () {
    testWidgets('แตะแต่ละแท็บ -> เปิดหน้าของแท็บนั้น แถบแท็บยังอยู่', (
      tester,
    ) async {
      final router = await _pumpApp(tester, UserRole.st);

      final cases = [
        ('tab_devices', AppRoutes.deviceSearch, DeviceSearchPage, 1),
        ('tab_incidents', AppRoutes.incidents, IncidentListPage, 2),
        ('tab_notifications', AppRoutes.notifications, NotificationListPage, 3),
        ('tab_home', AppRoutes.home, HomePage, 0),
      ];
      for (final (key, location, page, index) in cases) {
        await tester.tap(find.byKey(Key(key)));
        await tester.pumpAndSettle();

        expect(_location(router), location, reason: key);
        expect(find.byType(page), findsOneWidget, reason: key);
        expect(find.byKey(const Key('app_tab_bar')), findsOneWidget);
        final bar = tester.widget<NavigationBar>(
          find.byKey(const Key('app_tab_bar')),
        );
        expect(bar.selectedIndex, index, reason: key);
      }
    });

    testWidgets('หน้าระดับแท็บไม่มีปุ่มย้อนกลับ (เป็นรากของแท็บ)', (
      tester,
    ) async {
      await _pumpApp(tester, UserRole.st);

      for (final key in ['tab_incidents', 'tab_notifications']) {
        await tester.tap(find.byKey(Key(key)));
        await tester.pumpAndSettle();
        expect(find.byTooltip('ย้อนกลับ'), findsNothing, reason: key);
      }
    });

    testWidgets('หน้าลูกเปิดทับแถบแท็บ · back กลับแท็บเดิม (ไม่ปิดแอป)', (
      tester,
    ) async {
      final router = await _pumpApp(tester, UserRole.st);
      await tester.tap(find.byKey(const Key('tab_incidents')));
      await tester.pumpAndSettle();

      await tester.tap(find.text('เขียน Config ไม่สำเร็จ'));
      await tester.pumpAndSettle();

      expect(find.byType(IncidentDetailPage), findsOneWidget);
      expect(find.byKey(const Key('app_tab_bar')), findsNothing);

      await tester.tap(find.byTooltip('ย้อนกลับ'));
      await tester.pumpAndSettle();

      expect(_location(router), AppRoutes.incidents);
      expect(find.byType(IncidentListPage), findsOneWidget);
      expect(find.byKey(const Key('app_tab_bar')), findsOneWidget);
    });
  });

  group('ตัวเลขยังไม่อ่านบนแท็บแจ้งเตือน (แทนกระดิ่งเดิม)', () {
    testWidgets('unread > 0 -> badge โชว์จำนวน', (tester) async {
      await _pumpApp(tester, UserRole.st, unread: 3);

      final badge = find.byKey(const Key('tab_notifications_badge'));
      expect(badge, findsOneWidget);
      expect(
        find.descendant(of: badge, matching: find.text('3')),
        findsOneWidget,
      );
    });

    testWidgets('unread = 0 -> ไม่มี badge', (tester) async {
      await _pumpApp(tester, UserRole.st);
      expect(find.byKey(const Key('tab_notifications_badge')), findsNothing);
    });
  });

  group('แผ่นบัญชีผู้ใช้จากหน้าระดับแท็บ', () {
    testWidgets('แผ่นคลุมแถบแท็บ (เปิดบน navigator ราก) แตะแท็บไม่ได้', (
      tester,
    ) async {
      await _pumpApp(tester, UserRole.st);
      await tester.tap(find.byKey(const Key('tab_incidents')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('account_button')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('account_sheet')), findsOneWidget);
      expect(find.byKey(const Key('tab_home')).hitTestable(), findsNothing);
    });

    testWidgets('ออกจากระบบ + ยืนยัน -> กลับหน้า login', (tester) async {
      final router = await _pumpApp(tester, UserRole.st);

      await tester.tap(find.byKey(const Key('account_button')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('account_logout')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('logout_confirm')));
      await tester.pumpAndSettle();

      expect(_location(router), AppRoutes.login);
      expect(find.byKey(const Key('account_sheet')), findsNothing);
      expect(find.byKey(const Key('app_tab_bar')), findsNothing);
    });
  });

  group('หน้าที่ถูกตัด (docs/22 §8.1)', () {
    testWidgets('ไม่มี route /tasks แล้ว ("งานของฉัน" รวมเข้าหน้าแรก)', (
      tester,
    ) async {
      final router = await _pumpApp(tester, UserRole.st);

      final paths = _allPaths(router.configuration.routes);
      expect(paths, isNot(contains('/tasks')));
      // Task Detail ยังอยู่ (เปิดจากหน้าแรก แจ้งเตือน push)
      expect(paths, contains(AppRoutes.taskDetailPattern));
    });
  });
}
