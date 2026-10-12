import 'package:drift/native.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/auth/auth_controller.dart';
import 'package:mobile/core/config/app_config.dart';
import 'package:mobile/core/db/app_database.dart';
import 'package:mobile/core/db/providers/database_provider.dart';
import 'package:mobile/core/sync/sync_queue_service.dart';
import 'package:mobile/features/task/task_repository.dart';

class _FakeAuthController extends AuthController {
  _FakeAuthController(this._role);

  final UserRole? _role;

  @override
  AuthState build() => AuthState(status: AuthStatus.authenticated, role: _role);
}

class _RecordingTaskRepository implements TaskRepository {
  int listCalls = 0;

  @override
  Future<List<Task>> listTasks() async {
    listCalls++;
    return const [];
  }

  @override
  Future<Task> getTask(String id) => throw UnimplementedError();

  @override
  Future<Task> updateStatus(String id, TaskStatus status) =>
      throw UnimplementedError();
}

/// Scriptable [ApiClient] — each call either returns the canned value or
/// throws [error] (null = succeed). Same hand-written-fake style as
/// [_RecordingTaskRepository] above; this file doesn't use a mocking package.
class _FakeApiClient extends ApiClient {
  _FakeApiClient({this.tasks = const [], this.error});

  List<Task> tasks;
  Object? error;

  /// When true, `updateTaskStatus` throws a network error (server
  /// unreachable for writes) while reads keep working.
  bool holdUpdates = false;

  @override
  Future<List<Task>> listTasks() async {
    if (error != null) throw error!;
    return tasks;
  }

  @override
  Future<Task> getTask(String taskId) async {
    if (error != null) throw error!;
    return tasks.firstWhere((t) => t.id == taskId);
  }

  @override
  Future<Task> updateTaskStatus(String taskId, TaskStatus status) async {
    if (holdUpdates) throw ApiException('offline');
    if (error != null) throw error!;
    final old = tasks.firstWhere((t) => t.id == taskId);
    return _task(old.id, status: status);
  }
}

Task _task(String id, {TaskStatus status = TaskStatus.pending}) => Task(
  id: id,
  title: 'งาน $id',
  assignedTo: 'user-1',
  status: status,
  createdAt: DateTime.utc(2026, 9, 1, 8),
  updatedAt: DateTime.utc(2026, 9, 1, 9),
);

void main() {
  group('taskRepositoryProvider', () {
    test('picks the implementation from API_MOCK_MODE', () {
      final container = ProviderContainer(
        overrides: [
          appDatabaseProvider.overrideWith((ref) {
            final db = AppDatabase.forTesting(NativeDatabase.memory());
            ref.onDispose(db.close);
            return db;
          }),
        ],
      );
      addTearDown(container.dispose);

      final repo = container.read(taskRepositoryProvider);
      if (AppConfig.apiMockMode) {
        expect(repo, isA<MockTaskRepository>());
      } else {
        expect(repo, isA<CachedApiTaskRepository>());
      }
    });
  });

  group('taskListProvider — role gate', () {
    Future<({List<Task> tasks, int calls})> readFor(UserRole? role) async {
      final repo = _RecordingTaskRepository();
      final container = ProviderContainer(
        overrides: [
          authControllerProvider.overrideWith(() => _FakeAuthController(role)),
          taskRepositoryProvider.overrideWithValue(repo),
        ],
      );
      addTearDown(container.dispose);
      final tasks = await container.read(taskListProvider.future);
      return (tasks: tasks, calls: repo.listCalls);
    }

    for (final role in [UserRole.operation, UserRole.admin, null]) {
      test(
        '${role?.wireName ?? 'no role'} -> empty, repo not called',
        () async {
          final result = await readFor(role);
          expect(result.tasks, isEmpty);
          expect(result.calls, 0);
        },
      );
    }

    for (final role in [UserRole.st, UserRole.ot]) {
      test('${role.wireName} -> hits the repository', () async {
        final result = await readFor(role);
        expect(result.calls, 1);
      });
    }
  });

  group('MockTaskRepository', () {
    test('listTasks returns the seeded tasks', () async {
      final repo = MockTaskRepository();
      final tasks = await repo.listTasks();
      expect(tasks, isNotEmpty);
      expect(tasks.map((t) => t.id), contains('mock-task-1'));
    });

    test('getTask returns a match / throws 404 otherwise', () async {
      final repo = MockTaskRepository();

      final task = await repo.getTask('mock-task-1');
      expect(task.id, 'mock-task-1');

      await expectLater(
        repo.getTask('nope'),
        throwsA(
          isA<ApiException>().having((e) => e.statusCode, 'statusCode', 404),
        ),
      );
    });

    test('updateStatus mutates the stored task and bumps updatedAt', () async {
      final repo = MockTaskRepository();
      final before = await repo.getTask('mock-task-1');

      final updated = await repo.updateStatus(
        'mock-task-1',
        TaskStatus.completed,
      );
      expect(updated.status, TaskStatus.completed);
      expect(updated.updatedAt.isAfter(before.updatedAt), isTrue);

      final reread = await repo.getTask('mock-task-1');
      expect(reread.status, TaskStatus.completed);
    });

    test('updateStatus throws 404 for an unknown id', () async {
      final repo = MockTaskRepository();
      await expectLater(
        repo.updateStatus('nope', TaskStatus.pending),
        throwsA(
          isA<ApiException>().having((e) => e.statusCode, 'statusCode', 404),
        ),
      );
    });
  });

  // CachedApiTaskRepository against a real in-memory Drift DB (not a mocked
  // TaskDao) so the assertions check what actually landed in / came out of
  // the cache table, not just that a DAO method was called.
  group('CachedApiTaskRepository', () {
    late AppDatabase db;

    setUp(() => db = AppDatabase.forTesting(NativeDatabase.memory()));
    tearDown(() => db.close());

    late SyncQueueService sync;

    CachedApiTaskRepository repoWith(_FakeApiClient api) {
      sync = SyncQueueService(api, db.pendingActionDao, db.taskDao);
      return CachedApiTaskRepository(
        api,
        db.taskDao,
        db.pendingActionDao,
        sync,
      );
    }

    test('API สำเร็จ -> listTasks()/getTask() เขียนลง cache', () async {
      final api = _FakeApiClient(tasks: [_task('a'), _task('b')]);
      final repo = repoWith(api);

      expect((await repo.listTasks()).map((t) => t.id), ['a', 'b']);
      expect((await db.taskDao.getAllTasks()).map((r) => r.id).toSet(), {
        'a',
        'b',
      });

      api.tasks = [_task('c')];
      expect((await repo.getTask('c')).id, 'c');
      expect(await db.taskDao.getTaskById('c'), isNotNull);
    });

    test(
      'API throw ApiException + มี cache -> คืนจาก cache ไม่ throw',
      () async {
        final api = _FakeApiClient(tasks: [_task('a'), _task('b')]);
        final repo = repoWith(api);
        await repo.listTasks(); // prime the cache

        api.error = ApiException('timeout', statusCode: 503);

        expect((await repo.listTasks()).map((t) => t.id).toSet(), {'a', 'b'});
        expect((await repo.getTask('a')).title, 'งาน a');
      },
    );

    test(
      'API throw ApiException + cache ว่าง -> rethrow ApiException',
      () async {
        final repo = repoWith(
          _FakeApiClient(error: ApiException('offline', statusCode: 503)),
        );

        await expectLater(repo.listTasks(), throwsA(isA<ApiException>()));
        await expectLater(repo.getTask('a'), throwsA(isA<ApiException>()));
      },
    );

    test(
      'error ที่ไม่ใช่ ApiException (เช่น bug) -> ไม่ fallback cache',
      () async {
        final api = _FakeApiClient(tasks: [_task('a')]);
        final repo = repoWith(api);
        await repo.listTasks(); // cache is non-empty

        api.error = StateError('mapping bug');

        await expectLater(repo.listTasks(), throwsA(isA<StateError>()));
        await expectLater(repo.getTask('a'), throwsA(isA<StateError>()));
      },
    );

    test('updateStatus -> คืนค่า optimistic ทันที แล้ว flush ส่งขึ้น server '
        'และ cache ถูกอัปเดต', () async {
      final api = _FakeApiClient(tasks: [_task('a')]);
      final repo = repoWith(api);
      await repo.listTasks();
      expect((await db.taskDao.getTaskById('a'))!.status, 'pending');

      final updated = await repo.updateStatus('a', TaskStatus.inProgress);
      expect(updated.status, TaskStatus.inProgress);

      await sync.flush();

      expect(
        (await db.taskDao.getTaskById('a'))!.status,
        TaskStatus.inProgress.wireName,
      );
      expect(await db.pendingActionDao.getPending(), isEmpty);
    });

    test('ออฟไลน์: updateStatus ไม่ throw, listTasks/getTask เห็นค่าที่แก้ '
        'และ refresh ไม่เด้งกลับเป็นค่า server', () async {
      final api = _FakeApiClient(tasks: [_task('a')]);
      final repo = repoWith(api);
      await repo.listTasks();

      api.error = ApiException('offline'); // no statusCode = no network
      final updated = await repo.updateStatus('a', TaskStatus.inProgress);
      await sync.flush(); // fails with network error, stays queued

      expect(updated.status, TaskStatus.inProgress);
      expect(await db.pendingActionDao.getPending(), hasLength(1));
      // offline read (cache + overlay)
      expect((await repo.listTasks()).single.status, TaskStatus.inProgress);
      expect((await repo.getTask('a')).status, TaskStatus.inProgress);

      // back online but the server still returns the OLD status for the list
      // (the queue hasn't been flushed yet) — the overlay must win
      api.error = null;
      api.holdUpdates = true;
      expect((await repo.listTasks()).single.status, TaskStatus.inProgress);
      expect((await repo.getTask('a')).status, TaskStatus.inProgress);
    });

    test('หลาย update ซ้อนกัน -> overlay ใช้ค่าล่าสุด', () async {
      final api = _FakeApiClient(tasks: [_task('a')])
        ..error = ApiException('offline');
      final repo = repoWith(api);
      api.error = null;
      await repo.listTasks();
      api.error = ApiException('offline');

      await repo.updateStatus('a', TaskStatus.inProgress);
      await repo.updateStatus('a', TaskStatus.completed);

      expect((await repo.getTask('a')).status, TaskStatus.completed);
    });

    test('updateStatus ของ task ที่ไม่เคย cache -> ApiException', () async {
      final repo = repoWith(_FakeApiClient());
      await expectLater(
        repo.updateStatus('ghost', TaskStatus.completed),
        throwsA(isA<ApiException>()),
      );
    });
  });
}
