import 'package:drift/drift.dart' show Value;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/auth/auth_controller.dart';
import 'package:mobile/core/auth/token_store.dart';
import 'package:mobile/core/db/app_database.dart';
import 'package:mobile/core/db/providers/database_provider.dart';
import 'package:mobile/core/db/task_mapping.dart';
import 'package:mobile/core/sync/sync_providers.dart';
import 'package:mobile/features/home/home_page.dart';
import 'package:mobile/features/notification/notification_repository.dart';
import 'package:mobile/features/task/task_detail_page.dart';
import 'package:mobile/features/task/task_event_repository.dart';
import 'package:mobile/features/task/task_list_page.dart';
import 'package:mobile/features/task/task_repository.dart';

// UX audit #14 — ตอนออฟไลน์ repository ใช้ข้อมูลงานจาก cache ในเครื่องแบบเงียบๆ
// ช่างไม่รู้ว่ากำลังดูข้อมูลเก่า ต้องมีแถบ "ออฟไลน์ ข้อมูลเมื่อ HH:mm" โดยเวลาคือ
// ตอนที่ cache ถูกบันทึกจริง (ไม่ใช่เวลาปัจจุบัน)

/// server ปลอม: [offline] = true -> ทุกคำขอล้มแบบไม่มี HTTP response
class _FakeApi extends ApiClient {
  _FakeApi(this.tasks);

  final List<Task> tasks;
  bool offline = false;

  @override
  Future<List<Task>> listTasks() async {
    if (offline) throw ApiException('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ');
    return tasks;
  }

  @override
  Future<Task> getTask(String taskId) async {
    if (offline) throw ApiException('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ');
    return tasks.firstWhere((t) => t.id == taskId);
  }
}

class _Auth extends AuthController {
  @override
  AuthState build() => const AuthState(
    status: AuthStatus.authenticated,
    role: UserRole.st,
    username: 'st.test',
  );
}

class _NoEvents implements TaskEventRepository {
  @override
  Future<List<TaskEvent>> getEvents(String taskId) async => const [];

  @override
  Future<TaskEvent> addNote(String taskId, String note) =>
      throw UnimplementedError();
}

class _NoNotifications implements NotificationRepository {
  @override
  Future<List<AppNotification>> list({bool? unread}) async => const [];

  @override
  Future<AppNotification> markRead(String id) => throw UnimplementedError();
}

Task _task(String id, {TaskStatus status = TaskStatus.pending}) => Task(
  id: id,
  title: 'งาน $id',
  assignedTo: 'u1',
  status: status,
  createdAt: DateTime(2026, 10, 1),
  updatedAt: DateTime(2026, 10, 1),
  deviceId: 'DEV-$id',
);

/// เวลาที่ cache ถูกบันทึก — วันนี้ 09:15 (ไม่ใช่เวลาปัจจุบัน)
DateTime _todayAt(int h, int m) {
  final now = DateTime.now();
  return DateTime(now.year, now.month, now.day, h, m);
}

late AppDatabase _db;

Future<void> _seedCache(List<(Task, DateTime)> rows) =>
    _db.taskDao.upsertTasks([
      for (final (task, at) in rows)
        taskToCompanion(task).copyWith(cachedAt: Value(at)),
    ]);

Future<void> _pump(WidgetTester tester, Widget page, _FakeApi api) async {
  tester.view.physicalSize = const Size(430 * 3, 3000 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(api),
        appDatabaseProvider.overrideWithValue(_db),
        // repository จริงที่มี cache — ไม่ขึ้นกับ API_MOCK_MODE ตอนรันเทส
        taskRepositoryProvider.overrideWith(buildCachedTaskRepository),
        authControllerProvider.overrideWith(_Auth.new),
        tokenStoreProvider.overrideWithValue(InMemoryTokenStore()),
        sessionProfileStoreProvider.overrideWithValue(
          InMemorySessionProfileStore(),
        ),
        pendingTaskIdsProvider.overrideWith(
          (ref) => Stream.value(const <String>{}),
        ),
        failedSyncActionsProvider.overrideWith(
          (ref) => Stream.value(const <PendingActionRow>[]),
        ),
        taskEventRepositoryProvider.overrideWithValue(_NoEvents()),
        notificationRepositoryProvider.overrideWithValue(_NoNotifications()),
      ],
      child: MaterialApp(home: page),
    ),
  );
  for (var i = 0; i < 5; i++) {
    await tester.pump(const Duration(milliseconds: 50));
  }
}

Finder get _banner => find.byKey(const Key('offline_cache_banner'));

void main() {
  setUp(() => _db = AppDatabase.forTesting(NativeDatabase.memory()));
  tearDown(() => _db.close());

  group('แถบออฟไลน์ เมื่อแสดงข้อมูลจาก cache (UX audit #14)', () {
    testWidgets('รายการงาน: ออฟไลน์ -> แถบบอกเวลาที่ cache ถูกบันทึก', (
      tester,
    ) async {
      await _seedCache([(_task('1'), _todayAt(9, 15))]);
      final api = _FakeApi([_task('1')])..offline = true;

      await _pump(tester, const TaskListPage(), api);

      expect(_banner, findsOneWidget);
      expect(find.text('ออฟไลน์ ข้อมูลเมื่อ 09:15'), findsOneWidget);
      expect(find.byKey(const Key('my_task_card_0')), findsOneWidget);
    });

    testWidgets('รายการงาน: ออนไลน์ปกติ -> ไม่มีแถบ', (tester) async {
      await _seedCache([(_task('1'), _todayAt(9, 15))]);
      final api = _FakeApi([_task('1')]);

      await _pump(tester, const TaskListPage(), api);

      expect(_banner, findsNothing);
      expect(find.byKey(const Key('my_task_card_0')), findsOneWidget);
    });

    testWidgets('cache หลายแถวคนละเวลา -> บอกเวลาที่เก่าที่สุด', (
      tester,
    ) async {
      await _seedCache([
        (_task('1'), _todayAt(10, 40)),
        (_task('2'), _todayAt(8, 5)),
      ]);
      final api = _FakeApi(const [])..offline = true;

      await _pump(tester, const TaskListPage(), api);

      expect(find.text('ออฟไลน์ ข้อมูลเมื่อ 08:05'), findsOneWidget);
    });

    testWidgets('cache ของเมื่อวาน -> บอกวันที่ด้วย ไม่ใช่แค่เวลา', (
      tester,
    ) async {
      final yesterday = _todayAt(9, 15).subtract(const Duration(days: 1));
      await _seedCache([(_task('1'), yesterday)]);
      final api = _FakeApi(const [])..offline = true;

      await _pump(tester, const TaskListPage(), api);

      final dd = yesterday.day.toString().padLeft(2, '0');
      final mm = yesterday.month.toString().padLeft(2, '0');
      expect(find.text('ออฟไลน์ ข้อมูลเมื่อ $dd/$mm 09:15'), findsOneWidget);
    });

    testWidgets('รายละเอียดงาน: ออฟไลน์ -> แถบบอกเวลาของงานนั้น', (
      tester,
    ) async {
      await _seedCache([(_task('1'), _todayAt(7, 30))]);
      final api = _FakeApi([_task('1')])..offline = true;

      await _pump(tester, const TaskDetailPage(taskId: '1'), api);

      expect(find.text('ออฟไลน์ ข้อมูลเมื่อ 07:30'), findsOneWidget);
    });

    testWidgets('Home: ออฟไลน์ -> แถบขึ้นบน Home ด้วย', (tester) async {
      await _seedCache([(_task('1'), _todayAt(9, 15))]);
      final api = _FakeApi([_task('1')])..offline = true;

      await _pump(tester, const HomePage(), api);

      expect(find.text('ออฟไลน์ ข้อมูลเมื่อ 09:15'), findsOneWidget);
    });

    testWidgets('เน็ตกลับมาแล้วดึงใหม่ -> แถบหายไป', (tester) async {
      await _seedCache([(_task('1'), _todayAt(9, 15))]);
      final api = _FakeApi([_task('1')])..offline = true;
      await _pump(tester, const TaskListPage(), api);
      expect(_banner, findsOneWidget);

      api.offline = false;
      ProviderScope.containerOf(
        tester.element(find.byType(TaskListPage)),
      ).invalidate(taskListProvider);
      for (var i = 0; i < 5; i++) {
        await tester.pump(const Duration(milliseconds: 50));
      }

      expect(_banner, findsNothing);
    });

    test(
      'ข้อมูลจาก server -> cachedAt ของแถวถูกบันทึกเป็นเวลาที่ดึง',
      () async {
        final container = ProviderContainer(
          overrides: [
            apiClientProvider.overrideWithValue(_FakeApi([_task('1')])),
            appDatabaseProvider.overrideWithValue(_db),
            taskRepositoryProvider.overrideWith(buildCachedTaskRepository),
          ],
        );
        addTearDown(container.dispose);
        final before = DateTime.now().subtract(const Duration(seconds: 1));

        await container.read(taskRepositoryProvider).listTasks();

        final row = await _db.taskDao.getTaskById('1');
        expect(row!.cachedAt, isNotNull);
        expect(row.cachedAt!.isAfter(before), isTrue);
      },
    );
  });
}
