import 'package:drift/drift.dart' show Value;
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/auth/auth_controller.dart'; // apiClientProvider
import '../../core/config/app_config.dart';
import '../../core/db/app_database.dart' show TaskEventRow, TaskEventsCompanion;
import '../../core/db/daos/task_event_dao.dart';
import '../../core/db/providers/database_provider.dart';
import '../../core/sync/sync_providers.dart';

/// Task Event History (issue #296, docs/16) — a task's timeline and its notes.
///
/// Kept separate from `TaskRepository` (docs/16 §5 suggested adding the
/// methods there) so the many hand-written `TaskRepository` fakes in tests
/// don't all need two more methods — same split as
/// `ConfirmInstallRepository`.
abstract class TaskEventRepository {
  /// Oldest first.
  Future<List<TaskEvent>> getEvents(String taskId);

  /// Text only (no photo — cut from this round's scope). Needs the network:
  /// throws [ApiException] when offline instead of queueing (docs/16 §7).
  Future<TaskEvent> addNote(String taskId, String note);
}

/// Reads through the local `TaskEvents` cache, like `CachedApiTaskRepository`
/// does for tasks: a successful call replaces that task's cached timeline, a
/// failed one (offline, timeout, 5xx) falls back to what's cached.
class CachedApiTaskEventRepository implements TaskEventRepository {
  CachedApiTaskEventRepository(this._api, this._dao);

  final ApiClient _api;
  final TaskEventDao _dao;

  @override
  Future<List<TaskEvent>> getEvents(String taskId) async {
    try {
      final events = await _api.listTaskEvents(taskId);
      await _dao.replaceEventsForTask(
        taskId,
        events.map(_toCompanion).toList(),
      );
      return events;
    } on ApiException catch (e) {
      // A real verdict like 404 (task gone / no longer ours) must not be
      // papered over with the cache — only "no answer from the server" falls
      // back (same transient set as `SyncQueueService`).
      if (!_noVerdict(e)) rethrow;
      final cached = await _dao.getEventsByTaskId(taskId);
      if (cached.isEmpty) rethrow;
      return cached.map(_fromRow).toList();
    }
  }

  @override
  Future<TaskEvent> addNote(String taskId, String note) async {
    final event = await _api.addTaskNote(taskId, note);
    await _dao.upsertEvent(_toCompanion(event));
    return event;
  }

  static bool _noVerdict(ApiException e) {
    final code = e.statusCode;
    if (code == null) return true;
    return code >= 500 || code == 401 || code == 408 || code == 429;
  }

  static TaskEventsCompanion _toCompanion(TaskEvent e) =>
      TaskEventsCompanion.insert(
        id: e.id,
        taskId: e.taskId,
        fromStatus: Value(e.fromStatus?.wireName),
        toStatus: Value(e.toStatus?.wireName),
        changedBy: Value(e.changedBy),
        changedByName: Value(e.changedByName),
        changedAt: e.changedAt,
        note: Value(e.note),
      );

  static TaskEvent _fromRow(TaskEventRow r) => TaskEvent(
    id: r.id,
    taskId: r.taskId,
    fromStatus: r.fromStatus == null
        ? null
        : TaskStatus.fromWire(r.fromStatus!),
    toStatus: r.toStatus == null ? null : TaskStatus.fromWire(r.toStatus!),
    changedBy: r.changedBy,
    changedByName: r.changedByName,
    changedAt: r.changedAt,
    note: r.note,
  );
}

/// In-memory fake for `API_MOCK_MODE`, matching `MockTaskRepository`'s three
/// tasks: each starts with its "task created" event.
class MockTaskEventRepository implements TaskEventRepository {
  final Map<String, List<TaskEvent>> _events = {
    for (final (id, at) in [
      ('mock-task-1', DateTime(2026, 9, 1, 8)),
      ('mock-task-2', DateTime(2026, 9, 2, 9)),
      ('mock-task-3', DateTime(2026, 8, 30, 14)),
    ])
      id: [
        TaskEvent(
          id: '$id-created',
          taskId: id,
          toStatus: TaskStatus.pending,
          changedBy: 'mock-operation',
          changedByName: 'Operation (mock)',
          changedAt: at,
        ),
      ],
  };
  int _seq = 0;

  @override
  Future<List<TaskEvent>> getEvents(String taskId) async {
    await Future<void>.delayed(const Duration(milliseconds: 200));
    return List.unmodifiable(_events[taskId] ?? const <TaskEvent>[]);
  }

  @override
  Future<TaskEvent> addNote(String taskId, String note) async {
    await Future<void>.delayed(const Duration(milliseconds: 200));
    final event = TaskEvent(
      id: 'mock-note-${_seq++}',
      taskId: taskId,
      changedBy: 'mock-user',
      changedByName: 'ผู้ใช้ (mock)',
      changedAt: DateTime.now(),
      note: note,
    );
    (_events[taskId] ??= []).add(event);
    return event;
  }
}

final taskEventRepositoryProvider = Provider<TaskEventRepository>((ref) {
  if (AppConfig.apiMockMode) return MockTaskEventRepository();
  return CachedApiTaskEventRepository(
    ref.watch(apiClientProvider),
    ref.watch(taskEventDaoProvider),
  );
});

/// One task's timeline, for the detail screen. Re-read after a sync flush so a
/// status change that was queued offline shows up once it reaches the server.
final taskEventsProvider = FutureProvider.autoDispose
    .family<List<TaskEvent>, String>((ref, taskId) {
      ref.watch(syncRevisionProvider);
      return ref.watch(taskEventRepositoryProvider).getEvents(taskId);
    });
