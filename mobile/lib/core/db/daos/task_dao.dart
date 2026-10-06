import 'package:drift/drift.dart';

import '../app_database.dart';
import '../tables/tasks_table.dart';

part 'task_dao.g.dart';

/// Local CRUD for the `Tasks` cache table. Knows nothing about the API or
/// `Task` (the domain model in `core/api/models.dart`) — mapping between the
/// two happens in `CachedApiTaskRepository`
/// (`features/task/task_repository.dart`), same separation the rest of the
/// app keeps between `core/api` and `features/*`.
@DriftAccessor(tables: [Tasks])
class TaskDao extends DatabaseAccessor<AppDatabase> with _$TaskDaoMixin {
  TaskDao(super.db);

  Future<List<TaskRow>> getAllTasks() => select(tasks).get();

  Future<TaskRow?> getTaskById(String id) =>
      (select(tasks)..where((t) => t.id.equals(id))).getSingleOrNull();

  /// Live, for a future watch-the-list screen — not wired up yet in Sprint 2.
  Stream<List<TaskRow>> watchAllTasks() => select(tasks).watch();

  Future<void> upsertTask(TasksCompanion entry) =>
      into(tasks).insertOnConflictUpdate(entry);

  Future<void> upsertTasks(List<TasksCompanion> entries) =>
      batch((b) => b.insertAllOnConflictUpdate(tasks, entries));

  Future<void> deleteTask(String id) =>
      (delete(tasks)..where((t) => t.id.equals(id))).go();

  Future<void> clearAll() => delete(tasks).go();
}
