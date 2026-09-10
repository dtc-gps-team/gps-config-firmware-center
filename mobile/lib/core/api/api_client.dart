import 'package:dio/dio.dart';

import '../config/app_config.dart';
import 'models.dart';

/// Thrown for any non-2xx response or transport error.
class ApiException implements Exception {
  ApiException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

  @override
  String toString() => 'ApiException(${statusCode ?? '-'}): $message';
}

/// Thin wrapper over Dio for the endpoints that exist in `openapi.yaml` today.
///
/// Only the handful of calls the Mobile app needs for Phase 1 are implemented;
/// add more as the spec grows.
class ApiClient {
  ApiClient({Dio? dio}) : _dio = dio ?? _defaultDio();

  final Dio _dio;

  static Dio _defaultDio() => Dio(
    BaseOptions(
      baseUrl: AppConfig.apiBaseUrl,
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 10),
      headers: {'Content-Type': 'application/json'},
    ),
  );

  /// Attach (or clear) the bearer token used for authenticated endpoints.
  void setAuthToken(String? token) {
    if (token == null) {
      _dio.options.headers.remove('Authorization');
    } else {
      _dio.options.headers['Authorization'] = 'Bearer $token';
    }
  }

  /// `POST /auth/login`
  Future<LoginResponse> login(LoginRequest request) async {
    return _wrap(
      () => _dio.post<Map<String, dynamic>>(
        '/auth/login',
        data: request.toJson(),
      ),
      LoginResponse.fromJson,
    );
  }

  /// `GET /config` — not scoped per-user by the backend (every role with
  /// `config:Read` sees every Config, deliberately — see
  /// `backend/src/config/config.service.ts` `findAll()`).
  Future<List<DeviceConfigDraft>> listConfigs() async {
    return _wrapList(
      () => _dio.get<List<dynamic>>('/config'),
      DeviceConfigDraft.fromJson,
    );
  }

  /// `POST /config/{configId}/simulate`
  Future<SimulationResult> simulateConfig({
    required String configId,
    String? deviceModel,
  }) async {
    final body = <String, dynamic>{};
    if (deviceModel != null) body['deviceModel'] = deviceModel;
    return _wrap(
      () => _dio.post<Map<String, dynamic>>(
        '/config/$configId/simulate',
        data: body,
      ),
      SimulationResult.fromJson,
    );
  }

  /// `POST /devices/{deviceId}/simulate-config` — readiness check เต็มรูปแบบ
  /// (config_simulator Phase 2): รวม config + compatibility + connection check
  /// เป็นผลเดียว ต่างจาก [simulateConfig] (Phase 1) ที่เช็คแค่ตัว Config เอง.
  /// `deviceId` คือ `Device.deviceId` (เลขเครื่องจริง) ไม่ใช่ Prisma id.
  Future<DeviceSimulateConfigResult> simulateConfigOnDevice({
    required String deviceId,
    required String configId,
  }) async {
    return _wrap(
      () => _dio.post<Map<String, dynamic>>(
        '/devices/$deviceId/simulate-config',
        data: {'configId': configId},
      ),
      DeviceSimulateConfigResult.fromJson,
    );
  }

  /// `GET /tasks` — self-scoped to the caller by the backend for ST/OT roles.
  Future<List<Task>> listTasks() async {
    return _wrapList(() => _dio.get<List<dynamic>>('/tasks'), Task.fromJson);
  }

  /// `GET /tasks/{taskId}`
  Future<Task> getTask(String taskId) async {
    return _wrap(
      () => _dio.get<Map<String, dynamic>>('/tasks/$taskId'),
      Task.fromJson,
    );
  }

  /// `PATCH /tasks/{taskId}` — partial update. Mobile only ever changes
  /// `status` (ST/OT are limited to that field by the backend).
  Future<Task> updateTaskStatus(String taskId, TaskStatus status) async {
    return _wrap(
      () => _dio.patch<Map<String, dynamic>>(
        '/tasks/$taskId',
        data: {'status': status.wireName},
      ),
      Task.fromJson,
    );
  }

  /// `GET /incidents` — read-only. Every logged-in role may call it
  /// (RBAC_Matrix.md "Incident & Rollback" = R for every role). No query
  /// params: returns every incident, backend sorts `createdAt` desc.
  Future<List<Incident>> listIncidents() async {
    return _wrapList(
      () => _dio.get<List<dynamic>>('/incidents'),
      Incident.fromJson,
    );
  }

  /// `GET /notifications` — always scoped to the caller by the backend (every
  /// role). Pass `unread: true` for `?unread=true`.
  Future<List<AppNotification>> listNotifications({bool? unread}) async {
    return _wrapList(
      () => _dio.get<List<dynamic>>(
        '/notifications',
        queryParameters: unread == null ? null : {'unread': unread},
      ),
      AppNotification.fromJson,
    );
  }

  /// `PATCH /notifications/{notificationId}/read` — marks it read (`read=true`).
  Future<AppNotification> markNotificationRead(String notificationId) async {
    return _wrap(
      () => _dio.patch<Map<String, dynamic>>(
        '/notifications/$notificationId/read',
      ),
      AppNotification.fromJson,
    );
  }

  /// `GET /devices` — Device Search. Every logged-in role may call it
  /// (RBAC_Matrix.md §2 "Device Search / Device Detail" = R for every role).
  /// No query params: returns every device. Mobile filters/searches client-side
  /// like Web does (the list is small in the MVP).
  Future<List<Device>> listDevices() async {
    return _wrapList(
      () => _dio.get<List<dynamic>>('/devices'),
      Device.fromJson,
    );
  }

  /// `GET /devices/{deviceId}` — Device Detail. Keyed by `Device.deviceId`
  /// (the real hardware number), not the internal UUID. 404 when not found.
  Future<Device> getDevice(String deviceId) async {
    return _wrap(
      () => _dio.get<Map<String, dynamic>>('/devices/$deviceId'),
      Device.fromJson,
    );
  }

  /// `GET /devices/{deviceId}/status`
  Future<DeviceStatus> getDeviceStatus(String deviceId) async {
    return _wrap(
      () => _dio.get<Map<String, dynamic>>('/devices/$deviceId/status'),
      DeviceStatus.fromJson,
    );
  }

  /// `POST /devices/{deviceId}/test-connection` — no request body.
  Future<DeviceConnectionTestResult> testDeviceConnection(
    String deviceId,
  ) async {
    return _wrap(
      () =>
          _dio.post<Map<String, dynamic>>('/devices/$deviceId/test-connection'),
      DeviceConnectionTestResult.fromJson,
    );
  }

  /// `POST /notifications/device-tokens` — upsert (200, not 201; idempotent
  /// on repeat calls with the same token). Response body is the stored
  /// `DeviceToken` row, but callers here (`PushTokenRepository`) only care
  /// that the call succeeded — no model to parse into yet.
  Future<void> registerDeviceToken({
    required String token,
    required String platform,
  }) async {
    try {
      await _dio.post<Map<String, dynamic>>(
        '/notifications/device-tokens',
        data: {'token': token, 'platform': platform},
      );
    } on DioException catch (e) {
      throw _toApiException(e);
    }
  }

  /// `DELETE /notifications/device-tokens?token=<token>` — 204, no body.
  Future<void> unregisterDeviceToken(String token) async {
    try {
      await _dio.delete<void>(
        '/notifications/device-tokens',
        queryParameters: {'token': token},
      );
    } on DioException catch (e) {
      throw _toApiException(e);
    }
  }

  Future<T> _wrap<T>(
    Future<Response<Map<String, dynamic>>> Function() send,
    T Function(Map<String, dynamic> json) parse,
  ) async {
    try {
      final response = await send();
      final body = response.data;
      if (body == null) {
        throw ApiException(
          'Empty response body',
          statusCode: response.statusCode,
        );
      }
      return parse(body);
    } on DioException catch (e) {
      throw _toApiException(e);
    }
  }

  /// Same as [_wrap] but for endpoints that return a JSON array. Non-object
  /// entries are skipped defensively.
  Future<List<T>> _wrapList<T>(
    Future<Response<List<dynamic>>> Function() send,
    T Function(Map<String, dynamic> json) parse,
  ) async {
    try {
      final response = await send();
      final body = response.data ?? const <dynamic>[];
      return body
          .whereType<Map>()
          .map((e) => parse(e.cast<String, dynamic>()))
          .toList(growable: false);
    } on DioException catch (e) {
      throw _toApiException(e);
    }
  }

  static ApiException _toApiException(DioException e) => ApiException(
    _messageFromResponse(e.response) ??
        e.response?.statusMessage ??
        _transportErrorMessage(e.type) ??
        'เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง',
    statusCode: e.response?.statusCode,
  );

  /// Thai, user-facing text for transport-level failures where there is no
  /// HTTP response to read a message from (backend unreachable, timed out,
  /// etc). `DioException.message` for these is a raw diagnostic string aimed
  /// at developers/logs (e.g. "The connection errored: Connection refused
  /// This indicates an error which most likely cannot be solved by the
  /// library."), not something to show a field technician — every page that
  /// falls through to `ApiException.message` (task detail, task list,
  /// notifications, ...) was leaking that raw string before this existed.
  static String? _transportErrorMessage(DioExceptionType type) {
    switch (type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
      case DioExceptionType.transformTimeout:
      case DioExceptionType.connectionError:
        return 'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ต/เซิร์ฟเวอร์แล้วลองใหม่อีกครั้ง';
      case DioExceptionType.badCertificate:
      case DioExceptionType.badResponse:
      case DioExceptionType.cancel:
      case DioExceptionType.unknown:
        return null;
    }
  }

  /// Prefer the backend's JSON `message` field (localized, user-facing text)
  /// over the raw HTTP reason phrase. Defensive: `response.data` is not always
  /// a `Map` — it can be a plain string, `null`, or HTML when the body isn't
  /// the expected JSON error shape, so anything unexpected falls through to the
  /// existing `statusMessage`/`message` fallbacks.
  static String? _messageFromResponse(Response<dynamic>? response) {
    final data = response?.data;
    if (data is Map) {
      final message = data['message'];
      if (message is String && message.isNotEmpty) return message;
    }
    return null;
  }
}
