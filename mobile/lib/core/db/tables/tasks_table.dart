import 'package:drift/drift.dart';

/// Locally cached `Task` rows — the read side of the Task offline-first
/// cache (Sprint 2: "เริ่มโครง Offline-first (Drift) ยังไม่ต้อง sync จริง").
///
/// Mirrors `core/api/models.dart`'s `Task` shape. `status` is stored as its
/// wire name (see `TaskStatus.wireName`) so decoding stays in one place
/// (`core/api/models.dart`) instead of being duplicated here.
@DataClassName('TaskRow')
class Tasks extends Table {
  TextColumn get id => text()();
  TextColumn get title => text()();

  /// user id of the assignee — mirrors `Task.assignedTo`.
  TextColumn get assignedTo => text()();

  /// `TaskStatus.wireName` (`pending` / `in_progress` / `completed` /
  /// `cancelled`) — convert with `TaskStatus.fromWire` / `.wireName`.
  TextColumn get status => text()();
  DateTimeColumn get createdAt => dateTime()();
  DateTimeColumn get updatedAt => dateTime()();
  TextColumn get description => text().nullable()();
  TextColumn get deviceId => text().nullable()();
  TextColumn get configId => text().nullable()();
  DateTimeColumn get dueDate => dateTime().nullable()();

  /// 'synced' until local writes exist (the Sprint 3+ sync queue). Not
  /// surfaced to the UI yet — reserved now so this column doesn't need a
  /// migration later when the queue lands.
  TextColumn get syncStatus => text().withDefault(const Constant('synced'))();

  @override
  Set<Column> get primaryKey => {id};
}
