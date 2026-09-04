import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/auth/auth_controller.dart';
import 'package:mobile/core/config/app_config.dart';
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

void main() {
  group('taskRepositoryProvider', () {
    test('picks the implementation from API_MOCK_MODE', () {
      final container = ProviderContainer();
      addTearDown(container.dispose);

      final repo = container.read(taskRepositoryProvider);
      if (AppConfig.apiMockMode) {
        expect(repo, isA<MockTaskRepository>());
      } else {
        expect(repo, isA<ApiTaskRepository>());
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

    for (final role in [
      UserRole.sw,
      UserRole.operation,
      UserRole.admin,
      null,
    ]) {
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
}
