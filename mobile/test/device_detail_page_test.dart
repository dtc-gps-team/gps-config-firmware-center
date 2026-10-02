import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/auth/auth_controller.dart';
import 'package:mobile/features/device_search/device_detail_page.dart';
import 'package:mobile/features/device_search/device_search_repository.dart';
import 'package:mobile/features/device_search/device_status_repository.dart';

class _FakeAuthController extends AuthController {
  _FakeAuthController(this._role);

  final UserRole? _role;

  @override
  AuthState build() => AuthState(status: AuthStatus.authenticated, role: _role);
}

Device _makeDevice({
  DeviceLifecycleStatus status = DeviceLifecycleStatus.installed,
  DateTime? installedAt,
}) => Device(
  id: 'uuid-1',
  deviceId: 'DEV-0117',
  simNumber: '0812345678',
  deviceModel: 'GT06N',
  protocol: 'TCP',
  status: status,
  registeredAt: DateTime(2026, 6, 1, 9),
  installedAt: installedAt ?? DateTime(2026, 6, 3, 14, 30),
);

class _FakeDeviceSearchRepository implements DeviceSearchRepository {
  _FakeDeviceSearchRepository({Device? device, this.getError})
    : _device = device ?? _makeDevice();

  final Device _device;
  final Object? getError;

  @override
  Future<List<Device>> listDevices() async => [_device];

  @override
  Future<Device> getDevice(String deviceId) async {
    if (getError != null) throw getError!;
    return _device;
  }
}

class _FakeDeviceStatusRepository implements DeviceStatusRepository {
  _FakeDeviceStatusRepository({DeviceStatus? status, this.error})
    : _status = status ?? _makeStatus();

  final DeviceStatus _status;
  Object? error;
  final List<String> calls = [];

  @override
  Future<DeviceStatus> getDeviceStatus(String deviceId) async {
    calls.add(deviceId);
    if (error != null) throw error!;
    return _status;
  }
}

class _NeverCompletesStatusRepository implements DeviceStatusRepository {
  @override
  Future<DeviceStatus> getDeviceStatus(String deviceId) =>
      Completer<DeviceStatus>().future;
}

DeviceStatus _makeStatus({
  DevicePayloadStatus config = DevicePayloadStatus.unknown,
  DevicePayloadStatus firmware = DevicePayloadStatus.unknown,
  String? message,
}) => DeviceStatus(
  deviceId: 'DEV-0117',
  configStatus: config,
  firmwareStatus: firmware,
  lastCheckInMessage: message,
);

Future<void> _pump(
  WidgetTester tester, {
  required DeviceSearchRepository repo,
  DeviceStatusRepository? statusRepo,
  String deviceId = 'DEV-0117',
  UserRole? role,
}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        deviceSearchRepositoryProvider.overrideWithValue(repo),
        deviceStatusRepositoryProvider.overrideWithValue(
          statusRepo ?? _FakeDeviceStatusRepository(),
        ),
        authControllerProvider.overrideWith(() => _FakeAuthController(role)),
      ],
      child: MaterialApp(home: DeviceDetailPage(deviceId: deviceId)),
    ),
  );
  await tester.pump(); // resolve getDevice
}

void main() {
  _statusTests();

  testWidgets('โหลดสำเร็จ -> แสดง field ครบ', (tester) async {
    await _pump(
      tester,
      repo: _FakeDeviceSearchRepository(
        device: _makeDevice(status: DeviceLifecycleStatus.installed),
      ),
    );

    expect(find.text('DEV-0117'), findsOneWidget);
    expect(find.text('0812345678'), findsOneWidget);
    expect(find.text('GT06N'), findsOneWidget);
    expect(find.text('TCP'), findsOneWidget);
    // status label shows in the pill + the info row
    expect(find.text('ติดตั้งแล้ว'), findsWidgets);
    expect(find.text('01/06/2026 09:00'), findsOneWidget); // registeredAt
    expect(find.text('03/06/2026 14:30'), findsOneWidget); // installedAt
  });

  testWidgets('ยังไม่ติดตั้ง (installedAt null) -> แสดง —', (tester) async {
    await _pump(
      tester,
      repo: _FakeDeviceSearchRepository(
        device: Device(
          id: 'uuid-1',
          deviceId: 'DEV-0092',
          simNumber: '0899999999',
          deviceModel: 'GT06L',
          protocol: 'TCP',
          status: DeviceLifecycleStatus.registered,
          registeredAt: DateTime(2026, 8, 20, 10),
        ),
      ),
      deviceId: 'DEV-0092',
    );

    expect(find.text('DEV-0092'), findsOneWidget);
    expect(find.text('ลงทะเบียนแล้ว'), findsWidgets);
    expect(find.text('—'), findsOneWidget); // installedAt row
  });

  testWidgets('404 -> "ไม่พบอุปกรณ์นี้" + ปุ่มลองอีกครั้ง', (tester) async {
    await _pump(
      tester,
      repo: _FakeDeviceSearchRepository(
        getError: ApiException('not found', statusCode: 404),
      ),
    );

    expect(find.byKey(const Key('device_detail_error')), findsOneWidget);
    expect(find.text('ไม่พบอุปกรณ์นี้'), findsOneWidget);
    expect(find.byKey(const Key('device_detail_retry')), findsOneWidget);
  });

  testWidgets(
    'connection error (ไม่มี statusCode) -> ข้อความไทยอ่านได้ ไม่ใช่ raw',
    (tester) async {
      await _pump(
        tester,
        repo: _FakeDeviceSearchRepository(
          getError: ApiException(
            'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ต/เซิร์ฟเวอร์แล้วลองใหม่อีกครั้ง',
          ),
        ),
      );

      expect(find.byKey(const Key('device_detail_error')), findsOneWidget);
      expect(
        find.text(
          'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ต/เซิร์ฟเวอร์แล้วลองใหม่อีกครั้ง',
        ),
        findsOneWidget,
      );
      expect(find.byKey(const Key('device_detail_retry')), findsOneWidget);
    },
  );

  group('ปุ่ม Override ค่าพารามิเตอร์ (issue #211, ST เท่านั้น)', () {
    testWidgets('role ST -> เห็นปุ่ม', (tester) async {
      await _pump(
        tester,
        repo: _FakeDeviceSearchRepository(),
        role: UserRole.st,
      );

      expect(
        find.byKey(const Key('device_detail_config_override')),
        findsOneWidget,
      );
    });

    testWidgets('role OT -> ไม่เห็นปุ่ม (OT ไม่มีสิทธิ์ override เลย)', (
      tester,
    ) async {
      await _pump(
        tester,
        repo: _FakeDeviceSearchRepository(),
        role: UserRole.ot,
      );

      expect(
        find.byKey(const Key('device_detail_config_override')),
        findsNothing,
      );
    });

    testWidgets('role Operation -> ไม่เห็นปุ่ม', (tester) async {
      await _pump(
        tester,
        repo: _FakeDeviceSearchRepository(),
        role: UserRole.operation,
      );

      expect(
        find.byKey(const Key('device_detail_config_override')),
        findsNothing,
      );
    });
  });
}

void _statusTests() {
  group('สถานะ Config / Firmware (GET /devices/{deviceId}/status)', () {
    testWidgets('เรียก getDeviceStatus ด้วย deviceId ของหน้า', (tester) async {
      final statusRepo = _FakeDeviceStatusRepository();
      await _pump(
        tester,
        repo: _FakeDeviceSearchRepository(),
        statusRepo: statusRepo,
      );
      await tester.pump();

      expect(statusRepo.calls, ['DEV-0117']);
    });

    for (final (status, label) in [
      (DevicePayloadStatus.upToDate, 'อัปเดตล่าสุด'),
      (DevicePayloadStatus.failed, 'ล้มเหลว'),
      (DevicePayloadStatus.pending, 'รออัปเดต'),
      (DevicePayloadStatus.unknown, 'ไม่ทราบ'),
    ]) {
      testWidgets('configStatus ${status.wireName} -> "$label"', (
        tester,
      ) async {
        // firmware ตั้งต่างจาก config เพื่อให้ตรวจ label ของ config แยกได้
        await _pump(
          tester,
          repo: _FakeDeviceSearchRepository(),
          statusRepo: _FakeDeviceStatusRepository(
            status: _makeStatus(
              config: status,
              firmware: status == DevicePayloadStatus.failed
                  ? DevicePayloadStatus.upToDate
                  : DevicePayloadStatus.failed,
            ),
          ),
        );
        await tester.pump();

        expect(find.text('สถานะ Config'), findsOneWidget);
        expect(find.text('สถานะ Firmware'), findsOneWidget);
        expect(find.text(label), findsWidgets);
      });
    }

    testWidgets('config และ firmware แสดงแยกกันถูกแถว', (tester) async {
      await _pump(
        tester,
        repo: _FakeDeviceSearchRepository(),
        statusRepo: _FakeDeviceStatusRepository(
          status: _makeStatus(
            config: DevicePayloadStatus.failed,
            firmware: DevicePayloadStatus.pending,
          ),
        ),
      );
      await tester.pump();

      expect(find.text('ล้มเหลว'), findsOneWidget);
      expect(find.text('รออัปเดต'), findsOneWidget);
    });

    testWidgets('มี lastCheckInMessage -> แสดงข้อความ', (tester) async {
      await _pump(
        tester,
        repo: _FakeDeviceSearchRepository(),
        statusRepo: _FakeDeviceStatusRepository(
          status: _makeStatus(message: 'เช็คอินเมื่อสักครู่'),
        ),
      );
      await tester.pump();

      expect(find.text('เช็คอินเมื่อสักครู่'), findsOneWidget);
    });

    testWidgets('lastCheckInMessage เป็น null -> แสดง "—"', (tester) async {
      await _pump(tester, repo: _FakeDeviceSearchRepository());
      await tester.pump();

      expect(find.text('เช็คอินล่าสุด'), findsOneWidget);
      // device ที่ติดตั้งแล้วมีค่าครบ ดังนั้น "—" ที่เจอมาจากแถวเช็คอินล่าสุดเท่านั้น
      expect(find.text('—'), findsOneWidget);
    });

    testWidgets('ออนไลน์/ออฟไลน์ เป็น "ไม่ทราบ" คงที่ (placeholder)', (
      tester,
    ) async {
      // แม้ status อื่นๆ จะเป็นค่าที่รู้ ช่อง online/offline ยังเป็น "ไม่ทราบ"
      await _pump(
        tester,
        repo: _FakeDeviceSearchRepository(),
        statusRepo: _FakeDeviceStatusRepository(
          status: _makeStatus(
            config: DevicePayloadStatus.upToDate,
            firmware: DevicePayloadStatus.upToDate,
            message: 'ok',
          ),
        ),
      );
      await tester.pump();

      expect(find.text('ออนไลน์/ออฟไลน์'), findsOneWidget);
      expect(find.text('ไม่ทราบ'), findsOneWidget);
    });

    testWidgets('กำลังโหลด -> แสดง loading ของ status แต่ device ยังแสดง', (
      tester,
    ) async {
      await _pump(
        tester,
        repo: _FakeDeviceSearchRepository(),
        statusRepo: _NeverCompletesStatusRepository(),
      );
      await tester.pump();

      expect(find.byKey(const Key('device_status_loading')), findsOneWidget);
      expect(find.text('DEV-0117'), findsOneWidget);
    });

    for (final (error, expected) in [
      (ApiException('x', statusCode: 404), 'ไม่พบสถานะอุปกรณ์นี้'),
      (ApiException('x', statusCode: 403), 'ไม่มีสิทธิ์ดูสถานะอุปกรณ์นี้'),
      (
        ApiException('เซิร์ฟเวอร์ขัดข้อง', statusCode: 500),
        'เซิร์ฟเวอร์ขัดข้อง',
      ),
      (Exception('boom'), 'โหลดสถานะอุปกรณ์ไม่สำเร็จ'),
    ]) {
      testWidgets('error $error -> "$expected" และ device record ยังแสดงอยู่', (
        tester,
      ) async {
        await _pump(
          tester,
          repo: _FakeDeviceSearchRepository(),
          statusRepo: _FakeDeviceStatusRepository(error: error),
        );
        await tester.pump();

        expect(find.text(expected), findsOneWidget);
        expect(find.byKey(const Key('device_status_retry')), findsOneWidget);
        // status ล้มเหลวต้องไม่บังข้อมูลอุปกรณ์
        expect(find.text('0812345678'), findsOneWidget);
      });
    }

    testWidgets('ปุ่มลองอีกครั้ง -> โหลดซ้ำแล้วแสดงสถานะ', (tester) async {
      final statusRepo = _FakeDeviceStatusRepository(
        error: ApiException('ล่ม', statusCode: 500),
      );
      await _pump(
        tester,
        repo: _FakeDeviceSearchRepository(),
        statusRepo: statusRepo,
      );
      await tester.pump();
      expect(find.text('ล่ม'), findsOneWidget);

      statusRepo.error = null;
      await tester.tap(find.byKey(const Key('device_status_retry')));
      await tester.pump();
      await tester.pump();

      expect(statusRepo.calls.length, 2);
      expect(find.text('สถานะ Config'), findsOneWidget);
      expect(find.byKey(const Key('device_status_error')), findsNothing);
    });
  });
}
