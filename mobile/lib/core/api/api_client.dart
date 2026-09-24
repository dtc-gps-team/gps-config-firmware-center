import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart' show debugPrint;

import '../config/app_config.dart';
import 'models.dart';

/// Thrown for any non-2xx response or transport error.
class ApiException implements Exception {
  ApiException(this.message, {this.statusCode, this.details = const []});

  final String message;
  final int? statusCode;

  /// รายการ error ย่อย (เช่น backend `validateOverridableFields` ที่ส่ง
  /// `{ message, errors: string[] }`) — mirror `ApiError.details` ฝั่ง Web
  /// (`web/src/lib/api.ts`) ว่างเปล่าถ้า response ไม่มี `errors` array.
  final List<String> details;

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
    return _wrapListStrict(
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
  /// **Strict** on purpose (see [_wrapListStrict]) — a Task that fails to
  /// parse (e.g. the backend adds a new `TaskStatus` value this build
  /// doesn't know yet) must surface as a visible error, not silently vanish
  /// from an ST/OT's work list.
  Future<List<Task>> listTasks() async {
    return _wrapListStrict(
      () => _dio.get<List<dynamic>>('/tasks'),
      Task.fromJson,
    );
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
    return _wrapListStrict(
      () => _dio.get<List<dynamic>>('/incidents'),
      Incident.fromJson,
    );
  }

  /// `GET /notifications` — always scoped to the caller by the backend (every
  /// role). Pass `unread: true` for `?unread=true`. **Lenient** on purpose
  /// (see [_wrapListLenient]) — notifications are best-effort/non-critical,
  /// unlike Task/Device/Config/Customer/Incident data.
  Future<List<AppNotification>> listNotifications({bool? unread}) async {
    return _wrapListLenient(
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
  /// `customerId` (issue #204) filters server-side to one company's devices —
  /// omit it to get every device (Mobile filters/searches client-side
  /// elsewhere, like Web does, since the list is small in the MVP).
  Future<List<Device>> listDevices({String? customerId}) async {
    return _wrapListStrict(
      () => _dio.get<List<dynamic>>(
        '/devices',
        queryParameters: customerId != null ? {'customerId': customerId} : null,
      ),
      Device.fromJson,
    );
  }

  /// `GET /customers` — every logged-in role may call it (no PermissionGuard,
  /// mirrors `GET /users`). Feeds the "เลือกบริษัท" step of the ทดสอบสัญญาณ
  /// flow (issue #204).
  Future<List<Customer>> listCustomers() async {
    return _wrapListStrict(
      () => _dio.get<List<dynamic>>('/customers'),
      Customer.fromJson,
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

  /// `GET /devices/{deviceId}/config` — Config ปัจจุบันของอุปกรณ์ (Config
  /// Override Phase 2, issue #211). 404 ถ้าอุปกรณ์ไม่มี Task สถานะ `completed`
  /// ที่ผูก `configId` ไว้เลย (ยังไม่เคย confirm install).
  Future<DeviceConfigDraft> getDeviceCurrentConfig(String deviceId) async {
    return _wrap(
      () => _dio.get<Map<String, dynamic>>('/devices/$deviceId/config'),
      DeviceConfigDraft.fromJson,
    );
  }

  /// `POST /devices/{deviceId}/config-override` — Per-device Config Override
  /// (issue #223) — ST ส่ง**คำขอ**แก้ค่าบาง field ของ Config ปัจจุบันของ
  /// **อุปกรณ์เครื่องนี้เครื่องเดียว** ไม่กระทบอุปกรณ์อื่นที่ใช้ Config เดียวกัน
  /// (ต่างจาก `POST /config/{configId}/override` เดิม — issue #185 — ที่แก้
  /// `Config.fields` ทั้งชุดทันที; Mobile เปลี่ยนมาเรียก endpoint นี้ตั้งแต่
  /// #223 เป็นต้นไป ไม่ใช้ endpoint เดิมอีกแล้ว). `fields` เป็น partial update
  /// — ใส่แค่ field ที่แก้ ทุก key ต้อง `stOverridable: true` ไม่งั้น 400.
  ///
  /// **มติ 2026-09-24 (PR #225):** response คืนคำขอที่เพิ่งสร้าง (สถานะ
  /// `pending` เสมอ) **ไม่ใช่** Config ที่ merge แล้ว — ยังไม่มีผลจนกว่า
  /// Operation จะอนุมัติผ่าน endpoint แยก (ยังไม่เรียกจาก Mobile ในรอบนี้ —
  /// ฝั่ง Operation อนุมัติผ่านช่องทางอื่น)
  Future<DeviceConfigOverride> overrideDeviceConfig({
    required String deviceId,
    required Map<String, dynamic> fields,
    required String reason,
  }) async {
    return _wrap(
      () => _dio.post<Map<String, dynamic>>(
        '/devices/$deviceId/config-override',
        data: {'fields': fields, 'reason': reason},
      ),
      DeviceConfigOverride.fromJson,
    );
  }

  /// `GET /config-definitions` — คลัง field ที่ระบบรู้จัก ใช้เช็คว่า field ไหน
  /// `stOverridable: true` บ้างก่อนแสดงหน้า Config Override (issue #211).
  Future<List<ConfigFieldDefinition>> listConfigDefinitions() async {
    return _wrapListStrict(
      () => _dio.get<List<dynamic>>('/config-definitions'),
      ConfigFieldDefinition.fromJson,
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

  /// `POST /devices/{deviceId}/apply-config` — ส่ง Config ที่ผูกกับ Task ให้
  /// อุปกรณ์ที่ติดตั้งจริง (Confirm Install, Sprint 3). `deviceId` คือ
  /// `Device.deviceId` (เลขเครื่องจริง) ไม่ใช่ Prisma id — เหมือน
  /// [simulateConfigOnDevice]. Fire-and-forget: `200` เสมอเมื่อ request ผ่าน
  /// validation (`applied: false` ใน response ไม่ใช่ HTTP error — ดู
  /// [ConfigApplyResult]) ส่วน 404/409 คือ error จริง (ไม่พบ device/config,
  /// device ยังไม่ installed, config ยังไม่อนุมัติ, หรือรุ่น/โปรโตคอลไม่ตรง).
  Future<ConfigApplyResult> applyConfigToDevice({
    required String deviceId,
    required String configId,
  }) async {
    return _wrap(
      () => _dio.post<Map<String, dynamic>>(
        '/devices/$deviceId/apply-config',
        data: {'configId': configId},
      ),
      ConfigApplyResult.fromJson,
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

  /// Same as [_wrap] but for endpoints that return a JSON array — **strict**:
  /// any entry that isn't a JSON object, or any entry whose [parse] throws,
  /// fails the whole call (same all-or-nothing behavior as [_wrap] itself).
  ///
  /// Used by every list endpoint except [listNotifications] — Task/Device/
  /// Config/Customer/Incident data backs decisions ST/OT/Operation make on
  /// real work (e.g. which job to do next), so one record that can't be
  /// parsed should surface as a visible, retry-able error instead of
  /// silently vanishing from the list. This app has no Sentry/Crashlytics —
  /// a silently-skipped record here is a silently-lost bug report.
  Future<List<T>> _wrapListStrict<T>(
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

  /// Same as [_wrapListStrict] but **lenient**: non-object entries are
  /// skipped defensively, and so is any entry whose [parse] throws (e.g.
  /// `NotificationType.fromWire` hitting a type the app doesn't know about
  /// yet) — one bad record shouldn't take down the whole list (issue #82).
  /// Logged via [debugPrint] so it's visible during dev/QA without
  /// surfacing an error to the user for what is, from their POV, a list
  /// that's simply missing one item.
  ///
  /// **Only [listNotifications] uses this.** Every other list endpoint uses
  /// [_wrapListStrict] instead — notifications are best-effort/non-critical
  /// (a missing one isn't a blocker to getting work done), which is not
  /// true of Task/Device/Config/Customer/Incident data.
  Future<List<T>> _wrapListLenient<T>(
    Future<Response<List<dynamic>>> Function() send,
    T Function(Map<String, dynamic> json) parse,
  ) async {
    try {
      final response = await send();
      final body = response.data ?? const <dynamic>[];
      final out = <T>[];
      for (final e in body.whereType<Map>()) {
        try {
          out.add(parse(e.cast<String, dynamic>()));
        } catch (err) {
          debugPrint(
            'ApiClient._wrapListLenient: skip record ที่ parse ไม่ได้ — $err',
          );
        }
      }
      return out;
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
    details: _detailsFromResponse(e.response),
  );

  /// backend `validateFields`/`validateOverridableFields` ส่ง
  /// `{ message, errors: string[] }` — flatten เป็น `List<String>` เสมอ (mirror
  /// `errorsFromBody` ฝั่ง Web `api.ts`) ว่างเปล่าถ้าไม่มี `errors` array หรือ
  /// entry ไม่ใช่ string (เช่น class-validator ที่ยังไม่เจอ shape นี้ในระบบนี้).
  static List<String> _detailsFromResponse(Response<dynamic>? response) {
    final data = response?.data;
    if (data is! Map) return const [];
    final errors = data['errors'];
    if (errors is! List) return const [];
    if (errors.every((e) => e is String)) {
      return errors.cast<String>();
    }
    return const [];
  }

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
