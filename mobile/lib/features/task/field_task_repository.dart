import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/auth/auth_controller.dart'; // apiClientProvider
import 'task_repository.dart';

/// ช่างเริ่มงานกับกล่องเอง (docs/28 §5.1) — แยกจาก [TaskRepository] เพราะ
/// ต้องออนไลน์เสมอ (Task id มาจาก server) ไม่ผ่านคิว offline / cache แบบงานเดิม
abstract class FieldTaskRepository {
  Future<StartTaskResult> start(String deviceId, {String? note});
}

/// เรียก backend จริงเสมอไม่ว่า `API_MOCK_MODE` จะเป็นอะไร — แบบเดียวกับ
/// [ConfigApplyRequestRepository] (งานที่สร้างต้องมีจริงบน server)
class ApiFieldTaskRepository implements FieldTaskRepository {
  ApiFieldTaskRepository(this._api);

  final ApiClient _api;

  @override
  Future<StartTaskResult> start(String deviceId, {String? note}) =>
      _api.startTask(deviceId, note: note);
}

final fieldTaskRepositoryProvider = Provider<FieldTaskRepository>(
  (ref) => ApiFieldTaskRepository(ref.watch(apiClientProvider)),
);

/// งานที่ยังเปิดอยู่ (`pending`/`in_progress`) ของช่างกับกล่องนี้ — ปุ่ม "เริ่มงาน"
/// ในหน้ากล่องเปลี่ยนเป็น "ไปที่งาน" ถ้ามี · มาจากรายการงานของฉัน
/// ([taskListProvider]) · โหลดไม่ได้ = `null` (ปุ่มยังเป็น "เริ่มงาน" ซึ่ง backend
/// คืนงานเดิมให้อยู่แล้ว ไม่สร้างซ้ำ)
final openTaskForDeviceProvider = FutureProvider.autoDispose
    .family<Task?, String>((ref, deviceId) async {
      try {
        final tasks = await ref.watch(taskListProvider.future);
        for (final task in tasks) {
          if (task.deviceId == deviceId &&
              (task.status == TaskStatus.pending ||
                  task.status == TaskStatus.inProgress)) {
            return task;
          }
        }
      } catch (_) {
        return null;
      }
      return null;
    });
