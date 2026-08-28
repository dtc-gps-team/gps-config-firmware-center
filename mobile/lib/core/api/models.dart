/// Data models mirroring `docs/api/openapi.yaml` (v0.1.0) exactly.
///
/// Keep field names, nullability and enum values in sync with the spec.
library;

/// `LoginResponse.role` enum — **6 values only**, matching the API contract on
/// `main`. There is no `FieldTechnician` role (see RBAC Matrix / PR #13).
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
