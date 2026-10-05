import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app_database.dart';
import '../daos/task_dao.dart';

/// One [AppDatabase] for the app's lifetime — same "live for the whole
/// provider container" lifetime as `apiClientProvider`
/// (`core/auth/auth_controller.dart`). Closed on dispose so tests that
/// override this provider don't leak native DB handles between cases.
final appDatabaseProvider = Provider<AppDatabase>((ref) {
  final db = AppDatabase();
  ref.onDispose(db.close);
  return db;
});

final taskDaoProvider = Provider<TaskDao>((ref) {
  return ref.watch(appDatabaseProvider).taskDao;
});
