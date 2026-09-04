import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/auth/auth_controller.dart'; // apiClientProvider
import '../../core/config/app_config.dart';

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

/// Talks to the real backend. Default outside `API_MOCK_MODE` — the Task
/// endpoints are live on `main`.
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

/// In-memory fake for `API_MOCK_MODE` (dev without a backend). Mirrors the
/// same-file pattern used by `MockAuthRepository`.
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
      dueDate: current.dueDate,
    );
    _tasks[index] = updated;
    return updated;
  }
}

final taskRepositoryProvider = Provider<TaskRepository>((ref) {
  if (AppConfig.apiMockMode) return MockTaskRepository();
  return ApiTaskRepository(ref.watch(apiClientProvider));
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
