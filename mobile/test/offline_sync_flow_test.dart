import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/auth/auth_controller.dart';
import 'package:mobile/core/auth/auth_repository.dart';
import 'package:mobile/core/auth/token_store.dart';
import 'package:mobile/core/db/app_database.dart';
import 'package:mobile/core/db/providers/database_provider.dart';
import 'package:mobile/core/db/task_mapping.dart';
import 'package:mobile/core/sync/sync_providers.dart';
import 'package:mobile/core/sync/sync_queue_service.dart';
import 'package:mobile/core/widgets/sync_status_widgets.dart';
import 'package:mobile/features/device_connection_test/recent_device_id_store.dart';
import 'package:mobile/features/push_notification/push_notification_service.dart';
import 'package:mobile/features/task/task_repository.dart';

// Flow-level tests that map 1:1 onto the PR #276 emulator checklist: they
// wire the real pieces together (repository + queue + triggers + AuthController)
// over an in-memory Drift DB and a scripted API, so only the visual/device
// parts of the checklist are left for the emulator. Unit-level cases live in
// `sync_queue_service_test.dart` / `task_repository_test.dart`.

class _FakeApi extends ApiClient {
  _FakeApi(this.tasks);

  final Map<String, Task> tasks;

  /// Thrown by `updateTaskStatus` while set (null = server reachable).
  ApiException? updateError;

  /// When set, `updateTaskStatus` parks on it ("request on the wire").
  Completer<void>? gate;
  final List<(String, TaskStatus)> updates = [];

  @override
  Future<List<Task>> listTasks() async => tasks.values.toList();

  @override
  Future<Task> getTask(String taskId) async => tasks[taskId]!;

  @override
  Future<Task> updateTaskStatus(String taskId, TaskStatus status) async {
    updates.add((taskId, status));
    if (gate != null) await gate!.future;
    if (updateError != null) throw updateError!;
    return tasks[taskId] = _copy(tasks[taskId]!, status);
  }
}

Task _task(String id, {TaskStatus status = TaskStatus.pending}) => Task(
  id: id,
  title: 'งาน $id',
  assignedTo: 'user-1',
  status: status,
  createdAt: DateTime.utc(2026, 9, 1),
  updatedAt: DateTime.utc(2026, 9, 1),
);

Task _copy(Task t, TaskStatus s) => Task(
  id: t.id,
  title: t.title,
  assignedTo: t.assignedTo,
  status: s,
  createdAt: t.createdAt,
  updatedAt: DateTime.utc(2026, 9, 2),
);

class _MutableAuth extends AuthController {
  _MutableAuth(this._initial);
  final AuthState _initial;

  @override
  AuthState build() => _initial;

  void set(AuthState next) => state = next;
}

class _NoopAuthRepository implements AuthRepository {
  @override
  Future<LoginResponse> login(String username, String password) =>
      throw UnimplementedError();
}

class _NoopPush implements PushNotificationService {
  @override
  Future<void> initializeAndRegister() async {}
  @override
  Future<void> unregisterAndStop() async {}
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late AppDatabase db;
  late _FakeApi api;

  setUp(() async {
    db = AppDatabase.forTesting(NativeDatabase.memory());
    api = _FakeApi({'a': _task('a'), 'b': _task('b')});
    for (final t in api.tasks.values) {
      await db.taskDao.upsertTask(taskToCompanion(t));
    }
  });
  tearDown(() => db.close());

  SyncQueueService newSync() =>
      SyncQueueService(api, db.pendingActionDao, db.taskDao);
  CachedApiTaskRepository newRepo(SyncQueueService sync) =>
      CachedApiTaskRepository(api, db.taskDao, db.pendingActionDao, sync);

  group('checklist 1: ออฟไลน์ -> รอซิงค์ -> ออนไลน์ส่งขึ้นเอง', () {
    test(
      'เปลี่ยนสถานะตอนออฟไลน์ค้างคิว (มี pending id สำหรับ badge) แล้วพอ '
      'เน็ตกลับมา SyncTriggers สั่ง flush เอง คิวหมดและ cache = ค่า server',
      () async {
        final sync = newSync();
        final repo = newRepo(sync);
        final controller = StreamController<List<ConnectivityResult>>();
        final triggers = SyncTriggers(
          onTrigger: () => sync.flush(),
          connectivity: controller.stream,
        );
        var changed = 0;
        sync.onChanged = () => changed++;
        addTearDown(() async {
          triggers.stop();
          await controller.close();
        });

        // airplane mode on
        api.updateError = ApiException('offline');
        controller.add([ConnectivityResult.none]);
        await repo.updateStatus('a', TaskStatus.inProgress);
        await sync.flush();

        final pending = await db.pendingActionDao.getPending();
        expect(pending.map((p) => p.entityId), ['a']); // → badge "รอซิงค์"
        expect((await repo.getTask('a')).status, TaskStatus.inProgress);
        expect(api.tasks['a']!.status, TaskStatus.pending); // server unchanged

        // airplane mode off — only the connectivity event triggers the send
        api.updateError = null;
        triggers.start();
        controller.add([ConnectivityResult.wifi]);
        await Future<void>.delayed(const Duration(milliseconds: 50));
        await sync.flush(); // join whatever the triggers started

        expect(await db.pendingActionDao.getPending(), isEmpty);
        expect(api.tasks['a']!.status, TaskStatus.inProgress);
        expect(
          (await db.taskDao.getTaskById('a'))!.status,
          TaskStatus.inProgress.wireName,
        );
        expect(changed, greaterThan(0)); // providers get told to refresh
      },
    );
  });

  group('checklist 2: app resume / เปิดแอปใหม่ตอนมีคิวค้าง', () {
    test('คิวที่ค้างจากรอบก่อน (service ตัวใหม่ = แอปเปิดใหม่) ถูกส่งตอน '
        'SyncTriggers.start() และตอน resume', () async {
      // previous run: change queued while offline, app then killed
      api.updateError = ApiException('offline');
      final before = newSync();
      await before.enqueueTaskStatus(
        taskId: 'a',
        userId: 'user-1',
        status: TaskStatus.completed,
      );
      await before.flush();
      expect(await db.pendingActionDao.getPending(), hasLength(1));

      // new process, server reachable
      api.updateError = null;
      final after = newSync();
      final controller = StreamController<List<ConnectivityResult>>();
      final triggers = SyncTriggers(
        onTrigger: () => after.flush(),
        connectivity: controller.stream,
      )..start(); // app start
      addTearDown(() async {
        triggers.stop();
        await controller.close();
      });
      await after.flush();

      expect(await db.pendingActionDao.getPending(), isEmpty);
      expect(api.tasks['a']!.status, TaskStatus.completed);
    });

    test('resume ตอนคิวว่าง ไม่ยิง request', () async {
      final sync = newSync();
      final triggers = SyncTriggers(
        onTrigger: () => sync.flush(),
        connectivity: const Stream.empty(),
      );
      triggers.didChangeAppLifecycleState(AppLifecycleState.resumed);
      await sync.flush();
      expect(api.updates, isEmpty);
    });
  });

  group('checklist 3: 4xx จริง -> banner + ค่ากลับเป็นของ server', () {
    test('server ปฏิเสธ (409 งานถูกยกเลิก) -> repo อ่านได้ค่า server ไม่ใช่ค่า '
        'local, action อยู่ใน failed (ที่ banner ใช้) และไม่ค้าง pending '
        '(badge หาย)', () async {
      final sync = newSync();
      final repo = newRepo(sync);
      api.tasks['a'] = _task('a', status: TaskStatus.cancelled);
      api.updateError = ApiException('งานถูกยกเลิกแล้ว', statusCode: 409);

      await repo.updateStatus('a', TaskStatus.completed);
      await sync.flush();

      expect(await db.pendingActionDao.getPending(), isEmpty);
      final failed = await db.pendingActionDao.getFailed();
      expect(failed.map((f) => f.entityId), ['a']);
      expect(failed.single.lastError, 'งานถูกยกเลิกแล้ว');
      expect((await repo.getTask('a')).status, TaskStatus.cancelled);
      expect(
        (await repo.listTasks()).firstWhere((t) => t.id == 'a').status,
        TaskStatus.cancelled,
      );
    });

    testWidgets('SyncFailedBanner แสดงจำนวน และกด "รับทราบ" แล้วล้าง failed '
        'ออกจาก DB', (tester) async {
      await tester.runAsync(() async {
        final sync = newSync();
        api.updateError = ApiException('ไม่มีสิทธิ์', statusCode: 403);
        await sync.enqueueTaskStatus(
          taskId: 'a',
          userId: 'user-1',
          status: TaskStatus.completed,
        );
        await sync.enqueueTaskStatus(
          taskId: 'a',
          userId: 'user-1',
          status: TaskStatus.inProgress,
        );
        await sync.flush();
        expect(await db.pendingActionDao.getFailed(), hasLength(2));
      });

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            pendingActionDaoProvider.overrideWithValue(db.pendingActionDao),
          ],
          child: const MaterialApp(
            home: Scaffold(body: SyncFailedBanner(count: 2)),
          ),
        ),
      );
      expect(find.byKey(const Key('sync_failed_banner')), findsOneWidget);
      expect(find.textContaining('2 รายการ'), findsOneWidget);

      await tester.tap(find.byKey(const Key('sync_failed_dismiss')));
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 50)),
      );

      expect(
        await tester.runAsync(() => db.pendingActionDao.getFailed()),
        isEmpty,
      );
    });
  });

  group('cold start: flush รอจน session restore เสร็จ', () {
    // regression ที่เจอบน emulator: SyncTriggers.start() flush ทันทีใน initState
    // ก่อน token ถูก restore -> 401 -> banner "เซสชันหมดอายุ" หลอก และคิวค้าง
    // จนกว่าจะ resume/เน็ตกลับ
    Future<ProviderContainer> boot(AuthState initial) async {
      final queued = newSync();
      api.updateError = ApiException('offline');
      await queued.enqueueTaskStatus(
        taskId: 'a',
        userId: 'user-1',
        status: TaskStatus.completed,
      );
      await queued.flush(); // previous run: left in the queue
      api.updateError = null;
      api.updates.clear();

      final container = ProviderContainer(
        overrides: [
          authControllerProvider.overrideWith(() => _MutableAuth(initial)),
          appDatabaseProvider.overrideWithValue(db),
          apiClientProvider.overrideWithValue(api),
          syncConnectivityProvider.overrideWithValue(const Stream.empty()),
        ],
      );
      addTearDown(container.dispose);
      return container;
    }

    test('session ยัง unknown -> ไม่ยิง request/ไม่ตั้ง flag session หมดอายุ, '
        'พอ authenticated -> ส่งคิวเอง', () async {
      final container = await boot(const AuthState());
      container.read(syncTriggersProvider);
      await Future<void>.delayed(const Duration(milliseconds: 50));

      expect(api.updates, isEmpty);
      expect(container.read(syncAuthExpiredProvider), isFalse);
      expect(await db.pendingActionDao.getPending(), hasLength(1));

      (container.read(authControllerProvider.notifier) as _MutableAuth).set(
        const AuthState(status: AuthStatus.authenticated),
      );
      await Future<void>.delayed(const Duration(milliseconds: 100));

      expect(api.updates, [('a', TaskStatus.completed)]);
      expect(await db.pendingActionDao.getPending(), isEmpty);
      expect(container.read(syncAuthExpiredProvider), isFalse);
    });

    test('authenticated อยู่แล้วตอนสร้าง -> ส่งทันที', () async {
      final container = await boot(
        const AuthState(status: AuthStatus.authenticated),
      );
      container.read(syncTriggersProvider);
      await Future<void>.delayed(const Duration(milliseconds: 100));

      expect(api.updates, [('a', TaskStatus.completed)]);
      expect(await db.pendingActionDao.getPending(), isEmpty);
    });

    test('ยังไม่ login (unauthenticated) -> ไม่ flush', () async {
      final container = await boot(
        const AuthState(status: AuthStatus.unauthenticated),
      );
      container.read(syncTriggersProvider);
      await Future<void>.delayed(const Duration(milliseconds: 50));
      expect(api.updates, isEmpty);
    });
  });

  group('checklist 4: logout ตอนมีคิวค้าง / request ค้างบนสาย', () {
    ProviderContainer containerWith(SyncQueueService sync) {
      final container = ProviderContainer(
        overrides: [
          authRepositoryProvider.overrideWithValue(_NoopAuthRepository()),
          tokenStoreProvider.overrideWithValue(InMemoryTokenStore('tok')),
          sessionProfileStoreProvider.overrideWithValue(
            InMemorySessionProfileStore(
              const SessionProfile('st.test', UserRole.st),
            ),
          ),
          pushNotificationServiceProvider.overrideWithValue(_NoopPush()),
          recentDeviceIdStoreProvider.overrideWithValue(
            InMemoryRecentDeviceIdStore(),
          ),
          appDatabaseProvider.overrideWithValue(db),
          syncQueueServiceProvider.overrideWithValue(sync),
        ],
      );
      addTearDown(container.dispose);
      return container;
    }

    test(
      'logout ผ่าน AuthController ตอนมี request ค้างบนสาย -> คำตอบที่มาทีหลัง '
      'ไม่ถูกเขียนกลับ cache/คิว (user คนถัดไปไม่เห็นงานคนก่อน)',
      () async {
        final sync = newSync();
        final container = containerWith(sync);
        api.gate = Completer<void>();
        await sync.enqueueTaskStatus(
          taskId: 'a',
          userId: 'user-1',
          status: TaskStatus.completed,
        );
        await Future<void>.delayed(Duration.zero);
        expect(api.updates, hasLength(1)); // on the wire

        final loggingOut = container
            .read(authControllerProvider.notifier)
            .logout();
        // server answers only after the wipe has had its chance to run
        await Future<void>.delayed(const Duration(milliseconds: 50));
        api.gate!.complete();
        await loggingOut;
        await Future<void>.delayed(const Duration(milliseconds: 50));

        expect(await db.taskDao.getAllTasks(), isEmpty);
        expect(await db.pendingActionDao.getPending(), isEmpty);
        expect(await db.pendingActionDao.getFailed(), isEmpty);
      },
    );

    test('logout ตอนมีทั้ง pending และ failed -> คิวถูกล้างหมด', () async {
      final sync = newSync();
      final container = containerWith(sync);
      api.updateError = ApiException('offline');
      await sync.enqueueTaskStatus(
        taskId: 'a',
        userId: 'user-1',
        status: TaskStatus.completed,
      );
      await sync.flush();
      api.updateError = ApiException('no', statusCode: 403);
      await sync.enqueueTaskStatus(
        taskId: 'b',
        userId: 'user-1',
        status: TaskStatus.completed,
      );
      await sync.flush();
      expect(await db.pendingActionDao.countUnsynced(), greaterThan(0));

      await container.read(authControllerProvider.notifier).logout();

      expect(await db.pendingActionDao.countUnsynced(), 0);
      expect(await db.taskDao.getAllTasks(), isEmpty);
    });
  });
}
