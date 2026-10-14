import 'package:drift/drift.dart';

import '../app_database.dart';
import '../tables/task_events_table.dart';

part 'task_event_dao.g.dart';

/// Local cache of task timelines (issue #296). Knows nothing about the API —
/// mapping happens in `CachedApiTaskEventRepository`
/// (`features/task/task_event_repository.dart`), same split as [TaskDao].
@DriftAccessor(tables: [TaskEvents])
class TaskEventDao extends DatabaseAccessor<AppDatabase>
    with _$TaskEventDaoMixin {
  TaskEventDao(super.db);

  /// Oldest first — the order the timeline is shown in.
  Future<List<TaskEventRow>> getEventsByTaskId(String taskId) =>
      (select(taskEvents)
            ..where((e) => e.taskId.equals(taskId))
            ..orderBy([(e) => OrderingTerm.asc(e.changedAt)]))
          .get();

  /// Replaces the cached timeline of [taskId] with [entries] — the server's
  /// list is the whole truth for that task (events are append-only, but this
  /// also drops anything the cache had that the server no longer returns).
  Future<void> replaceEventsForTask(
    String taskId,
    List<TaskEventsCompanion> entries,
  ) => transaction(() async {
    await (delete(taskEvents)..where((e) => e.taskId.equals(taskId))).go();
    await batch((b) => b.insertAllOnConflictUpdate(taskEvents, entries));
  });

  Future<void> upsertEvent(TaskEventsCompanion entry) =>
      into(taskEvents).insertOnConflictUpdate(entry);
}
