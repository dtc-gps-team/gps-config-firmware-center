import 'package:drift/drift.dart' show Value;
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/auth/auth_controller.dart'; // apiClientProvider
import '../../core/config/app_config.dart';
// TaskRow and TasksCompanion are drift-generated into app_database.g.dart,
// which app_database.dart re-exports via its `part` directive.
import '../../core/db/app_database.dart' show TaskRow, TasksCompanion;
import '../../core/db/daos/task_dao.dart';
import '../../core/db/providers/database_provider.dart';

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

/// Reads through the local `Tasks` cache: a successful API call replaces
/// the cache and is returned as-is; a failed one (offline, timeout, 5xx)
/// falls back to whatever is cached so the list/detail screens still show
/// the last-known data instead of an error state.
///
/// Sprint 2 scope only — "เริ่มโครง Offline-first ยังไม่ต้อง sync จริง": there is
/// no local write queue yet, so [updateStatus] still requires the network;
/// it just refreshes the cache once the API confirms the change.
class CachedApiTaskRepository implements TaskRepository {
  CachedApiTaskRepository(this._api, this._dao);

  final ApiClient _api;
  final TaskDao _dao;

  @override
  Future<List<Task>> listTasks() async {
    try {
      final tasks = await _api.listTasks();
      await _dao.upsertTasks(tasks.map(_toCompanion).toList());
      return tasks;
    } on ApiException {
      final cached = await _dao.getAllTasks();
      if (cached.isEmpty) rethrow;
      return cached.map(_fromRow).toList();
    }
  }

  @override
  Future<Task> getTask(String id) async {
    try {
      final task = await _api.getTask(id);
      await _dao.upsertTask(_toCompanion(task));
      return task;
    } on ApiException {
      final cached = await _dao.getTaskById(id);
      if (cached == null) rethrow;
      return _fromRow(cached);
    }
  }

  @override
  Future<Task> updateStatus(String id, TaskStatus status) async {
    final task = await _api.updateTaskStatus(id, status);
    await _dao.upsertTask(_toCompanion(task));
    return task;
  }
}

TasksCompanion _toCompanion(Task task) => TasksCompanion.insert(
  id: task.id,
  title: task.title,
  assignedTo: task.assignedTo,
  status: task.status.wireName,
  createdAt: task.createdAt,
  updatedAt: task.updatedAt,
  description: Value(task.description),
  deviceId: Value(task.deviceId),
  configId: Value(task.configId),
  dueDate: Value(task.dueDate),
);

Task _fromRow(TaskRow row) => Task(
  id: row.id,
  title: row.title,
  assignedTo: row.assignedTo,
  status: TaskStatus.fromWire(row.status),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  description: row.description,
  deviceId: row.deviceId,
  configId: row.configId,
  dueDate: row.dueDate,
);

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
  );
});

/// The signed-in user's task list.
///
/// `GET /tasks` is only self-scoped by the backend for ST/OT — every other role
/// (and an unknown/unrestored one) would receive every task in the system. This
/// is a field-staff app, so for anyone else we return an empty list and never
/// hit the network. The Home UI also hides the "งานวันนี้" section for them.
final taskListProvider = FutureProvider.autoDispose<List<Task>>((ref) {
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
  return ref.watch(taskRepositoryProvider).getTask(id);
});
