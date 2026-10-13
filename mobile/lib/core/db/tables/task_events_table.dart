import 'package:drift/drift.dart';

/// Locally cached task timeline rows (Task Event History, issue #296) — the
/// read side only, same as `Tasks`: filled API → here by
/// `CachedApiTaskEventRepository` and shown when the API can't be reached.
/// Nothing is written here locally first (notes need the network, docs/16 §7).
///
/// Mirrors `core/api/models.dart`'s `TaskEvent`. Statuses are stored as their
/// wire names, like `Tasks.status`.
///
/// Added in schema v3 (additive — no existing table changes).
@DataClassName('TaskEventRow')
class TaskEvents extends Table {
  TextColumn get id => text()();
  TextColumn get taskId => text()();

  /// `TaskStatus.wireName` or null (task-created event / note).
  TextColumn get fromStatus => text().nullable()();

  /// `TaskStatus.wireName`, or null when the row is a note.
  TextColumn get toStatus => text().nullable()();
  TextColumn get changedBy => text().nullable()();
  TextColumn get changedByName => text().nullable()();
  DateTimeColumn get changedAt => dateTime()();
  TextColumn get note => text().nullable()();

  @override
  Set<Column> get primaryKey => {id};
}
