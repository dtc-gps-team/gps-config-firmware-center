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
  incidentAlert('incident_alert');

  const NotificationType(this.wireName);

  final String wireName;

  static NotificationType fromWire(String value) {
    for (final type in NotificationType.values) {
      if (type.wireName == value) return type;
    }
    throw ArgumentError.value(value, 'value', 'Unknown notification type');
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
    this.deviceModel,
    this.protocol,
    this.status,
    this.fields,
  });

  final String? id;
  final String? deviceModel;
  final String? protocol;
  final ConfigStatus? status;
  final Map<String, dynamic>? fields;

  factory DeviceConfigDraft.fromJson(Map<String, dynamic> json) {
    final rawStatus = json['status'] as String?;
    return DeviceConfigDraft(
      id: json['id'] as String?,
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
