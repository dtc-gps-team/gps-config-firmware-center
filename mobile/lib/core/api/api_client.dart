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
  ApiClient({Dio? dio}) : _dio = dio ?? _defaultDio() {
    // UX audit #5 — 401 ของคำขอที่แนบ token = session หมดอายุ แจ้งที่เดียว
    // (AuthController.expireSession) ไม่ว่าคำขอมาจากหน้าไหนหรือจากคิว sync
    // · ผู้เรียกยังได้ ApiException(401) เหมือนเดิม คิว sync จึงจัดการ 401
    // ของตัวเอง (ตั้ง syncAuthExpired, เก็บรายการไว้ส่งใหม่) ต่อได้ตามเดิม
    _dio.interceptors.add(
      InterceptorsWrapper(
        onError: (e, handler) {
          if (_isExpiredSession(e)) onUnauthorized?.call();
          handler.next(e);
        },
      ),
    );
  }

  final Dio _dio;

  /// เรียกเมื่อคำขอที่แนบ token ได้ 401 — ตั้งโดย `AuthController`
  void Function()? onUnauthorized;

  /// 401 จาก `/auth/login` คือรหัสผิด ไม่ใช่ token หมดอายุ และคำขอที่ไม่ได้
  /// แนบ token ก็ไม่มี session ให้หมดอายุ
  static bool _isExpiredSession(DioException e) =>
      e.response?.statusCode == 401 &&
      e.requestOptions.path != '/auth/login' &&
      e.requestOptions.headers['Authorization'] != null;

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

  /// `POST /devices/{deviceId}/simulate-config` — readiness check เต็มรูปแบบ
  /// (config_simulator Phase 2): รวม config + compatibility + connection check
  /// เป็นผลเดียว ต่างจาก `POST /config/{configId}/simulate` (Phase 1) ที่เช็คแค่
  /// ตัว Config เอง (Mobile ไม่ได้เรียก endpoint นั้นแล้ว).
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
  ///
  /// [changedAt] is when the user actually made the change — the sync queue
  /// passes the time it was queued, so the task's timeline (issue #296) shows
  /// the tap time rather than the time the phone got back online. Omitted when
  /// null (backend then uses its own clock).
  Future<Task> updateTaskStatus(
    String taskId,
    TaskStatus status, {
    DateTime? changedAt,
  }) async {
    return _wrap(
      () => _dio.patch<Map<String, dynamic>>(
        '/tasks/$taskId',
        data: {
          'status': status.wireName,
          if (changedAt != null)
            'changedAt': changedAt.toUtc().toIso8601String(),
        },
      ),
      Task.fromJson,
    );
  }

  /// `GET /tasks/{taskId}/events` — the task's timeline, oldest first
  /// (issue #296). Same visibility as [getTask]. **Strict** like every other
  /// work-data list (see [_wrapListStrict]).
  Future<List<TaskEvent>> listTaskEvents(String taskId) async {
    return _wrapListStrict(
      () => _dio.get<List<dynamic>>('/tasks/$taskId/events'),
      TaskEvent.fromJson,
    );
  }

  /// `POST /tasks/{taskId}/notes` — adds a text note to the timeline without
  /// changing the status (issue #296). Needs the network: notes are not queued
  /// offline (docs/16 §7).
  Future<TaskEvent> addTaskNote(String taskId, String note) async {
    return _wrap(
      () => _dio.post<Map<String, dynamic>>(
        '/tasks/$taskId/notes',
        data: {'note': note},
      ),
      TaskEvent.fromJson,
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

  /// `GET /incidents/{id}` — read-only, every logged-in role (RBAC "R").
  /// 404 if the incident doesn't exist.
  Future<Incident> getIncident(String id) async {
    return _wrap(
      () => _dio.get<Map<String, dynamic>>('/incidents/$id'),
      Incident.fromJson,
    );
  }

  /// `POST /incidents` — ST/OT แจ้งปัญหาหน้างาน (Field Incident Report,
  /// issue #236, backend PR #267 — resource `incidents` action `Create`
  /// เฉพาะ ST/OT). `title`/`description` บังคับ, `severity`, `deviceId`
  /// (optional) →
  /// backend ตั้ง `status: open`, `source: 'field-report'`, `reportedBy` จาก
  /// JWT เอง (ห้ามส่งจาก client) · **ไม่ auto-pause/rollback** — Operation
  /// เป็นคนตัดสินใจเสมอ (`POST /incidents/{id}/decide` ฝั่ง Web ไม่ใช่ Mobile)
  /// shape ตรง `CreateIncidentInput` ใน openapi.yaml (v3.47)
  Future<Incident> createIncident({
    required String title,
    required String description,
    required IncidentSeverity severity,
    String? deviceId,
  }) async {
    return _wrap(
      () => _dio.post<Map<String, dynamic>>(
        '/incidents',
        data: {
          'title': title,
          'description': description,
          'severity': severity.wireName,
          'deviceId': ?deviceId,
        },
      ),
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

  /// `GET /devices/{deviceId}` — Device Detail. Keyed by `Device.deviceId`
  /// (the real hardware number), not the internal UUID. 404 when not found.
  Future<Device> getDevice(String deviceId) async {
    return _wrap(
      () => _dio.get<Map<String, dynamic>>('/devices/$deviceId'),
      Device.fromJson,
    );
  }

  /// `GET /devices/{deviceId}/status` — สถานะ Config/Firmware ของอุปกรณ์
  /// (เวอร์ชันย่อ, issue #245 / PR #247). Every logged-in role may call it;
  /// 404 when the device is not found.
  Future<DeviceStatus> getDeviceStatus(String deviceId) async {
    return _wrap(
      () => _dio.get<Map<String, dynamic>>('/devices/$deviceId/status'),
      DeviceStatus.fromJson,
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

  /// `GET /firmware` — ทุก Role อ่านได้ (resource `firmware` action `Read`)
  /// ใช้เลือก Firmware ในหน้า Firmware Override (issue #256). **Strict**
  /// เหมือน Task/Device — record ที่ parse ไม่ได้ต้องขึ้น error ไม่ใช่หายเงียบ
  Future<List<Firmware>> listFirmware() async {
    return _wrapListStrict(
      () => _dio.get<List<dynamic>>('/firmware'),
      Firmware.fromJson,
    );
  }

  /// `POST /devices/{deviceId}/firmware-override` (issue #256, PR #257) — ST
  /// เท่านั้น ขอให้อุปกรณ์เครื่องนี้ติดตั้ง Firmware ที่ไม่ตรงกับแผน Campaign
  /// ได้ · คืนคำขอสถานะ `pending` เสมอ ยังไม่มีผลจนกว่า Operation อนุมัติ ·
  /// 409 = Firmware ยังติดตั้งไม่ได้ (ยังไม่ stored/approved/ไม่รองรับรุ่น)
  /// หรือเครื่องนี้มีคำขอ pending อยู่แล้ว (หน้าจอแสดง `ApiException.message`
  /// ที่ backend ส่งมาตรงๆ)
  Future<DeviceFirmwareOverride> overrideDeviceFirmware({
    required String deviceId,
    required String firmwareId,
    required String reason,
  }) async {
    return _wrap(
      () => _dio.post<Map<String, dynamic>>(
        '/devices/$deviceId/firmware-override',
        data: {'firmwareId': firmwareId, 'reason': reason},
      ),
      DeviceFirmwareOverride.fromJson,
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

  /// `GET /tasks/{taskId}/config-apply-requests` — คำขอส่ง Config ทั้งหมดของ
  /// งานนี้ ใหม่สุดก่อน (docs/25 §3.3) · กฎการเห็นเดียวกับ `GET /tasks/{id}` ·
  /// strict เหมือน [listTasks]: สถานะใหม่ที่ build นี้ไม่รู้จักต้องเป็น error ที่
  /// มองเห็น ไม่ใช่หายไปเงียบๆ แล้วปุ่ม "ขอส่ง" โผล่ทั้งที่มีคำขอค้างอยู่
  Future<List<ConfigApplyRequest>> listTaskConfigApplyRequests(
    String taskId,
  ) async {
    return _wrapListStrict(
      () => _dio.get<List<dynamic>>('/tasks/$taskId/config-apply-requests'),
      ConfigApplyRequest.fromJson,
    );
  }

  /// `POST /tasks/{taskId}/config-apply-requests` — ช่างขอส่ง Config ของงาน
  /// เข้าเครื่องจริง (docs/25 §3.3) · **ไม่ส่ง configId/deviceId** backend อ่าน
  /// จาก Task เอง · 409 หลายกรณี (งานไม่ได้ in_progress, ไม่มีผู้ผูก Config,
  /// มีคำขอค้าง, Campaign กำลังส่งให้เครื่องนี้ ฯลฯ) ข้อความจาก backend ใช้แสดงได้
  Future<ConfigApplyRequest> createConfigApplyRequest(
    String taskId, {
    String? note,
  }) async {
    return _wrap(
      () => _dio.post<Map<String, dynamic>>(
        '/tasks/$taskId/config-apply-requests',
        data: {'note': ?note},
      ),
      ConfigApplyRequest.fromJson,
    );
  }

  /// `POST /config-apply-requests/{id}/cancel` — ช่างที่ถือ Task ยกเลิกคำขอ
  /// `pending`/`approved` (docs/27 §5.5)
  Future<ConfigApplyRequest> cancelConfigApplyRequest(String requestId) async {
    return _wrap(
      () => _dio.post<Map<String, dynamic>>(
        '/config-apply-requests/$requestId/cancel',
      ),
      ConfigApplyRequest.fromJson,
    );
  }

  /// `POST /config-apply-requests/{id}/release` — ช่างที่ถือ Task กดส่งคำขอที่
  /// อนุมัติแล้วเข้ากล่อง (docs/27 §5.4) · 409 เมื่อกล่องออฟไลน์/หมดอายุ/Config
  /// เปลี่ยน ฯลฯ — ข้อความของ backend ใช้แสดงได้ตรงๆ · 503 = ติดต่อ Server กลางไม่ได้
  Future<ConfigApplyRequest> releaseConfigApplyRequest(String requestId) async {
    return _wrap(
      () => _dio.post<Map<String, dynamic>>(
        '/config-apply-requests/$requestId/release',
      ),
      ConfigApplyRequest.fromJson,
    );
  }

  /// `POST /devices/{deviceId}/confirm-firmware-install` (issue #261) — ST/OT
  /// ยืนยันว่าติดตั้ง Firmware เข้าเครื่องเสร็จแล้ว · **ไม่ได้ส่งอะไรไปที่
  /// อุปกรณ์** แค่บันทึก AuditLog (ไม่คำนวณ `Firmware.deviceUpdateStatus`) ·
  /// 409 หลายกรณี: Device ยังไม่ installed / Firmware ยังไม่ stored หรือ
  /// approved / ไม่รองรับรุ่น / ไม่ตรงแผน Campaign Rollout และไม่มี Firmware
  /// Override ที่ approved และยังไม่ถูกใช้ (override ใช้ได้ครั้งเดียว) — ดู
  /// `ApiException.message` ที่ backend ส่งมา
  ///
  /// [rolloutId] = `DeviceStatus.firmwareRolloutId` (issue #265) — ส่งเฉพาะ
  /// ตอนมีค่า เหมือน [applyConfigToDevice]
  Future<ConfirmFirmwareInstallResult> confirmFirmwareInstall({
    required String deviceId,
    required String firmwareId,
    String? rolloutId,
  }) async {
    return _wrap(
      () => _dio.post<Map<String, dynamic>>(
        '/devices/$deviceId/confirm-firmware-install',
        data: {'firmwareId': firmwareId, 'rolloutId': ?rolloutId},
      ),
      ConfirmFirmwareInstallResult.fromJson,
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
        throw ApiException(emptyBodyMessage, statusCode: response.statusCode);
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

  /// UX audit #13 — 5xx (backend พัง / proxy ตอบ Bad Gateway) ข้อความใน body
  /// เป็นข้อความเทคนิคภาษาอังกฤษ ("Internal server error", HTML ของ proxy)
  /// ไม่ใช่ข้อความสำหรับช่าง จึงแทนด้วยข้อความไทยที่บอกว่าทำอะไรต่อเสมอ
  /// (backend ไม่มี endpoint ที่ Mobile เรียกจงใจส่งข้อความ 5xx ให้ผู้ใช้อ่าน)
  static const serverErrorMessage =
      'เซิร์ฟเวอร์ขัดข้องชั่วคราว กรุณาลองใหม่อีกสักครู่';

  /// Response 2xx ที่ไม่มี body ให้ parse — แทน "Empty response body" (UX audit #13)
  static const emptyBodyMessage =
      'เซิร์ฟเวอร์ตอบกลับไม่สมบูรณ์ กรุณาลองใหม่อีกสักครู่';

  static ApiException _toApiException(DioException e) => ApiException(
    ((e.response?.statusCode ?? 0) >= 500 ? serverErrorMessage : null) ??
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
