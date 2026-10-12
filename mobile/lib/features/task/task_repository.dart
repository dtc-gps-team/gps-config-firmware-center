import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/auth/auth_controller.dart'; // apiClientProvider
import '../../core/config/app_config.dart';
import '../../core/db/daos/pending_action_dao.dart';
import '../../core/db/daos/task_dao.dart';
import '../../core/db/providers/database_provider.dart';
import '../../core/db/tables/pending_actions_table.dart';
import '../../core/db/task_mapping.dart';
import '../../core/sync/sync_providers.dart';
import '../../core/sync/sync_queue_service.dart';

/// Reads and updates field-staff tasks.
///
/// `GET /tasks` is self-scoped to the caller by the backend for ST/OT, and
/// `PATCH /tasks/{id}` lets ST/OT change only `status` on their own tasks —
/// this repository never re-implements that scoping on the client.
abstract class TaskRepository {
  Future<List<Task>> listTasks();
  Future<Task> getTask(String id);
  Future<Task> updateStatus(String id, TaskStatus status);
}

/// Talks to the real backend only, no local cache. Kept for tests that want
/// to exercise the network path in isolation; the app itself is wired to
/// [CachedApiTaskRepository] below (see `taskRepositoryProvider`).
class ApiTaskRepository implements TaskRepository {
  ApiTaskRepository(this._api);

  final ApiClient _api;

  @override
  Future<List<Task>> listTasks() => _api.listTasks();

  @override
  Future<Task> getTask(String id) => _api.getTask(id);

  @override
  Future<Task> updateStatus(String id, TaskStatus status) =>
      _api.updateTaskStatus(id, status);
}

/// Reads through the local `Tasks` cache and writes through the sync queue.
///
/// Reads: a successful API call replaces the cache; a failed one (offline,
/// timeout, 5xx) falls back to whatever is cached, so the screens still show
/// the last-known data. The cache always holds what the **server** last
/// confirmed.
///
/// Writes ([updateStatus]): the change is queued locally (`PendingActions`) and
/// sent by [SyncQueueService] as soon as the network allows — it never waits
/// for, or fails because of, the network. Every read overlays the still-queued
/// changes on top of the cached/server value, so the user sees their own change
/// immediately and a refresh can't bounce it back. When the server rejects a
/// queued change (4xx) it leaves the queue and the overlay disappears: server
/// wins (see [SyncQueueService]).
class CachedApiTaskRepository implements TaskRepository {
  CachedApiTaskRepository(this._api, this._dao, this._queue, this._sync);

  final ApiClient _api;
  final TaskDao _dao;
  final PendingActionDao _queue;
  final SyncQueueService _sync;

  @override
  Future<List<Task>> listTasks() async {
    List<Task> tasks;
    try {
      tasks = await _api.listTasks();
      await _dao.upsertTasks(tasks.map(taskToCompanion).toList());
    } on ApiException {
      final cached = await _dao.getAllTasks();
      if (cached.isEmpty) rethrow;
      tasks = cached.map(taskFromRow).toList();
    }
    final overlay = await _pendingStatuses();
    return tasks.map((t) => _withPending(t, overlay)).toList();
  }

  @override
  Future<Task> getTask(String id) async {
    Task task;
    try {
      task = await _api.getTask(id);
      await _dao.upsertTask(taskToCompanion(task));
    } on ApiException {
      final cached = await _dao.getTaskById(id);
      if (cached == null) rethrow;
      task = taskFromRow(cached);
    }
    return _withPending(task, await _pendingStatuses());
  }

  @override
  Future<Task> updateStatus(String id, TaskStatus status) async {
    final cached = await _dao.getTaskById(id);
    if (cached == null) {
      // Never seen this task locally (so we can't show an optimistic copy or
      // know its assignee) — only the server can answer.
      throw ApiException('ไม่พบงานนี้ในเครื่อง กรุณาเปิดรายการงานก่อน');
    }
    await _sync.enqueueTaskStatus(
      taskId: id,
      userId: cached.assignedTo,
      status: status,
    );
    return _withPending(taskFromRow(cached), {id: status});
  }

  /// taskId → status of the newest queued change for it.
  Future<Map<String, TaskStatus>> _pendingStatuses() async {
    final overlay = <String, TaskStatus>{};
    for (final a in await _queue.getPending()) {
      if (a.type != PendingActionType.taskStatus.wireName) continue;
      final payload = jsonDecode(a.payload) as Map<String, dynamic>;
      // getPending() is oldest-first, so later entries win.
      overlay[a.entityId] = TaskStatus.fromWire(payload['status'] as String);
    }
    return overlay;
  }

  Task _withPending(Task task, Map<String, TaskStatus> overlay) {
    final status = overlay[task.id];
    if (status == null) return task;
    return Task(
      id: task.id,
      title: task.title,
      assignedTo: task.assignedTo,
      status: status,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      description: task.description,
      deviceId: task.deviceId,
      configId: task.configId,
      dueDate: task.dueDate,
    );
  }
}

/// In-memory fake for `API_MOCK_MODE` (dev without a backend). Mirrors the
/// same-file pattern used by `MockAuthRepository`. Deliberately NOT routed
/// through the local DB — mock mode should stay disposable/stateless across
/// hot restarts, same as before.
class MockTaskRepository implements TaskRepository {
  final List<Task> _tasks = [
    Task(
      id: 'mock-task-1',
      title: 'ติดตั้งกล่อง GPS รถบรรทุก',
      assignedTo: 'mock-user',
      status: TaskStatus.pending,
      createdAt: DateTime(2026, 9, 1, 8),
      updatedAt: DateTime(2026, 9, 1, 8),
      description: 'ติดตั้งและตั้งค่ากล่องใหม่ที่ศูนย์กระจายสินค้า',
      deviceId: 'DVC-40271',
    ),
    Task(
      id: 'mock-task-2',
      title: 'ตรวจเช็คสัญญาณรถโดยสาร',
      assignedTo: 'mock-user',
      status: TaskStatus.inProgress,
      createdAt: DateTime(2026, 9, 2, 9),
      updatedAt: DateTime(2026, 9, 2, 9),
      deviceId: 'DVC-39118',
    ),
    Task(
      id: 'mock-task-3',
      title: 'เปลี่ยนซิมการ์ดอุปกรณ์',
      assignedTo: 'mock-user',
      status: TaskStatus.completed,
      createdAt: DateTime(2026, 8, 30, 14),
      updatedAt: DateTime(2026, 8, 31, 10),
      deviceId: 'DVC-38004',
    ),
  ];

  @override
  Future<List<Task>> listTasks() async {
    await Future<void>.delayed(const Duration(milliseconds: 300));
    return List.unmodifiable(_tasks);
  }

  @override
  Future<Task> getTask(String id) async {
    await Future<void>.delayed(const Duration(milliseconds: 200));
    final match = _tasks.where((t) => t.id == id);
    if (match.isEmpty) {
      throw ApiException('ไม่พบงานนี้', statusCode: 404);
    }
    return match.first;
  }

  @override
  Future<Task> updateStatus(String id, TaskStatus status) async {
    await Future<void>.delayed(const Duration(milliseconds: 200));
    final index = _tasks.indexWhere((t) => t.id == id);
    if (index == -1) {
      throw ApiException('ไม่พบงานนี้', statusCode: 404);
    }
    final current = _tasks[index];
    final updated = Task(
      id: current.id,
      title: current.title,
      assignedTo: current.assignedTo,
      status: status,
      createdAt: current.createdAt,
      updatedAt: DateTime.now(),
      description: current.description,
      deviceId: current.deviceId,
      configId: current.configId,
      dueDate: current.dueDate,
    );
    _tasks[index] = updated;
    return updated;
  }
}

final taskRepositoryProvider = Provider<TaskRepository>((ref) {
  if (AppConfig.apiMockMode) return MockTaskRepository();
  return CachedApiTaskRepository(
    ref.watch(apiClientProvider),
    ref.watch(taskDaoProvider),
    ref.watch(pendingActionDaoProvider),
    ref.watch(syncQueueServiceProvider),
  );
});

/// The signed-in user's task list.
///
/// `GET /tasks` is only self-scoped by the backend for ST/OT — every other role
/// (and an unknown/unrestored one) would receive every task in the system. This
/// is a field-staff app, so for anyone else we return an empty list and never
/// hit the network. The Home UI also hides the "งานวันนี้" section for them.
final taskListProvider = FutureProvider.autoDispose<List<Task>>((ref) {
  ref.watch(syncRevisionProvider); // re-read after a sync flush
  final role = ref.watch(authControllerProvider.select((s) => s.role));
  if (role != UserRole.st && role != UserRole.ot) {
    return const <Task>[];
  }
  return ref.watch(taskRepositoryProvider).listTasks();
});

/// One task by id, for the detail screen.
final taskDetailProvider = FutureProvider.autoDispose.family<Task, String>((
  ref,
  id,
) {
  ref.watch(syncRevisionProvider); // re-read after a sync flush
  return ref.watch(taskRepositoryProvider).getTask(id);
});
