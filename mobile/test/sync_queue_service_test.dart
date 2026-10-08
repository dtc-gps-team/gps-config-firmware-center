import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:drift/native.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/db/app_database.dart';
import 'package:mobile/core/db/task_mapping.dart';
import 'package:mobile/core/sync/sync_providers.dart';
import 'package:mobile/core/sync/sync_queue_service.dart';

/// Scriptable [ApiClient]: `updateTaskStatus` pops the next scripted outcome
/// (an [ApiException] to throw, or null to succeed) and records the call.
class _FakeApiClient extends ApiClient {
  /// Thrown by every `updateTaskStatus` while set (server unreachable / 5xx).
  ApiException? error;

  /// Per-task rejection (e.g. a 403 for one task only).
  final Map<String, ApiException> reject = {};
  final List<(String, TaskStatus)> updates = [];
  final Map<String, Task> serverTasks = {};

  /// When set, `updateTaskStatus` waits on it (request "on the wire").
  Completer<void>? gate;

  @override
  Future<Task> updateTaskStatus(String taskId, TaskStatus status) async {
    updates.add((taskId, status));
    if (gate != null) await gate!.future;
    final outcome = error ?? reject[taskId];
    if (outcome != null) throw outcome;
    final updated = _task(taskId, status: status);
    serverTasks[taskId] = updated;
    return updated;
  }

  @override
  Future<Task> getTask(String taskId) async =>
      serverTasks[taskId] ?? _task(taskId);
}

Task _task(String id, {TaskStatus status = TaskStatus.pending}) => Task(
  id: id,
  title: 'งาน $id',
  assignedTo: 'user-1',
  status: status,
  createdAt: DateTime.utc(2026, 9, 1),
  updatedAt: DateTime.utc(2026, 9, 1),
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late AppDatabase db;
  late _FakeApiClient api;
  late SyncQueueService sync;

  setUp(() async {
    db = AppDatabase.forTesting(NativeDatabase.memory());
    api = _FakeApiClient();
    sync = SyncQueueService(api, db.pendingActionDao, db.taskDao);
    await db.taskDao.upsertTask(taskToCompanion(_task('a')));
    await db.taskDao.upsertTask(taskToCompanion(_task('b')));
  });
  tearDown(() => db.close());

  Future<void> enqueue(String id, TaskStatus s) =>
      sync.enqueueTaskStatus(taskId: id, userId: 'user-1', status: s);

  group('SyncQueueService.flush', () {
    test(
      'success -> ส่งตามลำดับ createdAt, ลบออกจากคิว, cache = ค่า server',
      () async {
        api.error = ApiException('offline'); // queue all while "offline"
        await enqueue('a', TaskStatus.inProgress);
        await enqueue('a', TaskStatus.completed);
        await enqueue('b', TaskStatus.completed);
        await sync.flush();
        expect(await db.pendingActionDao.getPending(), hasLength(3));

        api.error = null;
        api.updates.clear();
        await sync.flush();

        expect(api.updates, [
          ('a', TaskStatus.inProgress),
          ('a', TaskStatus.completed),
          ('b', TaskStatus.completed),
        ]);
        expect(await db.pendingActionDao.getPending(), isEmpty);
        expect(await db.pendingActionDao.getFailed(), isEmpty);
        expect((await db.taskDao.getTaskById('a'))!.status, 'completed');
        expect((await db.taskDao.getTaskById('b'))!.status, 'completed');
      },
    );

    test(
      'network error (ไม่มี statusCode) -> หยุด, ค้างในคิว, นับ attempts, รอบหน้าส่งต่อได้',
      () async {
        api.error = ApiException('offline');
        await enqueue('a', TaskStatus.inProgress);
        await enqueue('b', TaskStatus.completed);
        await sync.flush();

        final pending = await db.pendingActionDao.getPending();
        expect(pending.map((p) => p.entityId), ['a', 'b']);
        expect(pending.first.attempts, greaterThanOrEqualTo(1));
        expect(pending.first.lastError, 'offline');
        // stopped at the first failure — 'b' was never tried
        expect(api.updates.where((u) => u.$1 == 'b'), isEmpty);
        expect(pending.last.attempts, 0);

        api.error = null;
        api.updates.clear();
        await sync.flush();
        expect(api.updates.map((u) => u.$1), ['a', 'b']);
        expect(await db.pendingActionDao.getPending(), isEmpty);
      },
    );

    for (final code in [500, 503, 401, 408, 429]) {
      test('HTTP $code -> ถือว่าชั่วคราว: ค้างในคิว ไม่ mark failed', () async {
        api.error = ApiException('x', statusCode: code);
        await enqueue('a', TaskStatus.inProgress);
        await sync.flush();

        expect(await db.pendingActionDao.getPending(), hasLength(1));
        expect(await db.pendingActionDao.getFailed(), isEmpty);
      });
    }

    test(
      '401 -> onAuthExpired(true), ส่งสำเร็จภายหลัง -> onAuthExpired(false)',
      () async {
        final seen = <bool>[];
        sync.onAuthExpired = seen.add;
        api.error = ApiException('หมดอายุ', statusCode: 401);
        await enqueue('a', TaskStatus.inProgress);
        await sync.flush();
        expect(seen, isNotEmpty);
        expect(seen.every((expired) => expired), isTrue);

        api.error = null;
        await sync.flush();
        expect(seen.last, isFalse);
      },
    );

    test(
      'stop() ระหว่างรอ response (logout) -> คำตอบที่มาทีหลังไม่ถูกเขียนกลับ cache',
      () async {
        api.gate = Completer<void>();
        await enqueue('a', TaskStatus.completed);
        await Future<void>.delayed(Duration.zero); // request is on the wire
        expect(api.updates, hasLength(1));

        final stopping = sync.stop();
        await db.clearAllUserData(); // what logout does right after
        api.gate!.complete();
        await stopping;

        expect(await db.taskDao.getAllTasks(), isEmpty);
        expect(await db.pendingActionDao.getPending(), isEmpty);
      },
    );

    test(
      '4xx -> mark failed ไม่ retry, action ถัดไปของ task เดียวกันถูก fail ด้วย, task อื่นยังส่งต่อ, cache กลับเป็นค่า server',
      () async {
        api.error = ApiException('offline'); // queue all three together
        await enqueue('a', TaskStatus.inProgress);
        await enqueue('a', TaskStatus.completed);
        await enqueue('b', TaskStatus.completed);
        await sync.flush();
        expect(await db.pendingActionDao.getPending(), hasLength(3));

        api.error = null;
        api.reject['a'] = ApiException('ไม่มีสิทธิ์', statusCode: 403);
        api.serverTasks['a'] = _task('a', status: TaskStatus.cancelled);
        api.updates.clear();
        await sync.flush();

        // 'a' sent once (rejected); its follower never sent; 'b' went through
        expect(api.updates, [
          ('a', TaskStatus.inProgress),
          ('b', TaskStatus.completed),
        ]);
        final failed = await db.pendingActionDao.getFailed();
        expect(failed.map((f) => f.entityId), ['a', 'a']);
        expect(failed.any((f) => f.lastError == 'ไม่มีสิทธิ์'), isTrue);
        expect(await db.pendingActionDao.getPending(), isEmpty);
        // server wins: cache shows what the server says, not the local edit
        expect((await db.taskDao.getTaskById('a'))!.status, 'cancelled');

        // a later flush never retries the failed ones
        api.updates.clear();
        await sync.flush();
        expect(api.updates, isEmpty);

        await db.pendingActionDao.deleteFailed();
        expect(await db.pendingActionDao.getFailed(), isEmpty);
      },
    );

    test(
      'flush ซ้อนกัน -> ไม่ส่งซ้ำ และ action ที่เข้าระหว่างนั้นไม่ตก',
      () async {
        await enqueue('a', TaskStatus.inProgress);
        final first = sync.flush();
        final second = sync.flush();
        await enqueue('b', TaskStatus.completed);
        await Future.wait([first, second, sync.flush()]);

        expect(api.updates.where((u) => u.$1 == 'a'), hasLength(1));
        expect(api.updates.where((u) => u.$1 == 'b'), hasLength(1));
        expect(await db.pendingActionDao.getPending(), isEmpty);
      },
    );

    test('onChanged ถูกเรียกเมื่อ flush ทำให้คิว/cache เปลี่ยน', () async {
      var calls = 0;
      sync.onChanged = () => calls++;
      await enqueue('a', TaskStatus.inProgress);
      await sync.flush();
      expect(calls, greaterThan(0));
    });
  });

  group('migration v1 -> v2', () {
    test(
      'อัปเกรดแล้วข้อมูล Tasks เดิมยังอยู่ และตาราง pending_actions ใช้ได้',
      () async {
        final v1 = NativeDatabase.memory(
          setup: (raw) {
            raw.execute('''
            CREATE TABLE tasks (
              id TEXT NOT NULL PRIMARY KEY,
              title TEXT NOT NULL,
              assigned_to TEXT NOT NULL,
              status TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL,
              description TEXT NULL,
              device_id TEXT NULL,
              config_id TEXT NULL,
              due_date INTEGER NULL,
              sync_status TEXT NOT NULL DEFAULT 'synced'
            )''');
            raw.execute(
              "INSERT INTO tasks (id, title, assigned_to, status, created_at, "
              "updated_at) VALUES ('old', 'งานเก่า', 'u1', 'pending', 1, 1)",
            );
            raw.execute('PRAGMA user_version = 1');
          },
        );
        final upgraded = AppDatabase.forTesting(v1);
        addTearDown(upgraded.close);

        expect((await upgraded.taskDao.getAllTasks()).single.id, 'old');
        expect(await upgraded.pendingActionDao.getPending(), isEmpty);

        final svc = SyncQueueService(
          _FakeApiClient(),
          upgraded.pendingActionDao,
          upgraded.taskDao,
        );
        await svc.enqueueTaskStatus(
          taskId: 'old',
          userId: 'u1',
          status: TaskStatus.inProgress,
        );
        await svc.flush();
        expect(
          (await upgraded.taskDao.getTaskById('old'))!.status,
          'in_progress',
        );
      },
    );

    test(
      'DB ใหม่ (onCreate) มีทั้ง 2 ตาราง และ clearAllUserData ล้างทั้งคู่',
      () async {
        await db.pendingActionDao.insertAction(
          PendingActionsCompanion.insert(
            id: 'x',
            userId: 'u',
            type: 'task_status',
            entityId: 'a',
            payload: '{}',
            createdAt: DateTime.utc(2026),
          ),
        );
        await db.clearAllUserData();
        expect(await db.taskDao.getAllTasks(), isEmpty);
        expect(await db.pendingActionDao.getPending(), isEmpty);
      },
    );
  });

  group('SyncTriggers', () {
    test('trigger ตอน start, ตอนเน็ตกลับมา และตอน app resume', () async {
      final controller = StreamController<List<ConnectivityResult>>();
      var calls = 0;
      final triggers = SyncTriggers(
        onTrigger: () => calls++,
        connectivity: controller.stream,
      )..start();
      addTearDown(() async {
        triggers.stop();
        await controller.close();
      });
      expect(calls, 1); // leftovers from the previous run

      controller.add([ConnectivityResult.wifi]); // online -> online: nothing
      await Future<void>.delayed(Duration.zero);
      expect(calls, 1);

      controller.add([ConnectivityResult.none]);
      await Future<void>.delayed(Duration.zero);
      expect(calls, 1);

      controller.add([ConnectivityResult.mobile]); // back online
      await Future<void>.delayed(Duration.zero);
      expect(calls, 2);

      triggers.didChangeAppLifecycleState(AppLifecycleState.paused);
      expect(calls, 2);
      triggers.didChangeAppLifecycleState(AppLifecycleState.resumed);
      expect(calls, 3);
    });
  });
}
