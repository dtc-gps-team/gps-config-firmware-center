import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/config/app_config.dart';
import 'package:mobile/features/task/task_repository.dart';

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
