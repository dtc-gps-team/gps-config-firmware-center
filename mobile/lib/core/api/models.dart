/// Data models mirroring `docs/api/openapi.yaml` (v0.1.0) exactly.
///
/// Keep field names, nullability and enum values in sync with the spec.
library;

/// `LoginResponse.role` enum — the 6 values in the API contract on `main`
/// (see the RBAC Matrix). `SW` was split into `ConfigEngineer`/
/// `FirmwareEngineer`/`QAEngineer` (docs/13_Role_Redesign_Proposal.md §3.1,
/// PR #178) — all three are Web-only, so Mobile just drops the case instead
/// of adding new ones. No mobile-only role exists; field staff log in as ST
/// or OT.
///
/// `SuperAdmin` is Web-only (RBAC_Matrix.md Section 1), same as `Admin` — but
/// it's still parsed here so a login that somehow returns it (e.g. testing
/// with the wrong account) gets a clear error message instead of an
/// unhandled `ArgumentError` from `fromWire`.
enum UserRole {
  operation('Operation'),
  st('ST'),
  ot('OT'),
  auditor('Auditor'),
  admin('Admin'),
  superAdmin('SuperAdmin');

  const UserRole(this.wireName);

  /// The exact string used on the wire (matches the OpenAPI enum).
  final String wireName;

  static UserRole fromWire(String value) {
    for (final role in UserRole.values) {
      if (role.wireName == value) return role;
    }
    throw ArgumentError.value(value, 'value', 'Unknown role');
  }
}

/// `Task.status` enum — matches `docs/api/openapi.yaml` `Task.status`
/// and the Prisma `TaskStatus` enum.
enum TaskStatus {
  pending('pending'),
  inProgress('in_progress'),
  completed('completed'),
  cancelled('cancelled');

  const TaskStatus(this.wireName);

  final String wireName;

  static TaskStatus fromWire(String value) {
    for (final status in TaskStatus.values) {
      if (status.wireName == value) return status;
    }
    throw ArgumentError.value(value, 'value', 'Unknown task status');
  }
}

/// ที่มาของงาน (`Task.source` ใน openapi, docs/28 §4) — `operation` = Operation
/// สร้างผ่าน `POST /tasks` · `technician` = ช่างเริ่มเองจากหน้ากล่อง
/// (`POST /tasks/start`) · ค่าที่ไม่รู้จัก (backend ใหม่กว่าแอป) และ payload ที่ไม่มี
/// field นี้ (backend ก่อน docs/28 / cache ในเครื่อง) ถือเป็น `operation` — **ไม่
/// throw** ต่างจาก enum อื่น เพราะแค่ใช้แสดงป้าย ไม่ควรทำให้หน้า Task พัง
enum TaskSource {
  operation('operation'),
  technician('technician');

  const TaskSource(this.wireName);

  final String wireName;

  static TaskSource fromWire(Object? value) {
    for (final source in TaskSource.values) {
      if (source.wireName == value) return source;
    }
    return TaskSource.operation;
  }
}

/// `Notification.type` enum — matches `docs/api/openapi.yaml` `Notification.type`
/// and the Prisma `NotificationType` enum.
enum NotificationType {
  taskAssigned('task_assigned'),
  configApproved('config_approved'),
  configRejected('config_rejected'),
  firmwareReady('firmware_ready'),
  incidentAlert('incident_alert'),
  configDeletionPending('config_deletion_pending'),
  configDeletionGrace('config_deletion_grace'),
  // เพิ่มใหม่ (issue #226) — Per-device Config Override (issue #223)
  configOverridePending('config_override_pending'),
  configOverrideApproved('config_override_approved'),
  configOverrideRejected('config_override_rejected'),
  // เพิ่มใหม่ (issue #256) — Per-device Firmware Override (Sprint 3 แถวที่ 24,
  // PR #257) mirror config_override_* ทุกประการ
  firmwareOverridePending('firmware_override_pending'),
  firmwareOverrideApproved('firmware_override_approved'),
  firmwareOverrideRejected('firmware_override_rejected'),
  // เพิ่มใหม่ (issue #236, PR #267) — Field Incident Report · ชื่อตามที่ backend
  // implement จริง (prefix `incident_report_*` ไม่ใช่ `incident_*`) ไม่ชนกับ
  // `incident_alert` (incident อัตโนมัติ) — `pending` ส่งให้ Operation ทุกคน
  // ตอนมี report ใหม่ · `resolved/dismissed/promoted` ส่งให้ผู้แจ้ง (ST/OT)
  // ตอน Operation ตัดสินใจ
  incidentReportPending('incident_report_pending'),
  incidentReportResolved('incident_report_resolved'),
  incidentReportDismissed('incident_report_dismissed'),
  incidentReportPromoted('incident_report_promoted'),
  // เพิ่มใหม่ (docs/25 §3.6) — คำขอส่ง Config เข้าเครื่องจากหน้างาน · payload
  // `{requestId, taskId, deviceId}` เสมอ (+ `rejectReason` / `outcome`+`detail`)
  // · `pending` ส่งให้ Operation · ที่เหลือส่งให้ช่างที่ถือ Task · `approved`
  // เพิ่มใน docs/27 (อนุมัติแล้ว ช่างกดส่งเข้ากล่องได้ — payload มี `expiresAt`)
  configApplyPending('config_apply_pending'),
  configApplyApproved('config_apply_approved'),
  configApplyRejected('config_apply_rejected'),
  configApplySucceeded('config_apply_succeeded'),
  configApplyFailed('config_apply_failed'),
  configApplyExpired('config_apply_expired');

  const NotificationType(this.wireName);

  final String wireName;

  static NotificationType fromWire(String value) {
    for (final type in NotificationType.values) {
      if (type.wireName == value) return type;
    }
    throw ArgumentError.value(value, 'value', 'Unknown notification type');
  }
}

/// `Device.status` enum — matches `docs/api/openapi.yaml` `Device.status`
/// and the Prisma enum `DeviceLifecycleStatus`.
enum DeviceLifecycleStatus {
  registered('registered'),
  installed('installed'),
  decommissioned('decommissioned');

  const DeviceLifecycleStatus(this.wireName);

  final String wireName;

  static DeviceLifecycleStatus fromWire(String value) {
    for (final status in DeviceLifecycleStatus.values) {
      if (status.wireName == value) return status;
    }
    throw ArgumentError.value(value, 'value', 'Unknown device status');
  }
}

/// `Incident.severity` enum — matches `docs/api/openapi.yaml` `Incident.severity`
/// and the Prisma enum `IncidentSeverity`.
enum IncidentSeverity {
  critical('critical'),
  high('high'),
  medium('medium'),
  low('low');

  const IncidentSeverity(this.wireName);

  final String wireName;

  static IncidentSeverity fromWire(String value) {
    for (final s in IncidentSeverity.values) {
      if (s.wireName == value) return s;
    }
    throw ArgumentError.value(value, 'value', 'Unknown incident severity');
  }
}

/// `Incident.status` enum — matches `docs/api/openapi.yaml` `Incident.status`
/// and the Prisma enum `IncidentStatus`.
enum IncidentStatus {
  open('open'),
  investigating('investigating'),
  rolledBack('rolled_back'),
  resolved('resolved'),
  // เพิ่มใหม่ (issue #236, backend PR #267) — Operation ตัดสินใจ "ไม่ใช่ปัญหา/
  // ซ้ำ" กับ field report · ต้องรู้จักไว้ ไม่งั้น `listIncidents` (strict)
  // จะ error ทั้งรายการเมื่อ backend ส่งค่านี้
  dismissed('dismissed');

  const IncidentStatus(this.wireName);

  final String wireName;

  static IncidentStatus fromWire(String value) {
    for (final s in IncidentStatus.values) {
      if (s.wireName == value) return s;
    }
    throw ArgumentError.value(value, 'value', 'Unknown incident status');
  }
}

/// `DeviceConfigDraft.status` enum.
enum ConfigStatus {
  draft('draft'),
  testing('testing'),
  approved('approved'),
  rejected('rejected'),
  synced('synced');

  const ConfigStatus(this.wireName);

  final String wireName;

  static ConfigStatus fromWire(String value) {
    for (final status in ConfigStatus.values) {
      if (status.wireName == value) return status;
    }
    throw ArgumentError.value(value, 'value', 'Unknown config status');
  }
}

/// หนึ่งคู่ (deviceModel, protocol) ที่ field นี้ใช้ได้ — ส่วนหนึ่งของ
/// [ConfigFieldDefinition.supportedModels].
class ConfigFieldModelSupport {
  const ConfigFieldModelSupport({
    required this.deviceModel,
    required this.protocol,
  });

  final String deviceModel;
  final String protocol;

  factory ConfigFieldModelSupport.fromJson(Map<String, dynamic> json) {
    return ConfigFieldModelSupport(
      deviceModel: json['deviceModel'] as String? ?? '',
      protocol: json['protocol'] as String? ?? '',
    );
  }
}

/// `GET /config-definitions` — คลัง field ที่ระบบรู้จัก mirrors
/// `web/src/lib/config-definition-api.ts` `ConfigFieldDefinition` (ตรงกับ
/// `docs/api/openapi.yaml` `ConfigFieldDefinition`) ใช้อ้างอิงตอนแสดง/ตรวจค่า
/// Config รวมถึงหน้า Config Override (issue #211 Phase 2, ST เท่านั้น) ที่ต้อง
/// รู้ว่า field ไหน `stOverridable: true` บ้าง.
class ConfigFieldDefinition {
  const ConfigFieldDefinition({
    required this.id,
    required this.fieldName,
    required this.dataType,
    required this.allowedValues,
    required this.required,
    required this.stOverridable,
    required this.sensitive,
    required this.supportedModels,
    this.description,
    this.unit,
    this.category,
    this.defaultValue,
  });

  final String id;
  final String fieldName;
  final String dataType;

  /// ค่าที่ยอมรับได้ — ว่าง = ไม่จำกัดค่า.
  final List<String> allowedValues;
  final bool required;

  /// ST override ค่า field นี้บนอุปกรณ์ผ่าน `POST /config/{id}/override` ได้ไหม
  /// (issue #185) — OT ไม่มีสิทธิ์ override เลยไม่ว่าค่านี้จะเป็นอะไร.
  final bool stOverridable;

  /// field เก็บค่าอ่อนไหว — ใช้ซ่อนค่าบนหน้าจอ (mirror `SensitiveValue` ฝั่ง Web).
  final bool sensitive;
  final List<ConfigFieldModelSupport> supportedModels;
  final String? description;
  final String? unit;
  final String? category;
  final String? defaultValue;

  factory ConfigFieldDefinition.fromJson(Map<String, dynamic> json) {
    final rawAllowedValues = json['allowedValues'] as List<dynamic>?;
    final rawSupportedModels = json['supportedModels'] as List<dynamic>?;
    return ConfigFieldDefinition(
      id: json['id'] as String,
      fieldName: json['fieldName'] as String,
      dataType: json['dataType'] as String? ?? 'string',
      allowedValues: rawAllowedValues == null
          ? const []
          : rawAllowedValues.map((e) => e.toString()).toList(growable: false),
      required: json['required'] as bool? ?? false,
      stOverridable: json['stOverridable'] as bool? ?? false,
      sensitive: json['sensitive'] as bool? ?? false,
      supportedModels: rawSupportedModels == null
          ? const []
          : rawSupportedModels
                .whereType<Map>()
                .map(
                  (e) => ConfigFieldModelSupport.fromJson(
                    e.cast<String, dynamic>(),
                  ),
                )
                .toList(growable: false),
      description: json['description'] as String?,
      unit: json['unit'] as String?,
      category: json['category'] as String?,
      defaultValue: json['defaultValue'] as String?,
    );
  }
}

/// `POST /auth/login` request body.
class LoginRequest {
  const LoginRequest({required this.username, required this.password});

  final String username;
  final String password;

  Map<String, dynamic> toJson() => {'username': username, 'password': password};
}

/// `POST /auth/login` `200` response. Both fields are optional in the spec.
class LoginResponse {
  const LoginResponse({this.accessToken, this.role});

  final String? accessToken;
  final UserRole? role;

  factory LoginResponse.fromJson(Map<String, dynamic> json) {
    final rawRole = json['role'] as String?;
    return LoginResponse(
      accessToken: json['accessToken'] as String?,
      role: rawRole == null ? null : UserRole.fromWire(rawRole),
    );
  }
}

/// Per-device Config Override (issue #223) — คำขอแก้ค่าบาง field ของ Config
/// เฉพาะอุปกรณ์เครื่องเดียว ต้องผ่าน Operation อนุมัติก่อนถึงมีผล (มติ
/// 2026-09-24, PR #225) — ตรงกับ schema `DeviceConfigOverride` ใน
/// `docs/api/openapi.yaml`.
class DeviceConfigOverride {
  const DeviceConfigOverride({
    required this.id,
    required this.deviceId,
    required this.configId,
    required this.versionNumber,
    required this.fields,
    required this.reason,
    required this.status,
    required this.overriddenBy,
    required this.overriddenAt,
    this.decidedBy,
    this.decidedAt,
    this.rejectReason,
  });

  final String id;
  final String deviceId;
  final String configId;
  final int versionNumber;
  final Map<String, dynamic> fields;
  final String reason;

  /// `pending` | `approved` | `rejected`
  final String status;
  final String overriddenBy;
  final String overriddenAt;
  final String? decidedBy;
  final String? decidedAt;
  final String? rejectReason;

  bool get isPending => status == 'pending';

  factory DeviceConfigOverride.fromJson(Map<String, dynamic> json) {
    return DeviceConfigOverride(
      id: json['id'] as String,
      deviceId: json['deviceId'] as String,
      configId: json['configId'] as String,
      versionNumber: json['versionNumber'] as int,
      fields: (json['fields'] as Map?)?.cast<String, dynamic>() ?? const {},
      reason: json['reason'] as String? ?? '',
      status: json['status'] as String? ?? 'pending',
      overriddenBy: json['overriddenBy'] as String? ?? '',
      overriddenAt: json['overriddenAt'] as String? ?? '',
      decidedBy: json['decidedBy'] as String?,
      decidedAt: json['decidedAt'] as String?,
      rejectReason: json['rejectReason'] as String?,
    );
  }
}

/// `ConfigApplyRequest.status` — ตรงกับ `ConfigApplyRequestStatus` ใน
/// `docs/api/openapi.yaml` (docs/25 §4.1)
enum ConfigApplyRequestStatus {
  pending('pending'),
  // docs/27 — อนุมัติแล้ว รอช่างที่ถือ Task กดส่งเข้ากล่อง
  approved('approved'),
  sending('sending'),
  succeeded('succeeded'),
  failed('failed'),
  skippedOffline('skipped_offline'),
  rejected('rejected'),
  cancelled('cancelled'),
  expired('expired');

  const ConfigApplyRequestStatus(this.wireName);

  final String wireName;

  /// ขอส่งใหม่ได้จากสถานะนี้ไหม (docs/25 §3.3 ตารางการ์ด) — คำขอที่จบแบบไม่สำเร็จ
  /// · `pending`/`approved`/`sending` ยังเปิดอยู่ · `succeeded` กล่องรับแล้ว ไม่ต้องขอซ้ำ
  bool get allowsNewRequest => switch (this) {
    pending || approved || sending || succeeded => false,
    failed || skippedOffline || rejected || cancelled || expired => true,
  };

  /// สถานะที่ยังเปลี่ยนเองได้จากฝั่ง server (Operation ตัดสิน, หมดอายุ, ผลจาก
  /// กล่อง) — หน้า Task Detail โหลดใหม่เป็นระยะระหว่างอยู่สถานะนี้ (docs/27 §9)
  bool get isInFlight => switch (this) {
    pending || approved || sending => true,
    succeeded ||
    failed ||
    skippedOffline ||
    rejected ||
    cancelled ||
    expired => false,
  };

  static ConfigApplyRequestStatus fromWire(String value) {
    for (final status in ConfigApplyRequestStatus.values) {
      if (status.wireName == value) return status;
    }
    throw ArgumentError.value(value, 'value', 'Unknown config apply status');
  }
}

/// คำขอส่ง Config ของ Task เข้าเครื่องจริง (`ConfigApplyRequest` ใน openapi,
/// docs/25) — Mobile ใช้แค่ field ที่การ์ดใน Task Detail แสดง
class ConfigApplyRequest {
  const ConfigApplyRequest({
    required this.id,
    required this.taskId,
    required this.deviceId,
    required this.configId,
    required this.status,
    required this.requestedAt,
    required this.expiresAt,
    this.note,
    this.rejectReason,
    this.resultDetail,
    this.decidedAt,
    this.releasedAt,
    this.completedAt,
  });

  final String id;
  final String taskId;
  final String deviceId;
  final String configId;
  final ConfigApplyRequestStatus status;
  final DateTime requestedAt;
  final DateTime expiresAt;
  final String? note;
  final String? rejectReason;

  /// ผลหรือเหตุผลจากกล่อง หรือเหตุที่ระบบปิดคำขอเอง (หมดอายุ, งานถูกยกเลิก)
  final String? resultDetail;
  final DateTime? decidedAt;

  /// เวลาที่ช่างกดส่งเข้ากล่อง (docs/27) — `null` ก่อนกดส่ง
  final DateTime? releasedAt;
  final DateTime? completedAt;

  factory ConfigApplyRequest.fromJson(Map<String, dynamic> json) {
    DateTime? optionalDate(String key) {
      final value = json[key];
      return value is String ? DateTime.parse(value) : null;
    }

    return ConfigApplyRequest(
      id: json['id'] as String,
      taskId: json['taskId'] as String,
      deviceId: json['deviceId'] as String,
      configId: json['configId'] as String,
      status: ConfigApplyRequestStatus.fromWire(json['status'] as String),
      requestedAt: DateTime.parse(json['requestedAt'] as String),
      expiresAt: DateTime.parse(json['expiresAt'] as String),
      note: json['note'] as String?,
      rejectReason: json['rejectReason'] as String?,
      resultDetail: json['resultDetail'] as String?,
      decidedAt: optionalDate('decidedAt'),
      releasedAt: optionalDate('releasedAt'),
      completedAt: optionalDate('completedAt'),
    );
  }
}

/// 1 ตัวเลือก Config ใน `GET /devices/{deviceId}/apply-options` (docs/28 §5.2)
class ApplyOptionConfig {
  const ApplyOptionConfig({
    required this.id,
    required this.name,
    required this.latestVersion,
    required this.suggested,
  });

  final String id;
  final String name;

  /// `ConfigVersion.versionNumber` ล่าสุด (0 = ยังไม่มีเวอร์ชัน)
  final int latestVersion;

  /// Config ที่ Operation ผูกไว้กับงานที่ช่างเปิดอยู่ของกล่องนี้ — backend เรียง
  /// ตัวนี้ขึ้นก่อนแล้ว
  final bool suggested;

  factory ApplyOptionConfig.fromJson(Map<String, dynamic> json) =>
      ApplyOptionConfig(
        id: json['id'] as String,
        name: json['name'] as String,
        latestVersion: (json['latestVersion'] as num?)?.toInt() ?? 0,
        suggested: json['suggested'] as bool? ?? false,
      );
}

/// `GET /devices/{deviceId}/apply-options` (docs/28 §5.2) — Config ที่ช่างเลือก
/// ส่งเข้ากล่องนี้ได้ · ส่วน Firmware มาทีหลัง (B2/B3 ของ docs/27)
class DeviceApplyOptions {
  const DeviceApplyOptions({
    required this.deviceId,
    required this.deviceInstalled,
    required this.configs,
  });

  final String deviceId;

  /// ส่งเข้ากล่องได้เฉพาะเครื่องที่ติดตั้งแล้ว — `false` บอกช่างก่อนกดขอ
  final bool deviceInstalled;
  final List<ApplyOptionConfig> configs;

  factory DeviceApplyOptions.fromJson(Map<String, dynamic> json) =>
      DeviceApplyOptions(
        deviceId: json['deviceId'] as String,
        deviceInstalled: json['deviceInstalled'] as bool? ?? false,
        configs: [
          for (final raw in (json['configs'] as List<dynamic>? ?? const []))
            ApplyOptionConfig.fromJson(raw as Map<String, dynamic>),
        ],
      );
}

/// `Firmware` ใน `GET /firmware` (ทุก Role อ่านได้) — เก็บเฉพาะ field ที่หน้า
/// Firmware Override ใช้เลือก/กรองตัวที่ติดตั้งได้ (ไม่ต้องใช้ objectKey ฯลฯ)
class Firmware {
  const Firmware({
    required this.id,
    required this.version,
    required this.deviceModelCompatibility,
    required this.uploadStatus,
    required this.approvalStatus,
    this.originalFilename = '',
  });

  final String id;
  final String version;
  final List<String> deviceModelCompatibility;

  /// `pending` | `stored` | `failed`
  final String uploadStatus;

  /// `pending_review` | `approved` | `rejected`
  final String approvalStatus;
  final String originalFilename;

  /// ตรงกับเงื่อนไข 409 ของ backend (`confirmFirmwareInstall`/
  /// `overrideDeviceFirmware`): ต้อง stored + approved + รองรับรุ่นอุปกรณ์
  bool isInstallableOn(String deviceModel) =>
      uploadStatus == 'stored' &&
      approvalStatus == 'approved' &&
      (deviceModel.isEmpty || deviceModelCompatibility.contains(deviceModel));

  factory Firmware.fromJson(Map<String, dynamic> json) {
    return Firmware(
      id: json['id'] as String,
      version: json['version'] as String? ?? '',
      deviceModelCompatibility:
          (json['deviceModelCompatibility'] as List?)
              ?.whereType<String>()
              .toList(growable: false) ??
          const [],
      uploadStatus: json['uploadStatus'] as String? ?? 'pending',
      approvalStatus: json['approvalStatus'] as String? ?? 'pending_review',
      originalFilename: json['originalFilename'] as String? ?? '',
    );
  }
}

/// `DeviceFirmwareOverride` — คำขอ Firmware Override รายเครื่อง (issue #256,
/// PR #257) mirror [DeviceConfigOverride] แต่ไม่มี `fields`/`configId` เพราะ
/// Firmware เป็นเวอร์ชันเดียวทั้งก้อน · `consumedAt` = approved แล้วถูกใช้
/// ยืนยันติดตั้งไปแล้ว (single-use)
class DeviceFirmwareOverride {
  const DeviceFirmwareOverride({
    required this.id,
    required this.deviceId,
    required this.firmwareId,
    required this.versionNumber,
    required this.reason,
    required this.status,
    required this.overriddenBy,
    required this.overriddenAt,
    this.decidedBy,
    this.decidedAt,
    this.rejectReason,
    this.consumedAt,
  });

  final String id;
  final String deviceId;
  final String firmwareId;
  final int versionNumber;
  final String reason;

  /// `pending` | `approved` | `rejected`
  final String status;
  final String overriddenBy;
  final String overriddenAt;
  final String? decidedBy;
  final String? decidedAt;
  final String? rejectReason;
  final String? consumedAt;

  bool get isPending => status == 'pending';

  factory DeviceFirmwareOverride.fromJson(Map<String, dynamic> json) {
    return DeviceFirmwareOverride(
      id: json['id'] as String,
      deviceId: json['deviceId'] as String,
      firmwareId: json['firmwareId'] as String,
      versionNumber: json['versionNumber'] as int,
      reason: json['reason'] as String? ?? '',
      status: json['status'] as String? ?? 'pending',
      overriddenBy: json['overriddenBy'] as String? ?? '',
      overriddenAt: json['overriddenAt'] as String? ?? '',
      decidedBy: json['decidedBy'] as String?,
      decidedAt: json['decidedAt'] as String?,
      rejectReason: json['rejectReason'] as String?,
      consumedAt: json['consumedAt'] as String?,
    );
  }
}

/// Central shape both the config form and JSON import map into.
class DeviceConfigDraft {
  const DeviceConfigDraft({
    this.id,
    this.name,
    this.deviceModel,
    this.protocol,
    this.status,
    this.fields,
    this.hasDeviceOverride = false,
    this.pendingOverride,
  });

  final String? id;

  /// ชื่อ Config ที่ผู้ใช้ตั้ง — unique ทั้งระบบ (มติ Sprint 1 review ข้อ 4).
  /// Nullable ฝั่ง client เผื่อ response เก่า/mock ที่ไม่มี field นี้.
  final String? name;
  final String? deviceModel;
  final String? protocol;
  final ConfigStatus? status;
  final Map<String, dynamic>? fields;

  /// เฉพาะ response ของ `GET /devices/{deviceId}/config` (Per-device Config
  /// Override, issue #223) — `true` = `fields` ข้างบนถูก merge ด้วยคำขอ
  /// override ที่ Operation **อนุมัติแล้ว** (`status: approved`) เท่านั้น
  /// (มติ 2026-09-24, PR #225 — คำขอ `pending`/`rejected` ไม่มีผลต่อค่านี้เลย)
  /// endpoint อื่น (เช่น `listConfigs`) ไม่มี key นี้ใน response เลย — default
  /// `false`.
  final bool hasDeviceOverride;

  /// คำขอ override ที่ยังรอ Operation ตัดสินใจของอุปกรณ์เครื่องนี้ (ถ้ามี —
  /// เครื่องหนึ่งมีได้ทีละ 1 รายการ) `null` ถ้าไม่มีคำขอค้างอยู่ (มติ
  /// 2026-09-24, PR #225) ใช้แสดงสถานะ "รอ Operation อนุมัติ" บนหน้า Override
  final DeviceConfigOverride? pendingOverride;

  factory DeviceConfigDraft.fromJson(Map<String, dynamic> json) {
    final rawStatus = json['status'] as String?;
    final rawPending = json['pendingOverride'] as Map?;
    return DeviceConfigDraft(
      id: json['id'] as String?,
      name: json['name'] as String?,
      deviceModel: json['deviceModel'] as String?,
      protocol: json['protocol'] as String?,
      status: rawStatus == null ? null : ConfigStatus.fromWire(rawStatus),
      fields: (json['fields'] as Map?)?.cast<String, dynamic>(),
      hasDeviceOverride: json['hasDeviceOverride'] as bool? ?? false,
      pendingOverride: rawPending == null
          ? null
          : DeviceConfigOverride.fromJson(rawPending.cast<String, dynamic>()),
    );
  }
}

/// Result of a Config or Firmware simulation (`SimulationResult`).
class SimulationResult {
  const SimulationResult({required this.passed, required this.details});

  final bool passed;
  final List<String> details;

  factory SimulationResult.fromJson(Map<String, dynamic> json) {
    final rawDetails = json['details'] as List<dynamic>?;
    return SimulationResult(
      passed: json['passed'] as bool? ?? false,
      details: rawDetails == null
          ? const []
          : rawDetails.map((e) => e.toString()).toList(growable: false),
    );
  }
}

/// Result of `POST /devices/{deviceId}/test-connection`
/// (`DeviceConnectionTestResult`).
class DeviceConnectionTestResult {
  const DeviceConnectionTestResult({
    required this.passed,
    required this.signalStrength,
    required this.details,
    required this.testedAt,
  });

  final bool passed;

  /// dBm — mock mode returns a fixed value.
  final int signalStrength;
  final List<String> details;
  final DateTime testedAt;

  factory DeviceConnectionTestResult.fromJson(Map<String, dynamic> json) {
    final rawDetails = json['details'] as List<dynamic>?;
    return DeviceConnectionTestResult(
      passed: json['passed'] as bool? ?? false,
      // spec says `integer`, but JSON numbers decode loosely — accept any num
      signalStrength: (json['signalStrength'] as num?)?.toInt() ?? 0,
      details: rawDetails == null
          ? const []
          : rawDetails.map((e) => e.toString()).toList(growable: false),
      testedAt:
          DateTime.tryParse(json['testedAt'] as String? ?? '') ??
          DateTime.now(),
    );
  }
}

/// `compatibilityCheck` ของ [DeviceSimulateConfigResult] — `Config.deviceModel`
/// / `Config.protocol` ตรงกับอุปกรณ์เครื่องที่เลือกไหม (`CompatibilityCheckResult`).
/// mismatch ไม่ใช่ error — `passed: false` พร้อม `details` บอกว่าอะไรไม่ตรง.
class CompatibilityCheckResult {
  const CompatibilityCheckResult({required this.passed, required this.details});

  final bool passed;
  final List<String> details;

  factory CompatibilityCheckResult.fromJson(Map<String, dynamic> json) {
    final rawDetails = json['details'] as List<dynamic>?;
    return CompatibilityCheckResult(
      passed: json['passed'] as bool? ?? false,
      details: rawDetails == null
          ? const []
          : rawDetails.map((e) => e.toString()).toList(growable: false),
    );
  }
}

/// Result of `POST /devices/{deviceId}/simulate-config`
/// (`DeviceSimulateConfigResult`, config_simulator Phase 2) — readiness check
/// เต็มรูปแบบก่อน apply Config เข้าอุปกรณ์จริง รวม 3 ส่วน: ตัว Config เองพร้อม
/// ไหม ([configCheck]), deviceModel/protocol ตรงกับอุปกรณ์นี้ไหม
/// ([compatibilityCheck]), สัญญาณของกล่องเครื่องนั้น ([connectionCheck]).
/// [passed] เป็น `true` ก็ต่อเมื่อทั้ง 3 ส่วนผ่านหมด.
class DeviceSimulateConfigResult {
  const DeviceSimulateConfigResult({
    required this.passed,
    required this.configCheck,
    required this.compatibilityCheck,
    required this.connectionCheck,
  });

  final bool passed;
  final SimulationResult configCheck;
  final CompatibilityCheckResult compatibilityCheck;
  final DeviceConnectionTestResult connectionCheck;

  factory DeviceSimulateConfigResult.fromJson(Map<String, dynamic> json) =>
      DeviceSimulateConfigResult(
        passed: json['passed'] as bool? ?? false,
        configCheck: SimulationResult.fromJson(
          json['configCheck'] as Map<String, dynamic>? ?? const {},
        ),
        compatibilityCheck: CompatibilityCheckResult.fromJson(
          json['compatibilityCheck'] as Map<String, dynamic>? ?? const {},
        ),
        connectionCheck: DeviceConnectionTestResult.fromJson(
          json['connectionCheck'] as Map<String, dynamic>? ?? const {},
        ),
      );
}

/// Result of `POST /devices/{deviceId}/confirm-firmware-install`
/// (`ConfirmFirmwareInstallResult`, issue #261). Only records that the
/// confirmation happened (AuditLog) — nothing is sent to the device and no
/// device update status is computed.
class ConfirmFirmwareInstallResult {
  const ConfirmFirmwareInstallResult({
    required this.deviceId,
    required this.firmwareId,
    required this.confirmedAt,
  });

  /// `Device.deviceId` (เลขเครื่องจริง)
  final String deviceId;
  final String firmwareId;
  final DateTime confirmedAt;

  factory ConfirmFirmwareInstallResult.fromJson(Map<String, dynamic> json) {
    return ConfirmFirmwareInstallResult(
      deviceId: json['deviceId'] as String? ?? '',
      firmwareId: json['firmwareId'] as String? ?? '',
      confirmedAt:
          DateTime.tryParse(json['confirmedAt'] as String? ?? '') ??
          DateTime.now(),
    );
  }
}

/// A job assigned to field staff — mirrors `docs/api/openapi.yaml` `Task`
/// (and the Prisma model `Task`). `GET /tasks` / `GET /tasks/{taskId}` /
/// `PATCH /tasks/{taskId}` all return this shape.
class Task {
  const Task({
    required this.id,
    required this.title,
    required this.assignedTo,
    required this.status,
    required this.createdAt,
    required this.updatedAt,
    this.description,
    this.deviceId,
    this.configId,
    this.dueDate,
    this.source = TaskSource.operation,
    this.completedAt,
    this.autoClosed = false,
  });

  final String id;
  final String title;

  /// user id of the assignee (`Task.assignedTo`).
  final String assignedTo;
  final TaskStatus status;
  final DateTime createdAt;
  final DateTime updatedAt;
  final String? description;
  final String? deviceId;

  /// Config bound by Operation for an install task — the "Confirm Install"
  /// screen (Sprint 3) sends this to `POST /devices/{deviceId}/apply-config`.
  /// `null` for other task types (signal check, SIM swap).
  final String? configId;
  final DateTime? dueDate;

  /// ช่างเริ่มเองหรือ Operation สร้าง (docs/28) — แสดงเป็นป้ายใน Task Detail
  final TaskSource source;

  /// เวลาปิดงาน (ช่างกดหรือระบบปิด) — งานที่เสร็จก่อน docs/28 เป็น `null`
  final DateTime? completedAt;

  /// ระบบปิดให้เพราะไม่มีความเคลื่อนไหวเกิน 24 ชม. (docs/28 §5.4)
  final bool autoClosed;

  factory Task.fromJson(Map<String, dynamic> json) {
    DateTime? parseDate(Object? value) =>
        value is String ? DateTime.tryParse(value) : null;

    return Task(
      id: json['id'] as String,
      title: json['title'] as String,
      assignedTo: json['assignedTo'] as String? ?? '',
      status: TaskStatus.fromWire(json['status'] as String),
      // spec marks createdAt/updatedAt required, but decode defensively so a
      // slightly-off payload renders instead of throwing.
      createdAt: parseDate(json['createdAt']) ?? DateTime.now(),
      updatedAt: parseDate(json['updatedAt']) ?? DateTime.now(),
      description: json['description'] as String?,
      deviceId: json['deviceId'] as String?,
      configId: json['configId'] as String?,
      dueDate: parseDate(json['dueDate']),
      source: TaskSource.fromWire(json['source']),
      completedAt: parseDate(json['completedAt']),
      autoClosed: json['autoClosed'] as bool? ?? false,
    );
  }
}

/// ผลของ `POST /tasks/start` (docs/28 §5.1) — `created=false` = ได้งานเดิมที่ยัง
/// เปิดอยู่ของกล่องนี้กลับมา
class StartTaskResult {
  const StartTaskResult({required this.task, required this.created});

  final Task task;
  final bool created;
}

/// One entry on a task's timeline — mirrors `docs/api/openapi.yaml`
/// `TaskEvent` (Task Event History, issue #296). Either a status change
/// ([toStatus] set; [fromStatus] is null only for the "task created" event) or
/// a note ([fromStatus]/[toStatus] both null, [note] set). No photo — cut from
/// this round's scope.
class TaskEvent {
  const TaskEvent({
    required this.id,
    required this.taskId,
    required this.changedAt,
    this.fromStatus,
    this.toStatus,
    this.changedBy,
    this.changedByName,
    this.note,
  });

  final String id;
  final String taskId;
  final TaskStatus? fromStatus;
  final TaskStatus? toStatus;

  /// user id of whoever made the change — null only for the "task created"
  /// event backfilled onto tasks that existed before this feature.
  final String? changedBy;

  /// `User.fullName` of [changedBy], joined by the backend (ST/OT can't read
  /// the user list themselves).
  final String? changedByName;

  /// When it actually happened — for a status change made offline this is the
  /// tap time sent from the sync queue, not the time it synced.
  final DateTime changedAt;
  final String? note;

  bool get isNote => toStatus == null;

  factory TaskEvent.fromJson(Map<String, dynamic> json) {
    TaskStatus? status(Object? value) =>
        value is String ? TaskStatus.fromWire(value) : null;

    return TaskEvent(
      id: json['id'] as String,
      taskId: json['taskId'] as String,
      fromStatus: status(json['fromStatus']),
      toStatus: status(json['toStatus']),
      changedBy: json['changedBy'] as String?,
      changedByName: json['changedByName'] as String?,
      changedAt: DateTime.parse(json['changedAt'] as String),
      note: json['note'] as String?,
    );
  }
}

/// Device Search / Device Detail — mirrors `docs/api/openapi.yaml` `Device`
/// (Prisma model `Device`). `GET /devices` / `GET /devices/{deviceId}` both
/// return this shape. `deviceId` (ไม่ใช่ `id`) คือเลขเครื่องจริงที่ใช้อ้างอิงใน
/// path — ตรงกับ convention เดียวกับที่ web ใช้ (`web/src/lib/device-api.ts`).
class Device {
  const Device({
    required this.id,
    required this.deviceId,
    required this.simNumber,
    required this.deviceModel,
    required this.protocol,
    required this.status,
    required this.registeredAt,
    this.installedAt,
    this.imei,
    this.serialNumber,
    this.blackboxId,
    this.hardwareRevisionCode,
    this.bootloader,
    this.customer,
  });

  final String id;
  final String deviceId;
  final String simNumber;
  final String deviceModel;
  final String protocol;
  final DeviceLifecycleStatus status;
  final DateTime registeredAt;
  final DateTime? installedAt;

  /// ตัวระบุตัวเครื่อง — nullable ตาม spec (เครื่องที่ลงทะเบียนก่อนมีกติกา
  /// บังคับกรอกอาจยังเป็น null) Web แสดงที่หน้า Device Detail แล้ว
  final String? imei;
  final String? serialNumber;
  final String? blackboxId;

  /// รหัสรุ่นย่อย/รอบผลิต และ Bootloader ของเครื่อง — string อิสระ nullable
  /// (`Device.hardwareRevisionCode` / `Device.bootloader` ใน openapi) backend
  /// ส่งมานานแล้ว Mobile เพิ่งนำมาแสดง (issue #386)
  final String? hardwareRevisionCode;
  final String? bootloader;

  /// ลูกค้าเจ้าของอุปกรณ์ (`customer: {id, companyName}`) — null = ยังไม่ผูก
  final Customer? customer;

  factory Device.fromJson(Map<String, dynamic> json) {
    DateTime? parseDate(Object? value) =>
        value is String ? DateTime.tryParse(value) : null;

    return Device(
      id: json['id'] as String,
      deviceId: json['deviceId'] as String,
      simNumber: json['simNumber'] as String? ?? '',
      deviceModel: json['deviceModel'] as String? ?? '',
      protocol: json['protocol'] as String? ?? '',
      status: DeviceLifecycleStatus.fromWire(json['status'] as String),
      // spec marks registeredAt required, but decode defensively so a
      // slightly-off payload renders instead of throwing (same as Task).
      registeredAt: parseDate(json['registeredAt']) ?? DateTime.now(),
      installedAt: parseDate(json['installedAt']),
      imei: json['imei'] as String?,
      serialNumber: json['serialNumber'] as String?,
      blackboxId: json['blackboxId'] as String?,
      hardwareRevisionCode: json['hardwareRevisionCode'] as String?,
      bootloader: json['bootloader'] as String?,
      customer: json['customer'] is Map<String, dynamic>
          ? Customer.fromJson(json['customer'] as Map<String, dynamic>)
          : null,
    );
  }
}

/// `DeviceStatus.configStatus` / `.firmwareStatus` — `GET /devices/{deviceId}/status`
/// (issue #245, PR #247). The spec enum is `[up_to_date, pending, failed,
/// unknown]`. (`pending_update` belongs to `Firmware.deviceUpdateStatus`, a
/// different endpoint/field, and is never sent here.) `unknown` is a normal
/// value (device never appeared in any rollout), so an unrecognised string
/// also falls back to it instead of throwing.
enum DevicePayloadStatus {
  upToDate('up_to_date'),
  pending('pending'),
  failed('failed'),
  unknown('unknown');

  const DevicePayloadStatus(this.wireName);

  final String wireName;

  static DevicePayloadStatus fromWire(String? value) {
    for (final s in DevicePayloadStatus.values) {
      if (s.wireName == value) return s;
    }
    return DevicePayloadStatus.unknown;
  }
}

/// `GET /devices/{deviceId}/status` — mirrors `DeviceStatus` in
/// `docs/api/openapi.yaml` · [lastCheckInMessage] ยังเป็น placeholder (`null`
/// เสมอ) ฝั่ง backend · ออนไลน์ใช้ [online] / [lastSeenAt] (v3.56)
class DeviceStatus {
  const DeviceStatus({
    required this.deviceId,
    required this.configStatus,
    required this.firmwareStatus,
    this.lastCheckInMessage,
    this.lastSeenAt,
    this.online = false,
    this.pendingFirmwareOverride,
    this.configRolloutId,
    this.firmwareRolloutId,
  });

  final String deviceId;
  final DevicePayloadStatus configStatus;
  final DevicePayloadStatus firmwareStatus;
  final String? lastCheckInMessage;

  /// เวลาที่เครื่องเรียก `/device-sync/*` สำเร็จล่าสุด — `null` = ไม่เคยติดต่อ ·
  /// กล่องโหมด central ต่อผ่าน ws-gateway ไม่เรียก endpoint นี้ ค่านี้จึงเป็น
  /// `null` เสมอสำหรับกล่องพวกนั้น (ใช้ [DeviceCentral] แทน — ดู `DeviceOnline`)
  final DateTime? lastSeenAt;

  /// [lastSeenAt] อยู่ภายใน 5 นาทีล่าสุด (backend ตัดสิน) · backend เก่า → `false`
  final bool online;

  /// คำขอ Firmware Override ที่ยังรอ Operation ตัดสินใจของเครื่องนี้ (PR #257,
  /// openapi v3.45) — `null` ถ้าไม่มี · เป็นสถานะของ**อุปกรณ์** ไม่ filter ด้วย
  /// ผู้ขอ (mirror `DeviceConfigDraft.pendingOverride`) · backend เก่าที่ยังไม่มี
  /// field นี้ → `null`
  final DeviceFirmwareOverride? pendingFirmwareOverride;

  /// `CampaignRollout.id` ที่ [configStatus] / [firmwareStatus] คำนวณมา (openapi
  /// v3.47, issue #243/#265) — มีค่าเฉพาะตอนสถานะเป็น `pending` ไม่งั้น `null`
  /// ส่งกลับเป็น `rolloutId` ตอน apply-config / confirm-firmware-install เพื่อกัน
  /// backend match ผิดรอบ · backend เก่าที่ไม่มี field นี้ → `null`
  final String? configRolloutId;
  final String? firmwareRolloutId;

  factory DeviceStatus.fromJson(Map<String, dynamic> json) {
    return DeviceStatus(
      deviceId: json['deviceId'] as String? ?? '',
      configStatus: DevicePayloadStatus.fromWire(
        json['configStatus'] as String?,
      ),
      firmwareStatus: DevicePayloadStatus.fromWire(
        json['firmwareStatus'] as String?,
      ),
      lastCheckInMessage: json['lastCheckInMessage'] as String?,
      lastSeenAt: json['lastSeenAt'] is String
          ? DateTime.tryParse(json['lastSeenAt'] as String)
          : null,
      online: json['online'] == true,
      pendingFirmwareOverride: json['pendingFirmwareOverride'] is Map
          ? DeviceFirmwareOverride.fromJson(
              (json['pendingFirmwareOverride'] as Map).cast<String, dynamic>(),
            )
          : null,
      configRolloutId: json['configRolloutId'] as String?,
      firmwareRolloutId: json['firmwareRolloutId'] as String?,
    );
  }
}

/// กล่องหนึ่งเครื่องตามที่ Server กลางรายงาน — `CentralDevice` ใน openapi
/// (ตัดเหลือ field ที่ Mobile ใช้)
class CentralDeviceInfo {
  const CentralDeviceInfo({
    required this.online,
    this.lastSeenAt,
    this.reportedFirmwareVersion,
    this.reportedConfigVersion,
  });

  final bool online;
  final DateTime? lastSeenAt;

  /// เวอร์ชันที่**กล่องรายงานเอง** (ไม่ใช่ค่าที่ระบบตั้งเป้าไว้)
  final String? reportedFirmwareVersion;
  final int? reportedConfigVersion;

  factory CentralDeviceInfo.fromJson(Map<String, dynamic> json) {
    final config = json['reportedConfigVersion'];
    return CentralDeviceInfo(
      online: json['online'] == true,
      lastSeenAt: json['lastSeenAt'] is String
          ? DateTime.tryParse(json['lastSeenAt'] as String)
          : null,
      reportedFirmwareVersion: json['reportedFirmwareVersion'] as String?,
      reportedConfigVersion: config is num ? config.toInt() : null,
    );
  }
}

/// `GET /devices/{deviceId}/central` (`DeviceCentralView`) — [reachable]
/// `false` = ติดต่อ Server กลางไม่ได้ · [device] `null` = Server กลางไม่รู้จัก
/// กล่องนี้ (ไม่ใช่กล่องโหมด central)
class DeviceCentral {
  const DeviceCentral({required this.reachable, this.device});

  final bool reachable;
  final CentralDeviceInfo? device;

  factory DeviceCentral.fromJson(Map<String, dynamic> json) => DeviceCentral(
    reachable: json['reachable'] == true,
    device: json['device'] is Map
        ? CentralDeviceInfo.fromJson(
            (json['device'] as Map).cast<String, dynamic>(),
          )
        : null,
  );
}

/// ลูกค้าแบบย่อ — mirrors `GET /customers` (`CustomerSummary` backend-side,
/// issue #204) id + ชื่อบริษัทเท่านั้น ใช้เป็น `Device.customer`
class Customer {
  const Customer({required this.id, required this.companyName});

  final String id;
  final String companyName;

  factory Customer.fromJson(Map<String, dynamic> json) {
    return Customer(
      id: json['id'] as String,
      companyName: json['companyName'] as String? ?? '',
    );
  }
}

/// เหตุการณ์ผิดปกติ — mirrors `docs/api/openapi.yaml` `Incident` (Prisma model
/// `Incident`). `GET /incidents` / `GET /incidents/{id}` return this shape.
///
/// Read-only บน Mobile รอบนี้ — ตาม `RBAC_Matrix.md` แถว "Incident & Rollback"
/// ช่างหน้างาน (ST/OT) มีแค่ Read ไม่มีสิทธิ์ Create/Update (Create = Operation
/// เท่านั้น) · `metadata` เป็น free-form JsON เก็บเป็น raw map (เหมือน
/// [AppNotification.payload]) — หน้า list ไม่ parse เข้าไป
class Incident {
  const Incident({
    required this.id,
    required this.title,
    required this.severity,
    required this.status,
    required this.createdAt,
    required this.updatedAt,
    this.description,
    this.relatedConfigId,
    this.relatedFirmwareId,
    this.source,
    this.metadata,
    this.reportedBy,
    this.deviceId,
    this.reviewedBy,
    this.reviewedAt,
    this.reviewNote,
  });

  final String id;
  final String title;
  final String? description;
  final IncidentSeverity severity;
  final IncidentStatus status;
  final String? relatedConfigId;
  final String? relatedFirmwareId;
  final String? source;
  final Map<String, dynamic>? metadata;
  final DateTime createdAt;
  final DateTime updatedAt;

  // Field report (issue #236, backend PR #267 / openapi v3.47 — ทุกตัว
  // nullable: incident อัตโนมัติเดิมไม่มี) — `source == 'field-report'` คือ
  // report ที่ ST/OT แจ้งเอง
  /// `User.id` ของผู้แจ้ง — null สำหรับ incident auto-detect
  final String? reportedBy;

  /// `Device.deviceId` ที่ report ผูกไว้
  final String? deviceId;

  /// Operation ที่ตัดสินใจ + เวลา + เหตุผล/บริบท
  final String? reviewedBy;
  final DateTime? reviewedAt;
  final String? reviewNote;

  // ไม่มี `promotedCampaignId` — backend (PR #267) ไม่มี column นี้ ใช้ FK ฝั่ง
  // `Campaign.sourceIncidentId @unique` แทน (ยังไม่มี endpoint query กลับทาง)

  bool get isFieldReport => source == 'field-report';

  factory Incident.fromJson(Map<String, dynamic> json) {
    DateTime? parseDate(Object? value) =>
        value is String ? DateTime.tryParse(value) : null;

    return Incident(
      id: json['id'] as String,
      title: json['title'] as String? ?? '',
      description: json['description'] as String?,
      severity: IncidentSeverity.fromWire(json['severity'] as String),
      status: IncidentStatus.fromWire(json['status'] as String),
      relatedConfigId: json['relatedConfigId'] as String?,
      relatedFirmwareId: json['relatedFirmwareId'] as String?,
      source: json['source'] as String?,
      metadata: (json['metadata'] as Map?)?.cast<String, dynamic>(),
      reportedBy: json['reportedBy'] as String?,
      deviceId: json['deviceId'] as String?,
      reviewedBy: json['reviewedBy'] as String?,
      reviewedAt: parseDate(json['reviewedAt']),
      reviewNote: json['reviewNote'] as String?,
      // spec marks createdAt/updatedAt required, but decode defensively
      // so a slightly-off payload renders instead of throwing (same as Task).
      createdAt: parseDate(json['createdAt']) ?? DateTime.now(),
      updatedAt: parseDate(json['updatedAt']) ?? DateTime.now(),
    );
  }
}

/// A user notification — mirrors `docs/api/openapi.yaml` `Notification`
/// (Prisma model `Notification`). `GET /notifications` and
/// `PATCH /notifications/{id}/read` both return this shape.
///
/// Named `AppNotification` to avoid clashing with Flutter's `Notification`.
/// `payload` is free-form JSON that varies by [type] — Phase 1 does not parse
/// into it, so it is kept as a raw map.
class AppNotification {
  const AppNotification({
    required this.id,
    required this.userId,
    required this.type,
    required this.payload,
    required this.read,
    required this.createdAt,
    this.sentAt,
  });

  final String id;
  final String userId;
  final NotificationType type;
  final Map<String, dynamic> payload;
  final bool read;
  final DateTime createdAt;
  final DateTime? sentAt;

  /// `createdAt` เป็น required ใน `openapi.yaml` — ถ้าหาย/parse ไม่ได้ถือเป็น
  /// ข้อมูลเสีย throw แทนที่จะ fallback เป็น `DateTime.now()` เงียบๆ (เดิมทำแบบนั้น
  /// — backend เรียง createdAt desc มาให้แล้ว ค่าปลอมจะทำให้ลำดับรายการเพี้ยน
  /// แบบไม่มีใครรู้) ต่างจาก field อื่นที่ optional ตาม spec — record ที่หลุดผ่าน
  /// [ApiClient.listNotifications] ถูก [ApiClient._wrapList] ดัก skip + log
  /// warning ให้เอง (issue #82 ข้อ 2)
  factory AppNotification.fromJson(Map<String, dynamic> json) {
    DateTime? parseDate(Object? value) =>
        value is String ? DateTime.tryParse(value) : null;

    final createdAt = parseDate(json['createdAt']);
    if (createdAt == null) {
      throw ArgumentError.value(
        json['createdAt'],
        'createdAt',
        'AppNotification.createdAt หาย/parse ไม่ได้',
      );
    }

    return AppNotification(
      id: json['id'] as String,
      userId: json['userId'] as String? ?? '',
      type: NotificationType.fromWire(json['type'] as String),
      payload: (json['payload'] as Map?)?.cast<String, dynamic>() ?? const {},
      read: json['read'] as bool? ?? false,
      createdAt: createdAt,
      sentAt: parseDate(json['sentAt']),
    );
  }

  AppNotification copyWith({bool? read}) => AppNotification(
    id: id,
    userId: userId,
    type: type,
    payload: payload,
    read: read ?? this.read,
    createdAt: createdAt,
    sentAt: sentAt,
  );
}
