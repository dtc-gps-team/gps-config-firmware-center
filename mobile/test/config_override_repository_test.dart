import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/features/config_override/config_override_repository.dart';

/// `ApiClient` error-mapping is already covered end-to-end in
/// `api_client_test.dart` — this fake just proves `ApiConfigOverrideRepository`
/// forwards to the right `ApiClient` method with the right arguments.
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
  group('MockConfigOverrideRepository', () {
    test('getCurrentConfig -> คืน Config ที่มี field ให้แก้', () async {
      final repo = MockConfigOverrideRepository();

      final config = await repo.getCurrentConfig('DEV-0117');

      expect(config.fields, isNotNull);
      expect(config.fields!.containsKey('APN'), isTrue);
    });

    test(
      'getCurrentConfig -> deviceId ว่าง -> ApiException 404 (mirror '
      'พฤติกรรม backend "อุปกรณ์นี้ยังไม่มี Config ที่ยืนยันติดตั้งแล้ว")',
      () async {
        final repo = MockConfigOverrideRepository();

        await expectLater(
          repo.getCurrentConfig(''),
          throwsA(isA<ApiException>().having((e) => e.statusCode, '', 404)),
        );
      },
    );

    test('listDefinitions -> มี field APN (stOverridable) และ '
        'COMMAND_PASSWORD (sensitive, ไม่ override ได้)', () async {
      final repo = MockConfigOverrideRepository();

      final defs = await repo.listDefinitions();

      final apn = defs.firstWhere((d) => d.fieldName == 'APN');
      final password = defs.firstWhere(
        (d) => d.fieldName == 'COMMAND_PASSWORD',
      );
      expect(apn.stOverridable, isTrue);
      expect(password.stOverridable, isFalse);
      expect(password.sensitive, isTrue);
    });

    test(
      'overrideConfig -> field stOverridable:true -> merge ค่าใหม่สำเร็จ, hasDeviceOverride:true',
      () async {
        final repo = MockConfigOverrideRepository();

        final after = await repo.overrideConfig(
          deviceId: 'DEV-0117',
          fields: {'APN': 'new-apn'},
          reason: 'ทดสอบ',
        );

        expect(after.fields!['APN'], 'new-apn');
        // field อื่นที่ไม่ได้แก้ยังอยู่ครบ (partial update)
        expect(after.fields!['REPORT_INTERVAL_MOVING'], isNotNull);
        expect(after.hasDeviceOverride, isTrue);
      },
    );

    test(
      'overrideConfig -> field stOverridable:false -> ApiException 400',
      () async {
        final repo = MockConfigOverrideRepository();

        await expectLater(
          repo.overrideConfig(
            deviceId: 'DEV-0117',
            fields: {'COMMAND_PASSWORD': 'x'},
            reason: 'ทดสอบ',
          ),
          throwsA(
            isA<ApiException>()
                .having((e) => e.statusCode, 'statusCode', 400)
                .having((e) => e.details, 'details', isNotEmpty),
          ),
        );
      },
    );

    test('overrideConfig -> reason ว่าง -> ApiException 400', () async {
      final repo = MockConfigOverrideRepository();

      await expectLater(
        repo.overrideConfig(
          deviceId: 'DEV-0117',
          fields: {'APN': 'x'},
          reason: '',
        ),
        throwsA(isA<ApiException>().having((e) => e.statusCode, '', 400)),
      );
    });
  });

  group('ApiConfigOverrideRepository', () {
    test('getCurrentConfig -> GET /devices/{deviceId}/config', () async {
      final recorder = _RecordingDio();
      final api = ApiClient(
        dio: recorder.build({
          'id': 'c1',
          'deviceModel': 'GT06N',
          'protocol': 'TCP',
          'status': 'approved',
          'fields': {'APN': 'internet'},
        }),
      );
      final repo = ApiConfigOverrideRepository(api);

      final config = await repo.getCurrentConfig('DEV-0117');

      expect(recorder.lastRequest?.method, 'GET');
      expect(recorder.lastRequest?.path, '/devices/DEV-0117/config');
      expect(config.id, 'c1');
    });

    test(
      'overrideConfig -> POST /devices/{deviceId}/config-override (issue #223)',
      () async {
        final recorder = _RecordingDio();
        final api = ApiClient(
          dio: recorder.build({
            'id': 'c1',
            'deviceModel': 'GT06N',
            'protocol': 'TCP',
            'status': 'approved',
            'fields': {'APN': 'new-apn'},
            'hasDeviceOverride': true,
          }),
        );
        final repo = ApiConfigOverrideRepository(api);

        final result = await repo.overrideConfig(
          deviceId: 'DEV-0117',
          fields: {'APN': 'new-apn'},
          reason: 'เหตุผล',
        );

        expect(recorder.lastRequest?.method, 'POST');
        expect(recorder.lastRequest?.path, '/devices/DEV-0117/config-override');
        expect(recorder.lastRequest?.data, {
          'fields': {'APN': 'new-apn'},
          'reason': 'เหตุผล',
        });
        expect(result.hasDeviceOverride, isTrue);
      },
    );
  });

  test('configOverrideRepositoryProvider ให้ ApiConfigOverrideRepository เมื่อ '
      'API_MOCK_MODE=false (ค่า default ตอนรันเทส — mirror regression guard '
      'ของ simulatorRepositoryProvider)', () {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    expect(
      container.read(configOverrideRepositoryProvider),
      isA<ApiConfigOverrideRepository>(),
    );
  });
}
