/// Data models mirroring `docs/api/openapi.yaml` (v0.1.0) exactly.
///
/// Keep field names, nullability and enum values in sync with the spec.
library;

/// `LoginResponse.role` enum — the 6 values in the API contract on `main`
/// (see the RBAC Matrix). No mobile-only role exists; field staff log in as
/// ST or OT.
enum UserRole {
  sw('SW'),
  operation('Operation'),
  st('ST'),
  ot('OT'),
  auditor('Auditor'),
  admin('Admin');

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

/// `Notification.type` enum — matches `docs/api/openapi.yaml` `Notification.type`
/// and the Prisma `NotificationType` enum.
enum NotificationType {
  taskAssigned('task_assigned'),
  configApproved('config_approved'),
  configRejected('config_rejected'),
  firmwareReady('firmware_ready'),
  incidentAlert('incident_alert'),
  configDeletionPending('config_deletion_pending'),
  configDeletionGrace('config_deletion_grace');

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
  resolved('resolved');

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

/// Central shape both the config form and JSON import map into.
class DeviceConfigDraft {
  const DeviceConfigDraft({
    this.id,
    this.name,
    this.deviceModel,
    this.protocol,
    this.status,
    this.fields,
  });

  final String? id;

  /// ชื่อ Config ที่ผู้ใช้ตั้ง — unique ทั้งระบบ (มติ Sprint 1 review ข้อ 4).
  /// Nullable ฝั่ง client เผื่อ response เก่า/mock ที่ไม่มี field นี้.
  final String? name;
  final String? deviceModel;
  final String? protocol;
  final ConfigStatus? status;
  final Map<String, dynamic>? fields;

  factory DeviceConfigDraft.fromJson(Map<String, dynamic> json) {
    final rawStatus = json['status'] as String?;
    return DeviceConfigDraft(
      id: json['id'] as String?,
      name: json['name'] as String?,
      deviceModel: json['deviceModel'] as String?,
      protocol: json['protocol'] as String?,
      status: rawStatus == null ? null : ConfigStatus.fromWire(rawStatus),
      fields: (json['fields'] as Map?)?.cast<String, dynamic>(),
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

/// `GET /devices/{deviceId}/status` response (`DeviceStatus`).
class DeviceStatus {
  const DeviceStatus({
    this.deviceId,
    this.configStatus,
    this.firmwareStatus,
    this.lastCheckInMessage,
  });

  final String? deviceId;
  final String? configStatus;
  final String? firmwareStatus;
  final String? lastCheckInMessage;

  factory DeviceStatus.fromJson(Map<String, dynamic> json) => DeviceStatus(
    deviceId: json['deviceId'] as String?,
    configStatus: json['configStatus'] as String?,
    firmwareStatus: json['firmwareStatus'] as String?,
    lastCheckInMessage: json['lastCheckInMessage'] as String?,
  );
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
  });

  final String id;
  final String deviceId;
  final String simNumber;
  final String deviceModel;
  final String protocol;
  final DeviceLifecycleStatus status;
  final DateTime registeredAt;
  final DateTime? installedAt;

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

  factory AppNotification.fromJson(Map<String, dynamic> json) {
    DateTime? parseDate(Object? value) =>
        value is String ? DateTime.tryParse(value) : null;

    return AppNotification(
      id: json['id'] as String,
      userId: json['userId'] as String? ?? '',
      type: NotificationType.fromWire(json['type'] as String),
      payload: (json['payload'] as Map?)?.cast<String, dynamic>() ?? const {},
      read: json['read'] as bool? ?? false,
      createdAt: parseDate(json['createdAt']) ?? DateTime.now(),
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
