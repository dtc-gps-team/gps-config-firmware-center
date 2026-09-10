import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/features/device_search/device_detail_page.dart';
import 'package:mobile/features/device_search/device_search_repository.dart';

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

Future<void> _pump(
  WidgetTester tester, {
  required DeviceSearchRepository repo,
  String deviceId = 'DEV-0117',
}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        deviceSearchRepositoryProvider.overrideWithValue(repo),
      ],
      child: MaterialApp(home: DeviceDetailPage(deviceId: deviceId)),
    ),
  );
  await tester.pump(); // resolve getDevice
}

void main() {
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
}
