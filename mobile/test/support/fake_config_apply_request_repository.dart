import 'dart:async';

import 'package:mobile/core/api/models.dart';
import 'package:mobile/features/task/config_apply_request_repository.dart';

/// คำขอส่ง Config ตัวอย่าง (docs/25) — ค่าเริ่มต้นเป็นคำขอ `pending` ของงาน `t1`
ConfigApplyRequest fakeApplyRequest({
  String id = 'car-1',
  String taskId = 't1',
  String deviceId = 'DVC-1',
  String configId = 'cfg-1',
  ConfigApplyRequestStatus status = ConfigApplyRequestStatus.pending,
  String? rejectReason,
  String? resultDetail,
  DateTime? decidedAt,
  DateTime? completedAt,
}) => ConfigApplyRequest(
  id: id,
  taskId: taskId,
  deviceId: deviceId,
  configId: configId,
  status: status,
  requestedAt: DateTime.utc(2026, 10, 22, 3),
  expiresAt: DateTime.utc(2026, 10, 23, 3),
  rejectReason: rejectReason,
  resultDetail: resultDetail,
  decidedAt: decidedAt,
  completedAt: completedAt,
);

/// ใช้แทน [ConfigApplyRequestRepository] ในเทสหน้า Task Detail — เก็บคำขอไว้ใน
/// list (ใหม่สุดก่อน) · [createGate] ให้คำขอค้างบนสายจนกว่าเทสจะ complete
class FakeConfigApplyRequestRepository implements ConfigApplyRequestRepository {
  FakeConfigApplyRequestRepository({
    List<ConfigApplyRequest>? requests,
    this.listError,
    this.createError,
    this.cancelError,
    this.createGate,
  }) : requests = requests ?? [];

  final List<ConfigApplyRequest> requests;
  Object? listError;
  Object? createError;
  Object? cancelError;
  Completer<ConfigApplyRequest>? createGate;

  int listCalls = 0;
  int createCalls = 0;
  int cancelCalls = 0;
  String? lastCreateTaskId;
  String? lastCancelId;

  @override
  Future<List<ConfigApplyRequest>> listForTask(String taskId) async {
    listCalls++;
    final error = listError;
    if (error != null) throw error;
    return List.of(requests);
  }

  @override
  Future<ConfigApplyRequest> create(String taskId) async {
    createCalls++;
    lastCreateTaskId = taskId;
    final error = createError;
    if (error != null) throw error;
    final gate = createGate;
    final created = gate != null
        ? await gate.future
        : fakeApplyRequest(id: 'car-new-$createCalls', taskId: taskId);
    requests.insert(0, created);
    return created;
  }

  @override
  Future<ConfigApplyRequest> cancel(String requestId) async {
    cancelCalls++;
    lastCancelId = requestId;
    final error = cancelError;
    if (error != null) throw error;
    final index = requests.indexWhere((r) => r.id == requestId);
    final cancelled = fakeApplyRequest(
      id: requestId,
      status: ConfigApplyRequestStatus.cancelled,
      resultDetail: 'ผู้ขอยกเลิกคำขอเอง',
    );
    if (index >= 0) requests[index] = cancelled;
    return cancelled;
  }
}
