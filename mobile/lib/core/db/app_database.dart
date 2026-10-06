import 'package:drift/drift.dart';
import 'package:drift_flutter/drift_flutter.dart';

import 'daos/task_dao.dart';
import 'tables/tasks_table.dart';

part 'app_database.g.dart';

/// The app's one local database (Offline-first skeleton, Sprint 2).
///
/// Holds a single table so far — `Tasks`, the field-staff task cache (see
/// `tables/tasks_table.dart`). Data flows one way for now, API → here, via
/// `CachedApiTaskRepository` in `features/task/task_repository.dart`; there
/// is no local write queue yet (that's a later sprint, once the task's
/// "sync จริง" scope is picked up).
@DriftDatabase(tables: [Tasks], daos: [TaskDao])
class AppDatabase extends _$AppDatabase {
  AppDatabase() : super(_openConnection());

  /// Lets tests inject an in-memory executor (`NativeDatabase.memory()`) —
  /// the default constructor needs `path_provider`, i.e. a Flutter binding.
  AppDatabase.forTesting(super.executor);

  /// Bump this whenever `tables` changes shape and add the matching
  /// `onUpgrade` step in `migration` — still 1, nothing has shipped yet.
  @override
  int get schemaVersion => 1;

  static QueryExecutor _openConnection() {
    return driftDatabase(name: 'gps_mobile_db');
  }
}
