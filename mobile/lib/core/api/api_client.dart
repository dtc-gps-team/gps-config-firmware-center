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
      throw ApiException(
        e.response?.statusMessage ?? e.message ?? 'Network error',
        statusCode: e.response?.statusCode,
      );
    }
  }
}
