import 'package:mobile/core/api/models.dart';
import 'package:mobile/features/task/field_task_repository.dart';

/// ใช้แทน [FieldTaskRepository] ในเทส (docs/28) — คืนงาน `t-new` สถานะ
/// `in_progress` ของกล่องที่ขอ · [created] = false จำลองว่าได้งานเดิมกลับมา
class FakeFieldTaskRepository implements FieldTaskRepository {
  FakeFieldTaskRepository({this.created = true, this.error});

  bool created;
  Object? error;
  int startCalls = 0;
  String? lastDeviceId;

  @override
  Future<StartTaskResult> start(String deviceId, {String? note}) async {
    startCalls++;
    lastDeviceId = deviceId;
    final error = this.error;
    if (error != null) throw error;
    return StartTaskResult(
      created: created,
      task: Task(
        id: 't-new',
        title: '$deviceId — 26 ต.ค. 2569',
        assignedTo: 'tech-1',
        status: TaskStatus.inProgress,
        createdAt: DateTime.utc(2026, 10, 26, 3),
        updatedAt: DateTime.utc(2026, 10, 26, 3),
        deviceId: deviceId,
        source: TaskSource.technician,
      ),
    );
  }
}
