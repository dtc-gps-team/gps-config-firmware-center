import 'dart:async';
import 'dart:convert';

import 'package:uuid/uuid.dart';

import '../api/api_client.dart';
import '../api/models.dart';
import '../db/app_database.dart';
import '../db/daos/pending_action_dao.dart';
import '../db/daos/task_dao.dart';
import '../db/tables/pending_actions_table.dart';
import '../db/task_mapping.dart';

/// Local write queue + sender (Sprint 3 "Offline-first Sync").
///
/// A user change is stored in `PendingActions` ([enqueueTaskStatus]) and sent
/// to the backend by [flush], oldest first. Flush is triggered by
/// `SyncTriggers` (app resume, connectivity back online) and right after each
/// enqueue.
///
/// Conflict policy — **server wins**, deliberately simple:
/// - success → the action is deleted and the server's answer replaces the
///   cached row;
/// - network failure / timeout / 5xx / 401 / 408 / 429 (no verdict from the
///   server) → stop, keep everything queued for the next trigger;
/// - any other 4xx → the server rejected the change: the action is marked
///   `failed` (never retried), later queued actions for the same entity are
///   failed with it (they were built on the rejected change), and the cache is
///   refreshed from the server so the UI falls back to the server's value.
///   The UI shows the failed actions until the user dismisses them.
class SyncQueueService {
  SyncQueueService(this._api, this._queue, this._tasks, {Uuid? uuid})
    : _uuid = uuid ?? const Uuid();

  final ApiClient _api;
  final PendingActionDao _queue;
  final TaskDao _tasks;
  final Uuid _uuid;

  Future<void>? _inFlight;
  bool _flushAgain = false;

  /// Fired after a flush changed the queue or the cache, so providers
  /// backed by them can refresh. Set once by the provider.
  void Function()? onChanged;

  /// Queues "set task [taskId] to [status]". [userId] is the task's assignee.
  Future<void> enqueueTaskStatus({
    required String taskId,
    required String userId,
    required TaskStatus status,
  }) async {
    await _queue.insertAction(
      PendingActionsCompanion.insert(
        id: _uuid.v4(),
        userId: userId,
        type: PendingActionType.taskStatus.wireName,
        entityId: taskId,
        payload: jsonEncode({'status': status.wireName}),
        createdAt: DateTime.now(),
      ),
    );
    unawaited(flush());
  }

  /// Sends queued actions oldest-first. Safe to call from anywhere, any
  /// number of times: a call made while a flush is running asks it for one
  /// more pass and returns the same in-flight future instead of running
  /// concurrently. Never throws.
  Future<void> flush() {
    final running = _inFlight;
    if (running != null) {
      _flushAgain = true;
      return running;
    }
    return _inFlight = _run();
  }

  Future<void> _run() async {
    try {
      do {
        _flushAgain = false;
        await _drain();
      } while (_flushAgain);
    } catch (_) {
      // Local DB trouble must not surface as an unhandled async error from a
      // fire-and-forget trigger; the actions stay queued for the next run.
    } finally {
      _inFlight = null;
    }
  }

  Future<void> _drain() async {
    var changed = false;
    try {
      for (final action in await _queue.getPending()) {
        // A previous failure in this pass may have failed this action too.
        if (!await _stillPending(action.id)) continue;
        final outcome = await _send(action);
        switch (outcome) {
          case _Outcome.sent:
            changed = true;
          case _Outcome.rejected:
            changed = true;
          case _Outcome.retryLater:
            return;
        }
      }
    } finally {
      if (changed) onChanged?.call();
    }
  }

  Future<bool> _stillPending(String id) async =>
      (await _queue.getPending()).any((a) => a.id == id);

  Future<_Outcome> _send(PendingActionRow action) async {
    try {
      final task = await _dispatch(action);
      await _tasks.upsertTask(taskToCompanion(task));
      await _queue.deleteAction(action.id);
      return _Outcome.sent;
    } on ApiException catch (e) {
      if (_isTransient(e)) {
        await _queue.recordAttempt(action.id, e.message);
        return _Outcome.retryLater;
      }
      await _reject(action, e);
      return _Outcome.rejected;
    }
  }

  Future<Task> _dispatch(PendingActionRow action) {
    final payload = jsonDecode(action.payload) as Map<String, dynamic>;
    if (action.type == PendingActionType.taskStatus.wireName) {
      return _api.updateTaskStatus(
        action.entityId,
        TaskStatus.fromWire(payload['status'] as String),
      );
    }
    throw ApiException('ไม่รู้จักประเภทรายการ ${action.type}', statusCode: 400);
  }

  /// No HTTP verdict yet (transport error) or a status that says "try again /
  /// sign in again" rather than "this change is wrong".
  static bool _isTransient(ApiException e) {
    final code = e.statusCode;
    if (code == null) return true;
    return code >= 500 || code == 401 || code == 408 || code == 429;
  }

  Future<void> _reject(PendingActionRow action, ApiException e) async {
    await _queue.markFailed(action.id, e.message);
    final followers = await _queue.getPendingForEntity(
      action.type,
      action.entityId,
    );
    for (final f in followers) {
      await _queue.markFailed(f.id, 'ยกเลิก เพราะรายการก่อนหน้าไม่สำเร็จ');
    }
    // Server wins: pull the server's current value into the cache. Best
    // effort — if it also fails the cache keeps the last confirmed value.
    try {
      if (action.type == PendingActionType.taskStatus.wireName) {
        final fresh = await _api.getTask(action.entityId);
        await _tasks.upsertTask(taskToCompanion(fresh));
      }
    } on ApiException {
      // ignore
    }
  }
}

enum _Outcome { sent, rejected, retryLater }
