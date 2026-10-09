import 'package:drift/drift.dart';

/// Local write queue (Sprint 3 "Offline-first Sync") — one row per change the
/// user made that the backend hasn't confirmed yet. Drained in `createdAt`
/// order by `SyncQueueService` (`core/sync/sync_queue_service.dart`).
///
/// Added in schema v2 (additive — no existing table changes).
@DataClassName('PendingActionRow')
class PendingActions extends Table {
  /// Client-generated uuid.
  TextColumn get id => text()();

  /// user id the change was made under (for a task: `Task.assignedTo`).
  /// Everything is wiped on logout, so this is a safety net rather than the
  /// primary isolation mechanism.
  TextColumn get userId => text()();

  /// [PendingActionType] wire name — kept as text so a new action type never
  /// needs a migration.
  TextColumn get type => text()();

  /// id of the entity the action targets (e.g. the task id).
  TextColumn get entityId => text()();

  /// JSON body of the action; shape depends on [type].
  TextColumn get payload => text()();

  /// `pending` (waiting to be sent) or `failed` (server rejected it with a
  /// 4xx; never retried — server wins, see `SyncQueueService`).
  TextColumn get status => text().withDefault(const Constant('pending'))();

  IntColumn get attempts => integer().withDefault(const Constant(0))();

  TextColumn get lastError => text().nullable()();

  DateTimeColumn get createdAt => dateTime()();

  @override
  Set<Column> get primaryKey => {id};
}

/// Values of `PendingActions.type`.
enum PendingActionType {
  /// `PATCH /tasks/{entityId}` — payload `{"status": "<TaskStatus.wireName>"}`.
  taskStatus('task_status');

  const PendingActionType(this.wireName);
  final String wireName;
}

/// Values of `PendingActions.status`.
abstract final class PendingActionStatus {
  static const pending = 'pending';
  static const failed = 'failed';
}
