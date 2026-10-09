import 'package:drift/drift.dart';
import 'package:drift_flutter/drift_flutter.dart';

import 'daos/pending_action_dao.dart';
import 'daos/task_dao.dart';
import 'tables/pending_actions_table.dart';
import 'tables/tasks_table.dart';

part 'app_database.g.dart';

/// The app's one local database (Offline-first).
///
/// - `Tasks` — field-staff task cache, filled API → here by
///   `CachedApiTaskRepository` (`features/task/task_repository.dart`). Always
///   holds the last value the **server** confirmed.
/// - `PendingActions` (v2) — local write queue of changes not yet confirmed
///   by the server, drained by `SyncQueueService` (`core/sync/`).
@DriftDatabase(
  tables: [Tasks, PendingActions],
  daos: [TaskDao, PendingActionDao],
)
class AppDatabase extends _$AppDatabase {
  AppDatabase() : super(_openConnection());

  /// Lets tests inject an in-memory executor (`NativeDatabase.memory()`) —
  /// the default constructor needs `path_provider`, i.e. a Flutter binding.
  AppDatabase.forTesting(super.executor);

  /// Bump this whenever `tables` changes shape and add the matching
  /// `onUpgrade` step in `migration`.
  ///
  /// v1 → v2 (Sprint 3 Offline-first Sync): adds `PendingActions`, the local
  /// write queue. Additive only — `Tasks` is untouched.
  @override
  int get schemaVersion => 2;

  @override
  MigrationStrategy get migration => MigrationStrategy(
    onCreate: (m) => m.createAll(),
    onUpgrade: (m, from, to) async {
      if (from < 2) {
        await m.createTable(pendingActions);
      }
    },
  );

  /// Wipes every row of every table — called on logout so the next person to
  /// sign in on this device never sees the previous user's cached tasks (or,
  /// from schema v2, their still-unsynced pending actions).
  Future<void> clearAllUserData() => transaction(() async {
    for (final table in allTables) {
      await delete(table).go();
    }
  });

  static QueryExecutor _openConnection() {
    return driftDatabase(name: 'gps_mobile_db');
  }
}
