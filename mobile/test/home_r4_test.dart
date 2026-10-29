import 'dart:async';
import 'dart:ui' show SemanticsAction;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/auth/auth_controller.dart';
import 'package:mobile/core/db/app_database.dart';
import 'package:mobile/core/router/app_router.dart';
import 'package:mobile/core/sync/sync_providers.dart';
import 'package:mobile/core/theme/app_theme.dart';
import 'package:mobile/core/theme/app_tokens.dart';
import 'package:mobile/features/task/task_repository.dart';
import 'package:mobile/features/notification/notification_repository.dart';
import 'package:mobile/features/device_search/device_search_repository.dart';

class _Auth extends AuthController {
  _Auth(this.role);
  final UserRole role;
  @override
  AuthState build() => AuthState(
    status: AuthStatus.authenticated,
    role: role,
    username: 'somchai.long_username',
  );
}

Task _task(String id, TaskStatus status, {int day = 1, String? title}) => Task(
  id: id,
  title: title ?? 'งาน $id',
  assignedTo: 'u1',
  status: status,
  createdAt: DateTime(2026, 10, 1),
  updatedAt: DateTime(2026, 10, day),
  deviceId: 'DEV-$id',
);

class _Repo implements TaskRepository {
  _Repo(this.tasks);
  final List<Task> tasks;
  int calls = 0;
  Object? error;
  Completer<List<Task>>? loading;
  @override
  Future<List<Task>> listTasks() async {
    calls++;
    if (error != null) throw error!;
    return loading?.future ?? tasks;
  }

  @override
  Future<Task> getTask(String id) async => tasks.firstWhere((t) => t.id == id);
  @override
  Future<Task> updateStatus(String id, TaskStatus status) =>
      throw UnimplementedError();
}

class _NoNotifications implements NotificationRepository {
  @override
  Future<List<AppNotification>> list({bool? unread}) async => [];
  @override
  Future<AppNotification> markRead(String id) => throw UnimplementedError();
}

class _NoDevices implements DeviceSearchRepository {
  @override
  Future<List<Device>> listDevices() async => [];
  @override
  Future<Device> getDevice(String id) => throw UnimplementedError();
}

Future<void> _show(WidgetTester tester, Finder target) async {
  if (target.evaluate().isEmpty) {
    await tester.scrollUntilVisible(
      target,
      200,
      scrollable: find
          .byWidgetPredicate(
            (w) => w is Scrollable && w.axisDirection == AxisDirection.down,
          )
          .first,
    );
  }
  await tester.ensureVisible(target);
}

Future<ProviderContainer> _pump(
  WidgetTester tester,
  _Repo repo, {
  UserRole role = UserRole.st,
  Size viewport = const Size(390, 844),
  double scale = 1,
}) async {
  tester.view.physicalSize = viewport * 3;
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final container = ProviderContainer(
    overrides: [
      authControllerProvider.overrideWith(() => _Auth(role)),
      taskRepositoryProvider.overrideWithValue(repo),
      deviceSearchRepositoryProvider.overrideWithValue(_NoDevices()),
      notificationRepositoryProvider.overrideWithValue(_NoNotifications()),
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
      child: MaterialApp.router(
        theme: AppTheme.v2(),
        routerConfig: container.read(routerProvider),
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(
            textScaler: TextScaler.linear(scale),
            disableAnimations: true,
          ),
          child: child!,
        ),
      ),
    ),
  );
  await tester.pump(const Duration(seconds: 1));
  await tester.pump();
  return container;
}

Future<void> _all(WidgetTester tester) async {
  final button = find.byKey(const Key('home_view_all'));
  await _show(tester, button);
  await tester.tap(button);
  await tester.pumpAndSettle();
}

void main() {
  for (final role in [UserRole.st, UserRole.ot]) {
    testWidgets('หัว Home r4: ${role.wireName} ชื่อจริง ทางลัด และเข้าค้นหา', (
      tester,
    ) async {
      final c = await _pump(tester, _Repo([]), role: role);
      expect(find.byKey(const Key('home_hero')), findsOneWidget);
      expect(find.text('somchai.long_username'), findsOneWidget);
      expect(find.text('GPS TECH'), findsOneWidget);
      expect(find.byKey(const Key('account_button')), findsOneWidget);
      final avatar = tester.widget<Text>(
        find.descendant(
          of: find.byKey(const Key('account_button')),
          matching: find.text('S'),
        ),
      );
      expect(avatar.style!.color, AppColors.onInk);
      await tester.tap(find.byKey(const Key('home_search_entry')));
      await tester.pumpAndSettle();
      expect(
        c.read(routerProvider).routeInformationProvider.value.uri.path,
        AppRoutes.deviceSearch,
      );
    });
  }

  testWidgets(
    'งานล่าสุดเลือกแค่ 3 งาน ใหม่ก่อนและใช้ id ตัดสินเมื่อเวลาเท่ากัน',
    (tester) async {
      await _pump(
        tester,
        _Repo([
          _task('old', TaskStatus.pending),
          _task('a', TaskStatus.completed, day: 3),
          _task('b', TaskStatus.cancelled, day: 3),
          _task('new', TaskStatus.inProgress, day: 4),
        ]),
      );
      expect(find.byKey(const Key('home_recent_new')), findsOneWidget);
      expect(find.byKey(const Key('home_recent_b')), findsOneWidget);
      expect(find.byKey(const Key('home_recent_a')), findsOneWidget);
      expect(find.byKey(const Key('home_recent_old')), findsNothing);
      expect(
        tester.getTopLeft(find.byKey(const Key('home_recent_b'))).dy,
        lessThan(tester.getTopLeft(find.byKey(const Key('home_recent_a'))).dy),
      );
      expect(find.textContaining('แสดง 3 จาก 4'), findsOneWidget);
    },
  );

  testWidgets('ดูทั้งหมดไม่ทิ้งงานเก่า ค้นหาพร้อมกรองสถานะ และกลับ Home ได้', (
    tester,
  ) async {
    final c = await _pump(
      tester,
      _Repo([
        _task('old', TaskStatus.pending),
        _task('a', TaskStatus.completed, day: 3),
        _task('b', TaskStatus.cancelled, day: 3),
        _task('new', TaskStatus.inProgress, day: 4),
      ]),
    );
    await _all(tester);
    expect(find.byKey(const Key('home_tasks_search')), findsOneWidget);
    await tester.tap(find.byKey(const Key('home_filter_open')));
    await tester.enterText(
      find.byKey(const Key('home_tasks_search')),
      'DEV-old',
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('home_all_old')), findsOneWidget);
    expect(find.byKey(const Key('home_all_new')), findsNothing);
    await tester.tap(find.byTooltip('ล้างคำค้น'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('home_all_new')), findsOneWidget);
    await tester.tap(find.byTooltip('ย้อนกลับ'));
    await tester.pumpAndSettle();
    expect(
      c.read(routerProvider).routeInformationProvider.value.uri.path,
      AppRoutes.home,
    );
  });

  testWidgets('รายการจำนวนมากเลื่อนถึงงานเก่าได้ ไม่จำกัดประวัติแค่20งาน', (
    tester,
  ) async {
    await _pump(
      tester,
      _Repo([
        for (var i = 0; i < 60; i++)
          _task('$i', TaskStatus.completed, day: i + 1),
      ]),
    );
    await _all(tester);
    await tester.scrollUntilVisible(
      find.byKey(const Key('home_all_0')),
      400,
      scrollable: find
          .byWidgetPredicate(
            (w) => w is Scrollable && w.axisDirection == AxisDirection.down,
          )
          .last,
    );
    expect(find.byKey(const Key('home_all_0')), findsOneWidget);
  });

  testWidgets('Home ล้มเหลวยังเข้าค้นหาได้ และ retry เรียกข้อมูลใหม่', (
    tester,
  ) async {
    final repo = _Repo([])
      ..error = ApiException('โหลดไม่สำเร็จ', statusCode: 500);
    await _pump(tester, repo);
    expect(find.byKey(const Key('my_tasks_error')), findsOneWidget);
    repo.error = null;
    await tester.ensureVisible(find.byKey(const Key('my_tasks_retry')));
    await tester.tap(find.byKey(const Key('my_tasks_retry')));
    await tester.pumpAndSettle();
    expect(repo.calls, 2);
    expect(find.byKey(const Key('my_tasks_empty')), findsOneWidget);
    expect(find.byKey(const Key('home_search_entry')), findsOneWidget);
  });

  testWidgets('loading และ empty ไม่ทำให้ทางลัดหาย', (tester) async {
    final pending = Completer<List<Task>>();
    await _pump(tester, _Repo([])..loading = pending);
    expect(find.byKey(const Key('home_recent_loading')), findsOneWidget);
    expect(find.byKey(const Key('home_incidents_shortcut')), findsOneWidget);
    pending.complete([]);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('my_tasks_empty')), findsOneWidget);
  });

  for (final scale in [1.0, 2.0]) {
    testWidgets('จอ360×640 ข้อความ${scale}x ชื่อยาว ไม่ล้นและปุ่มมีคำสั่งแตะ', (
      tester,
    ) async {
      final handle = tester.ensureSemantics();
      try {
        await _pump(
          tester,
          _Repo([_task('1', TaskStatus.pending)]),
          viewport: const Size(360, 640),
          scale: scale,
        );
        expect(tester.takeException(), isNull);
        for (final key in [
          'home_search_entry',
          'home_incidents_shortcut',
          'home_report_shortcut',
        ]) {
          await _show(tester, find.byKey(Key(key)));
          expect(
            tester
                .getSemantics(find.byKey(Key(key)))
                .getSemanticsData()
                .hasAction(SemanticsAction.tap),
            isTrue,
            reason: key,
          );
        }
        await _all(tester);
        expect(tester.takeException(), isNull);
      } finally {
        handle.dispose();
      }
    });
  }

  testWidgets(
    'Operation เปิด /home/all ตรงๆ ถูกพากลับ Device Search ไม่เรียกงาน',
    (tester) async {
      final repo = _Repo([]);
      final c = await _pump(tester, repo, role: UserRole.operation);
      c.read(routerProvider).go('/home/all');
      await tester.pumpAndSettle();
      expect(
        c.read(routerProvider).routeInformationProvider.value.uri.path,
        AppRoutes.deviceSearch,
      );
      expect(repo.calls, 0);
    },
  );
}
