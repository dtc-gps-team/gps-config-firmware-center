import 'dart:async';

import 'package:mobile/core/api/models.dart';
import 'package:mobile/features/task/config_apply_request_repository.dart';

/// คำขอส่ง Config ตัวอย่าง (docs/25) — ค่าเริ่มต้นเป็นคำขอ `pending` ของงาน `t1`
ConfigApplyRequest fakeApplyRequest({
  String id = 'car-1',
  String taskId = 't1',
  String deviceId = 'DVC-1',
  String configId = 'cfg-1',
  FieldApplyKind kind = FieldApplyKind.config,
  String? firmwareVersion,
  String? fromFirmwareVersion,
  bool isDowngrade = false,
  ConfigApplyRequestStatus status = ConfigApplyRequestStatus.pending,
  String? rejectReason,
  String? resultDetail,
  DateTime? decidedAt,
  DateTime? releasedAt,
  DateTime? completedAt,
  DateTime? expiresAt,
  ApplyRequestOverride? override,
  DateTime? requestedAt,
  int attemptCount = 0,
  int? maxAttempts,
}) => ConfigApplyRequest(
  id: id,
  taskId: taskId,
  deviceId: deviceId,
  kind: kind,
  configId: kind == FieldApplyKind.config ? configId : null,
  firmwareId: kind == FieldApplyKind.firmware ? 'fw-$firmwareVersion' : null,
  firmwareVersion: firmwareVersion,
  fromFirmwareVersion: fromFirmwareVersion,
  isDowngrade: isDowngrade,
  status: status,
  requestedAt: requestedAt ?? DateTime.utc(2026, 10, 22, 3),
  expiresAt: expiresAt ?? DateTime.utc(2026, 10, 23, 3),
  rejectReason: rejectReason,
  resultDetail: resultDetail,
  decidedAt: decidedAt,
  releasedAt: releasedAt,
  completedAt: completedAt,
  override: override,
  attemptCount: attemptCount,
  maxAttempts: maxAttempts,
);

/// ใช้แทน [ConfigApplyRequestRepository] ในเทสหน้า Task Detail — เก็บคำขอไว้ใน
/// list (ใหม่สุดก่อน) · [createGate] ให้คำขอค้างบนสายจนกว่าเทสจะ complete
class FakeConfigApplyRequestRepository implements ConfigApplyRequestRepository {
  FakeConfigApplyRequestRepository({
    List<ConfigApplyRequest>? requests,
    this.progressOverride,
    this.progressError,
    this.listError,
    this.createError,
    this.cancelError,
    this.createGate,
    DeviceApplyOptions? options,
    this.optionsError,
  }) : requests = requests ?? [],
       options = options ?? fakeApplyOptions();

  /// ผลของ `applyOptions` (docs/28) — ค่าเริ่มต้นมี Config 2 ตัว ตัวแรกแนะนำ
  DeviceApplyOptions options;
  Object? optionsError;
  int optionsCalls = 0;
  String? lastCreateConfigId;
  String? lastCreateFirmwareId;
  String? lastCreateNote;
  bool? lastCreateDirect;

  final List<ConfigApplyRequest> requests;
  final ConfigApplyRequestProgress Function(ConfigApplyRequest request)?
  progressOverride;
  Object? progressError;
  int progressCalls = 0;

  @override
  Future<ConfigApplyRequestProgress> progress(
    String taskId,
    String requestId,
  ) async {
    progressCalls++;
    if (progressError != null) throw progressError!;
    final request = requests.firstWhere((r) => r.id == requestId);
    final override = progressOverride;
    if (override != null) return override(request);
    return ConfigApplyRequestProgress(
      requestId: request.id,
      kind: request.kind,
      status: request.status,
      fromVersion: request.fromFirmwareVersion,
      toVersion: request.firmwareVersion,
      isDowngrade: request.isDowngrade,
      releasedAt: request.releasedAt,
      completedAt: request.completedAt,
    );
  }

  Object? listError;
  Object? createError;
  Object? cancelError;
  Object? releaseError;
  Completer<ConfigApplyRequest>? createGate;

  int listCalls = 0;
  int createCalls = 0;
  int cancelCalls = 0;
  int releaseCalls = 0;
  String? lastReleaseId;
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
  Future<ConfigApplyRequest> create(
    String taskId, {
    String? configId,
    String? firmwareId,
    String? note,
    bool direct = false,
  }) async {
    createCalls++;
    lastCreateTaskId = taskId;
    lastCreateDirect = direct;
    lastCreateConfigId = configId;
    lastCreateFirmwareId = firmwareId;
    lastCreateNote = note;
    final error = createError;
    if (error != null) throw error;
    final gate = createGate;
    final created = gate != null
        ? await gate.future
        : fakeApplyRequest(
            id: 'car-new-$createCalls',
            taskId: taskId,
            // ขอ Firmware = คำขอชนิด Firmware ของรุ่นนั้น (`fw-<version>`)
            kind: firmwareId != null
                ? FieldApplyKind.firmware
                : FieldApplyKind.config,
            firmwareVersion: firmwareId?.replaceFirst('fw-', ''),
            configId: configId ?? 'cfg-1',
            // ส่งตรง = อนุมัติแล้วทันที (v3.75)
            status: direct
                ? ConfigApplyRequestStatus.approved
                : ConfigApplyRequestStatus.pending,
          );
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

  /// ขนาดหน้าของ [history] (backend ใช้ 20) · ตั้งให้เล็กในเทสเพื่อดูการโหลดต่อ
  int historyPageSize = 20;
  int historyCalls = 0;
  Object? historyError;
  final List<
    ({String? before, ApplyHistoryResult? result, FieldApplyKind? kind})
  >
  historyQueries = [];

  /// เลียนแบบ backend: กรองกลุ่มผล/ชนิด แบ่งหน้าตามลำดับใน [requests] (ใหม่สุด
  /// ก่อน) · cursor ของ fake = id ของรายการสุดท้ายในหน้า
  @override
  Future<ConfigApplyRequestHistoryPage> history(
    String taskId, {
    String? before,
    ApplyHistoryResult? result,
    FieldApplyKind? kind,
  }) async {
    historyCalls++;
    historyQueries.add((before: before, result: result, kind: kind));
    final error = historyError;
    if (error != null) throw error;
    bool inResult(ConfigApplyRequest r) => switch (result) {
      null => true,
      ApplyHistoryResult.succeeded =>
        r.status == ConfigApplyRequestStatus.succeeded,
      ApplyHistoryResult.open => r.status.isInFlight,
      ApplyHistoryResult.unsuccessful =>
        r.status != ConfigApplyRequestStatus.succeeded && !r.status.isInFlight,
    };
    final matched = [
      for (final r in requests)
        if (r.taskId == taskId &&
            inResult(r) &&
            (kind == null || r.kind == kind))
          r,
    ];
    final start = before == null
        ? 0
        : matched.indexWhere((r) => r.id == before) + 1;
    final page = matched.skip(start).take(historyPageSize).toList();
    final more = start + page.length < matched.length;
    return ConfigApplyRequestHistoryPage(
      items: page,
      nextCursor: more && page.isNotEmpty ? page.last.id : null,
    );
  }

  @override
  Future<ConfigApplyRequest> release(String requestId) async {
    releaseCalls++;
    lastReleaseId = requestId;
    final error = releaseError;
    if (error != null) throw error;
    final index = requests.indexWhere((r) => r.id == requestId);
    final before = index >= 0 ? requests[index] : null;
    final sending = fakeApplyRequest(
      id: requestId,
      // คงชนิดและของที่ขอส่งไว้ (Firmware ส่งแล้วยังเป็น Firmware)
      kind: before?.kind ?? FieldApplyKind.config,
      configId: before?.configId ?? 'cfg-1',
      firmwareVersion: before?.firmwareVersion,
      status: ConfigApplyRequestStatus.sending,
      decidedAt: DateTime.utc(2026, 10, 22, 4),
      releasedAt: DateTime.utc(2026, 10, 22, 5),
    );
    if (index >= 0) requests[index] = sending;
    return sending;
  }

  @override
  Future<DeviceApplyOptions> applyOptions(String deviceId) async {
    optionsCalls++;
    final error = optionsError;
    if (error != null) throw error;
    return options;
  }
}

/// ตัวเลือก Config ตัวอย่าง (docs/28 §5.2) — `cfg-1` แนะนำ, `cfg-2` ไม่แนะนำ ·
/// Firmware (docs/27 B3): กล่องรัน 1.2.0 → `fw-1.3.0` อัปเกรด, `fw-1.2.0` ตัวที่รันอยู่,
/// `fw-1.0.0` ถอยเวอร์ชัน
DeviceApplyOptions fakeApplyOptions({
  String deviceId = 'DVC-1',
  bool deviceInstalled = true,
  List<ApplyOptionConfig>? configs,
  String? currentFirmwareVersion = '1.2.0',
  List<ApplyOptionFirmware>? firmwares,
  ApplyOptionOpenRequest? openRequest,
}) => DeviceApplyOptions(
  deviceId: deviceId,
  deviceInstalled: deviceInstalled,
  openRequest: openRequest,
  currentFirmwareVersion: currentFirmwareVersion,
  firmwares:
      firmwares ??
      const [
        ApplyOptionFirmware(id: 'fw-1.3.0', version: '1.3.0'),
        ApplyOptionFirmware(id: 'fw-1.2.0', version: '1.2.0', isCurrent: true),
        ApplyOptionFirmware(
          id: 'fw-1.0.0',
          version: '1.0.0',
          isDowngrade: true,
        ),
      ],
  configs:
      configs ??
      const [
        ApplyOptionConfig(
          id: 'cfg-1',
          name: 'GT06N มาตรฐาน',
          latestVersion: 3,
          suggested: true,
        ),
        ApplyOptionConfig(
          id: 'cfg-2',
          name: 'GT06N ลูกค้าพิเศษ',
          latestVersion: 0,
          suggested: false,
        ),
      ],
);
