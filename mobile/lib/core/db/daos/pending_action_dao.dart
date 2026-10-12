import 'package:drift/drift.dart';

import '../app_database.dart';
import '../tables/pending_actions_table.dart';

part 'pending_action_dao.g.dart';

/// Local CRUD for the `PendingActions` queue. Like `TaskDao`, it knows
/// nothing about the API — `SyncQueueService` owns the send/retry logic.
@DriftAccessor(tables: [PendingActions])
class PendingActionDao extends DatabaseAccessor<AppDatabase>
    with _$PendingActionDaoMixin {
  PendingActionDao(super.db);

  /// `createdAt` is stored with 1-second resolution, so two taps in the same
  /// second tie — SQLite's insertion-ordered `rowid` keeps them in the order
  /// the user made them.
  static final List<OrderClauseGenerator<$PendingActionsTable>> _oldestFirst = [
    (a) => OrderingTerm.asc(a.createdAt),
    (a) => OrderingTerm.asc(const CustomExpression<int>('rowid')),
  ];

  /// Rows still in the queue, `pending` and `failed` alike — everything a
  /// logout would throw away.
  Future<int> countUnsynced() async {
    final count = pendingActions.id.count();
    final query = selectOnly(pendingActions)..addColumns([count]);
    return (await query.getSingle()).read(count) ?? 0;
  }

  Future<void> insertAction(PendingActionsCompanion entry) =>
      into(pendingActions).insert(entry);

  /// Actions still waiting to be sent, oldest first.
  Future<List<PendingActionRow>> getPending() =>
      (select(pendingActions)
            ..where((a) => a.status.equals(PendingActionStatus.pending))
            ..orderBy(_oldestFirst))
          .get();

  Future<List<PendingActionRow>> getPendingForEntity(
    String type,
    String entityId,
  ) =>
      (select(pendingActions)
            ..where(
              (a) =>
                  a.status.equals(PendingActionStatus.pending) &
                  a.type.equals(type) &
                  a.entityId.equals(entityId),
            )
            ..orderBy(_oldestFirst))
          .get();

  Stream<List<PendingActionRow>> watchPending() =>
      (select(pendingActions)
            ..where((a) => a.status.equals(PendingActionStatus.pending))
            ..orderBy(_oldestFirst))
          .watch();

  Stream<List<PendingActionRow>> watchFailed() =>
      (select(pendingActions)
            ..where((a) => a.status.equals(PendingActionStatus.failed))
            ..orderBy(_oldestFirst))
          .watch();

  Future<List<PendingActionRow>> getFailed() => (select(
    pendingActions,
  )..where((a) => a.status.equals(PendingActionStatus.failed))).get();

  /// Counts one more send attempt, remembering why it didn't finish.
  Future<void> recordAttempt(String id, String? error) => customUpdate(
    'UPDATE pending_actions SET attempts = attempts + 1, last_error = ? '
    'WHERE id = ?',
    variables: [Variable<String>(error), Variable<String>(id)],
    updates: {pendingActions},
  );

  Future<void> markFailed(String id, String error) =>
      (update(pendingActions)..where((a) => a.id.equals(id))).write(
        PendingActionsCompanion(
          status: const Value(PendingActionStatus.failed),
          lastError: Value(error),
        ),
      );

  Future<void> deleteAction(String id) =>
      (delete(pendingActions)..where((a) => a.id.equals(id))).go();

  /// Dismisses every failed action (the user has seen the notice).
  Future<void> deleteFailed() => (delete(
    pendingActions,
  )..where((a) => a.status.equals(PendingActionStatus.failed))).go();
}
