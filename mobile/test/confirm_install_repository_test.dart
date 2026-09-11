import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/features/task/confirm_install_repository.dart';

/// `ApiClient` error-mapping is already covered end-to-end in
/// `api_client_test.dart` — this fake just proves `ApiConfirmInstallRepository`
/// forwards to `applyConfigToDevice` with the right deviceId + configId.
class _RecordingDio {
  RequestOptions? lastRequest;

  Dio build(Object? body, {int statusCode = 200}) {
    final dio = Dio(BaseOptions(baseUrl: 'http://test.local'))
      ..httpClientAdapter = _FakeAdapter(this, body, statusCode: statusCode);
    return dio;
  }
}

class _FakeAdapter implements HttpClientAdapter {
  _FakeAdapter(this.recorder, this.body, {this.statusCode = 200});

  final _RecordingDio recorder;
  final Object? body;
  final int statusCode;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    recorder.lastRequest = options;
    return ResponseBody.fromString(
      jsonEncode(body),
      statusCode,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  group('ApiConfirmInstallRepository', () {
    test('applyConfig() -> POST /devices/{deviceId}/apply-config', () async {
      final recorder = _RecordingDio();
      final api = ApiClient(
        dio: recorder.build({
          'applied': true,
          'details': ['ส่ง Config 3 ฟิลด์ให้ DVC-7 แล้ว'],
          'appliedAt': '2026-09-11T10:00:00.000Z',
        }),
      );
      final repo = ApiConfirmInstallRepository(api);

      final result = await repo.applyConfig(
        deviceId: 'DVC-7',
        configId: 'cfg-42',
      );

      expect(recorder.lastRequest?.method, 'POST');
      expect(recorder.lastRequest?.path, '/devices/DVC-7/apply-config');
      expect(recorder.lastRequest?.data, {'configId': 'cfg-42'});
      expect(result.applied, isTrue);
      expect(result.details, ['ส่ง Config 3 ฟิลด์ให้ DVC-7 แล้ว']);
      expect(result.appliedAt, DateTime.utc(2026, 9, 11, 10));
    });

    test('applied: false (200, ค่า field ไม่ผ่าน pre-flight check)', () async {
      final recorder = _RecordingDio();
      final api = ApiClient(
        dio: recorder.build({
          'applied': false,
          'details': ['ฟิลด์ "Timeout" เป็นค่า Timeout/Interval ต้องไม่ติดลบ'],
          'appliedAt': '2026-09-11T10:00:00.000Z',
        }),
      );
      final repo = ApiConfirmInstallRepository(api);

      final result = await repo.applyConfig(
        deviceId: 'DVC-7',
        configId: 'cfg-42',
      );

      expect(result.applied, isFalse);
      expect(
        result.details,
        contains('ฟิลด์ "Timeout" เป็นค่า Timeout/Interval ต้องไม่ติดลบ'),
      );
    });

    test('409 (device ยังไม่ installed) -> ApiException', () async {
      final recorder = _RecordingDio();
      final api = ApiClient(
        dio: recorder.build({
          'message':
              'Device สถานะปัจจุบัน (registered) ยังใส่ Config ไม่ได้ — '
              'ต้องเป็น installed (ติดตั้งจริงแล้ว) เท่านั้น',
        }, statusCode: 409),
      );
      final repo = ApiConfirmInstallRepository(api);

      await expectLater(
        repo.applyConfig(deviceId: 'DVC-7', configId: 'cfg-42'),
        throwsA(
          isA<ApiException>()
              .having((e) => e.statusCode, 'statusCode', 409)
              .having(
                (e) => e.message,
                'message',
                contains('ยังใส่ Config ไม่ได้'),
              ),
        ),
      );
    });
  });

  test(
    'confirmInstallRepositoryProvider ให้ ApiConfirmInstallRepository เสมอ '
    '(ไม่มี mock — endpoint นี้มีความหมายเฉพาะกับ device/config จริงเท่านั้น)',
    () {
      final container = ProviderContainer();
      addTearDown(container.dispose);
      expect(
        container.read(confirmInstallRepositoryProvider),
        isA<ApiConfirmInstallRepository>(),
      );
    },
  );
}
