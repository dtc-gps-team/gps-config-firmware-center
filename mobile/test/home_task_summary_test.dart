import 'dart:convert';

import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/auth/auth_controller.dart';
import 'package:mobile/core/auth/token_store.dart';
import 'package:mobile/core/db/app_database.dart';
import 'package:mobile/core/db/providers/database_provider.dart';
import 'package:mobile/core/db/tables/pending_actions_table.dart';
import 'package:mobile/core/router/app_router.dart';
import 'package:mobile/core/sync/sync_providers.dart';
import 'package:mobile/features/home/home_page.dart';
import 'package:mobile/features/notification/notification_repository.dart';
import 'package:mobile/features/task/task_repository.dart';

// UX audit #15 — Home เห็นแค่งานเลยกำหนด/ใกล้ครบ ไม่รู้ว่ามีงานค้างทั้งหมดกี่งาน
// และ banner ซิงค์ไม่สำเร็จ / session หมดอายุมีแค่หน้ารายการงาน

class _Auth extends AuthController {
  _Auth(this._role);
  final UserRole _role;

  @override
  AuthState build() => AuthState(
    status: AuthStatus.authenticated,
    role: _role,
    username: 'somchai',
  );
}

class _Tasks implements TaskRepository {
  _Tasks(this.tasks);
  final List<Task> tasks;

  @override
  Future<List<Task>> listTasks() async => tasks;

  @override
  Future<Task> getTask(String id) async => tasks.firstWhere((t) => t.id == id);

  @override
  Future<Task> updateStatus(String id, TaskStatus status) =>
      throw UnimplementedError();
}

class _NoNotifications implements NotificationRepository {
  @override
  Future<List<AppNotification>> list({bool? unread}) async => const [];

  @override
  Future<AppNotification> markRead(String id) => throw UnimplementedError();
}

Task _task(String id, TaskStatus status, {int? dueInDays}) => Task(
  id: id,
  title: 'งาน $id',
  assignedTo: 'u1',
  status: status,
  createdAt: DateTime(2026, 10, 1),
  updatedAt: DateTime(2026, 10, 1),
  dueDate: dueInDays == null
      ? null
      : DateTime.now().add(Duration(days: dueInDays)),
  deviceId: 'DEV-$id',
);

late AppDatabase _db;

Future<List<PendingActionRow>> _failedRows(int count) async {
  for (var i = 0; i < count; i++) {
    await _db.pendingActionDao.insertAction(
      PendingActionsCompanion.insert(
        id: 'f$i',
        userId: 'u1',
        type: PendingActionType.taskStatus.wireName,
        entityId: 't$i',
        payload: jsonEncode({'status': 'completed'}),
        createdAt: DateTime(2026, 10, 16),
      ),
    );
    await _db.pendingActionDao.markFailed('f$i', 'งานถูกยกเลิกแล้ว');
  }
  return _db.pendingActionDao.getFailed();
}

Future<void> _pumpHome(
  WidgetTester tester, {
  required List<Task> tasks,
  UserRole role = UserRole.st,
  List<PendingActionRow> failed = const [],
  bool authExpired = false,
  Set<String> pendingIds = const {},
  GoRouter? router,
}) async {
  tester.view.physicalSize = const Size(430 * 3, 3000 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        authControllerProvider.overrideWith(() => _Auth(role)),
        tokenStoreProvider.overrideWithValue(InMemoryTokenStore()),
        sessionProfileStoreProvider.overrideWithValue(
          InMemorySessionProfileStore(),
        ),
        appDatabaseProvider.overrideWithValue(_db),
        taskRepositoryProvider.overrideWithValue(_Tasks(tasks)),
        notificationRepositoryProvider.overrideWithValue(_NoNotifications()),
        failedSyncActionsProvider.overrideWith((ref) => Stream.value(failed)),
        pendingTaskIdsProvider.overrideWith((ref) => Stream.value(pendingIds)),
        syncAuthExpiredProvider.overrideWith((ref) => authExpired),
      ],
      child: router == null
          ? const MaterialApp(home: HomePage())
          : MaterialApp.router(routerConfig: router),
    ),
  );
  await tester.pump();
  await tester.pump();
}

final _summary = find.byKey(const Key('home_task_summary'));

void main() {
  setUp(() => _db = AppDatabase.forTesting(NativeDatabase.memory()));
  tearDown(() => _db.close());

  group('แถบสรุปงานค้างบน Home (UX audit #15)', () {
    testWidgets('นับงานที่ยังไม่เสร็จทั้งหมด และงานเร่งด่วน (เลย/ใกล้กำหนด)', (
      tester,
    ) async {
      await _pumpHome(
        tester,
        tasks: [
          _task('1', TaskStatus.pending, dueInDays: -2), // เลยกำหนด
          _task('2', TaskStatus.inProgress, dueInDays: 0), // ใกล้ถึงกำหนด
          _task('3', TaskStatus.pending, dueInDays: 7), // ค้าง ไม่ด่วน
          _task('4', TaskStatus.inProgress), // ค้าง ไม่มีกำหนด
          _task('5', TaskStatus.completed, dueInDays: -3), // เสร็จแล้ว ไม่นับ
          _task('6', TaskStatus.cancelled, dueInDays: -1), // ยกเลิก ไม่นับ
        ],
      );

      expect(_summary, findsOneWidget);
      expect(
        find.descendant(of: _summary, matching: find.text('ค้าง 4 · ด่วน 2')),
        findsOneWidget,
      );
    });

    testWidgets('ไม่มีงานค้าง -> ค้าง 0 · ด่วน 0', (tester) async {
      await _pumpHome(tester, tasks: [_task('1', TaskStatus.completed)]);

      expect(
        find.descendant(of: _summary, matching: find.text('ค้าง 0 · ด่วน 0')),
        findsOneWidget,
      );
    });

    testWidgets('role ที่ไม่ใช่ช่าง -> ไม่มีแถบสรุป', (tester) async {
      await _pumpHome(
        tester,
        tasks: [_task('1', TaskStatus.pending)],
        role: UserRole.operation,
      );

      expect(_summary, findsNothing);
    });

    testWidgets('แตะแถบสรุป -> ไปหน้างานของฉัน', (tester) async {
      final router = GoRouter(
        initialLocation: AppRoutes.home,
        routes: [
          GoRoute(path: AppRoutes.home, builder: (_, _) => const HomePage()),
          GoRoute(
            path: AppRoutes.myTasks,
            builder: (_, _) => const Text('MY_TASKS_PAGE'),
          ),
        ],
      );
      addTearDown(router.dispose);
      await _pumpHome(
        tester,
        tasks: [_task('1', TaskStatus.pending)],
        router: router,
      );

      await tester.tap(_summary);
      await tester.pumpAndSettle();

      expect(find.text('MY_TASKS_PAGE'), findsOneWidget);
    });
  });

  group('banner ซิงค์บน Home (UX audit #15)', () {
    testWidgets(
      'มีรายการที่ server ปฏิเสธ -> banner ซิงค์ไม่สำเร็จขึ้นบน Home',
      (tester) async {
        final failed = await tester.runAsync(() => _failedRows(2));
        await _pumpHome(
          tester,
          tasks: [_task('1', TaskStatus.pending)],
          failed: failed!,
        );

        expect(find.byKey(const Key('sync_failed_banner')), findsOneWidget);
      },
    );

    testWidgets('session หมดอายุและมีรายการรอซิงค์ -> banner ขึ้นบน Home', (
      tester,
    ) async {
      await _pumpHome(
        tester,
        tasks: [_task('1', TaskStatus.pending)],
        authExpired: true,
        pendingIds: {'1'},
      );

      expect(find.byKey(const Key('sync_auth_expired_banner')), findsOneWidget);
    });

    testWidgets('session หมดอายุแต่ไม่มีรายการรอซิงค์ -> ไม่ขึ้น (เกณฑ์เดียวกับ'
        'หน้ารายการงาน)', (tester) async {
      await _pumpHome(
        tester,
        tasks: [_task('1', TaskStatus.pending)],
        authExpired: true,
      );

      expect(find.byKey(const Key('sync_auth_expired_banner')), findsNothing);
    });

    testWidgets('ไม่มีปัญหาซิงค์ -> ไม่มี banner', (tester) async {
      await _pumpHome(tester, tasks: [_task('1', TaskStatus.pending)]);

      expect(find.byKey(const Key('sync_failed_banner')), findsNothing);
      expect(find.byKey(const Key('sync_auth_expired_banner')), findsNothing);
    });
  });
}
