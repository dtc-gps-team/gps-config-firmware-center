import 'package:drift/drift.dart' show Value;

import '../api/models.dart';
import 'app_database.dart' show TaskRow, TasksCompanion;

/// `Task` (API model) → Drift row companion. Shared by the task repository
/// (read-through cache) and `SyncQueueService` (refresh after a send) — both
/// write data that just came from the server, so `cachedAt` = now
/// (UX audit #14: shown as "ข้อมูลเมื่อ HH:mm" when offline).
TasksCompanion taskToCompanion(Task task) => TasksCompanion.insert(
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
  cachedAt: Value(DateTime.now()),
);

Task taskFromRow(TaskRow row) => Task(
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
