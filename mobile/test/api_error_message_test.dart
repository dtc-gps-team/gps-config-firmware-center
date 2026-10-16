import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/auth/auth_controller.dart';
import 'package:mobile/features/device_search/device_detail_page.dart';
import 'package:mobile/features/device_search/device_search_repository.dart';
import 'package:mobile/features/device_search/device_status_repository.dart';

// UX audit #13 — error 5xx และ response body ว่าง ต้องเป็นข้อความไทยที่บอกว่า
// ทำอะไรต่อ ไม่ใช่ข้อความดิบภาษาอังกฤษจาก backend/proxy ("Internal server
// error", "Bad Gateway", "Empty response body")

const _serverError = 'เซิร์ฟเวอร์ขัดข้องชั่วคราว กรุณาลองใหม่อีกสักครู่';
const _emptyBody = 'เซิร์ฟเวอร์ตอบกลับไม่สมบูรณ์ กรุณาลองใหม่อีกสักครู่';

/// ตอบทุกคำขอด้วย [statusCode] + [body] ตามที่กำหนด (body เป็น string ดิบ)
class _Adapter implements HttpClientAdapter {
  _Adapter(this.statusCode, this.body, {this.contentType});

  final int statusCode;
  final String body;
  final String? contentType;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async => ResponseBody.fromString(
    body,
    statusCode,
    statusMessage: switch (statusCode) {
      500 => 'Internal Server Error',
      502 => 'Bad Gateway',
      503 => 'Service Unavailable',
      _ => null,
    },
    headers: {
      Headers.contentTypeHeader: [contentType ?? Headers.jsonContentType],
    },
  );

  @override
  void close({bool force = false}) {}
}

ApiClient _client(int statusCode, String body, {String? contentType}) =>
    ApiClient(
      dio: Dio(BaseOptions(baseUrl: 'http://test.local'))
        ..httpClientAdapter = _Adapter(
          statusCode,
          body,
          contentType: contentType,
        ),
    );

Matcher _apiError(int? code, String message) => throwsA(
  isA<ApiException>()
      .having((e) => e.statusCode, 'statusCode', code)
      .having((e) => e.message, 'message', message),
);

class _FakeAuth extends AuthController {
  @override
  AuthState build() =>
      const AuthState(status: AuthStatus.authenticated, role: UserRole.ot);
}

class _FakeStatusRepository implements DeviceStatusRepository {
  @override
  Future<DeviceStatus> getDeviceStatus(String deviceId) async => DeviceStatus(
    deviceId: deviceId,
    configStatus: DevicePayloadStatus.unknown,
    firmwareStatus: DevicePayloadStatus.unknown,
  );
}

Future<void> _pumpDeviceDetail(WidgetTester tester, ApiClient client) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        deviceSearchRepositoryProvider.overrideWithValue(
          ApiDeviceSearchRepository(client),
        ),
        deviceStatusRepositoryProvider.overrideWithValue(
          _FakeStatusRepository(),
        ),
        authControllerProvider.overrideWith(_FakeAuth.new),
      ],
      child: const MaterialApp(home: DeviceDetailPage(deviceId: 'DEV-1')),
    ),
  );
  for (var i = 0; i < 5; i++) {
    await tester.pump(const Duration(milliseconds: 50));
  }
}

void main() {
  group('ข้อความ error ที่ผู้ใช้เห็น (UX audit #13)', () {
    test(
      '500 พร้อม message อังกฤษจาก backend -> ข้อความไทย, statusCode คงเดิม',
      () {
        expect(
          _client(
            500,
            jsonEncode({'statusCode': 500, 'message': 'Internal server error'}),
          ).getDevice('DEV-1'),
          _apiError(500, _serverError),
        );
      },
    );

    test('502 จาก proxy (body เป็น HTML) -> ข้อความไทย', () {
      expect(
        _client(
          502,
          '<html><body>502 Bad Gateway</body></html>',
          contentType: 'text/html',
        ).getDevice('DEV-1'),
        _apiError(502, _serverError),
      );
    });

    test('503 ไม่มี body -> ข้อความไทย', () {
      expect(_client(503, '').getDevice('DEV-1'), _apiError(503, _serverError));
    });

    test('200 แต่ body ว่าง -> ข้อความไทย (ไม่ใช่ "Empty response body")', () {
      expect(_client(200, '').getDevice('DEV-1'), _apiError(200, _emptyBody));
    });

    test('401 ยังเป็น 401 ข้อความเดิม ไม่ถูกจับเป็น error 5xx', () {
      expect(
        _client(
          401,
          jsonEncode({'statusCode': 401, 'message': 'Unauthorized'}),
        ).getDevice('DEV-1'),
        _apiError(401, 'Unauthorized'),
      );
    });

    test('400 พร้อมข้อความไทยของ backend -> ใช้ข้อความ backend เหมือนเดิม', () {
      expect(
        _client(
          400,
          jsonEncode({'statusCode': 400, 'message': 'field "APN" ต้องไม่ว่าง'}),
        ).getDevice('DEV-1'),
        _apiError(400, 'field "APN" ต้องไม่ว่าง'),
      );
    });

    testWidgets(
      'หน้ารายละเอียดอุปกรณ์ได้ 500 -> เห็นข้อความไทย ไม่เห็นข้อความดิบ',
      (tester) async {
        await _pumpDeviceDetail(
          tester,
          _client(500, jsonEncode({'message': 'Internal server error'})),
        );

        expect(find.text(_serverError), findsOneWidget);
        expect(find.textContaining('Internal server error'), findsNothing);
      },
    );

    testWidgets('หน้ารายละเอียดอุปกรณ์ได้ body ว่าง -> เห็นข้อความไทย', (
      tester,
    ) async {
      await _pumpDeviceDetail(tester, _client(200, ''));

      expect(find.text(_emptyBody), findsOneWidget);
      expect(find.textContaining('Empty response body'), findsNothing);
    });
  });
}
