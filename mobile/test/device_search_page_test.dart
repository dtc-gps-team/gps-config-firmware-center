import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/router/app_router.dart';
import 'package:mobile/core/ui/app_skeleton.dart';
import 'package:mobile/features/device_search/device_search_page.dart';
import 'package:mobile/features/device_search/device_search_repository.dart';

Device _device({
  String id = 'uuid',
  String deviceId = 'DEV-0001',
  String simNumber = '0812345678',
  DeviceLifecycleStatus status = DeviceLifecycleStatus.registered,
  String deviceModel = 'GT06N',
  String protocol = 'TCP',
  Customer? customer,
}) => Device(
  id: id,
  deviceId: deviceId,
  simNumber: simNumber,
  deviceModel: deviceModel,
  protocol: protocol,
  status: status,
  registeredAt: DateTime(2026, 6, 1),
  customer: customer,
);

class _FakeDeviceSearchRepository implements DeviceSearchRepository {
  _FakeDeviceSearchRepository({List<Device>? devices, this.listError})
    : _devices = devices ?? [_device()];

  final List<Device> _devices;
  final Object? listError;

  int listCalls = 0;

  @override
  Future<List<Device>> listDevices() async {
    listCalls++;
    if (listError != null) throw listError!;
    return _devices;
  }

  @override
  Future<Device> getDevice(String deviceId) async =>
      _devices.firstWhere((d) => d.deviceId == deviceId);
}

Future<void> _pump(
  WidgetTester tester, {
  required DeviceSearchRepository repo,
}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [deviceSearchRepositoryProvider.overrideWithValue(repo)],
      child: const MaterialApp(home: DeviceSearchPage()),
    ),
  );
  await tester.pump(); // resolve listDevices
}

/// Router-backed pump so `context.push(AppRoutes.deviceDetail(...))` resolves.
Future<void> _pumpRouted(
  WidgetTester tester, {
  required DeviceSearchRepository repo,
}) async {
  final router = GoRouter(
    initialLocation: AppRoutes.deviceSearch,
    routes: [
      GoRoute(
        path: AppRoutes.deviceSearch,
        builder: (_, _) => const DeviceSearchPage(),
      ),
      GoRoute(
        path: AppRoutes.deviceDetailPattern,
        builder: (_, state) => Scaffold(
          body: Text('DEVICE_DETAIL_STUB ${state.pathParameters['deviceId']}'),
        ),
      ),
    ],
  );
  await tester.pumpWidget(
    ProviderScope(
      overrides: [deviceSearchRepositoryProvider.overrideWithValue(repo)],
      child: MaterialApp.router(routerConfig: router),
    ),
  );
  await tester.pump();
}

void main() {
  testWidgets(
    'กำลังโหลดครั้งแรก -> โชว์ AppListSkeleton (ไม่ใช่ spinner), พอข้อมูลมาแล้ว '
    'skeleton หายไปเหลือแต่การ์ดจริง',
    (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            deviceSearchRepositoryProvider.overrideWithValue(
              _FakeDeviceSearchRepository(),
            ),
          ],
          child: const MaterialApp(home: DeviceSearchPage()),
        ),
      );

      expect(find.byType(AppListSkeleton), findsWidgets);
      expect(find.byType(CircularProgressIndicator), findsNothing);

      await tester.pump(); // resolve listDevices
      expect(find.byType(AppListSkeleton), findsNothing);
    },
  );

  testWidgets('loading -> list ของอุปกรณ์จาก repository', (tester) async {
    await _pump(
      tester,
      repo: _FakeDeviceSearchRepository(
        devices: [
          _device(deviceId: 'DEV-0117', simNumber: '0811111111'),
          _device(id: 'uuid2', deviceId: 'DEV-0092', simNumber: '0822222222'),
        ],
      ),
    );

    expect(find.text('DEV-0117'), findsOneWidget);
    expect(find.text('DEV-0092'), findsOneWidget);
    expect(find.byKey(const Key('device_card_0')), findsOneWidget);
    expect(find.byKey(const Key('device_card_1')), findsOneWidget);
  });

  testWidgets('ค้นหาด้วย deviceId -> filter เฉพาะที่ตรง', (tester) async {
    await _pump(
      tester,
      repo: _FakeDeviceSearchRepository(
        devices: [
          _device(deviceId: 'DEV-0117', simNumber: '0811111111'),
          _device(id: 'uuid2', deviceId: 'DEV-0092', simNumber: '0822222222'),
        ],
      ),
    );

    await tester.enterText(
      find.byKey(const Key('device_search_field')),
      '0117',
    );
    await tester.pump();

    expect(find.text('DEV-0117'), findsOneWidget);
    expect(find.text('DEV-0092'), findsNothing);
  });

  testWidgets('ค้นหาด้วย simNumber -> filter เฉพาะที่ตรง', (tester) async {
    await _pump(
      tester,
      repo: _FakeDeviceSearchRepository(
        devices: [
          _device(deviceId: 'DEV-0117', simNumber: '0811111111'),
          _device(id: 'uuid2', deviceId: 'DEV-0092', simNumber: '0822222222'),
        ],
      ),
    );

    await tester.enterText(
      find.byKey(const Key('device_search_field')),
      '822222',
    );
    await tester.pump();

    expect(find.text('DEV-0092'), findsOneWidget);
    expect(find.text('DEV-0117'), findsNothing);
  });

  testWidgets('ค้นหาแล้วไม่เจอ -> empty state', (tester) async {
    await _pump(
      tester,
      repo: _FakeDeviceSearchRepository(devices: [_device(deviceId: 'DEV-1')]),
    );

    await tester.enterText(find.byKey(const Key('device_search_field')), 'zzz');
    await tester.pump();

    expect(find.byKey(const Key('device_search_empty')), findsOneWidget);
    expect(find.text('ไม่พบอุปกรณ์ที่ตรงกับคำค้น'), findsOneWidget);
  });

  testWidgets('ไม่มีอุปกรณ์ในระบบ -> empty state', (tester) async {
    await _pump(tester, repo: _FakeDeviceSearchRepository(devices: const []));

    expect(find.byKey(const Key('device_search_empty')), findsOneWidget);
    expect(find.text('ยังไม่มีอุปกรณ์ในระบบ'), findsOneWidget);
  });

  testWidgets('error -> error card + ปุ่มลองอีกครั้ง', (tester) async {
    await _pump(
      tester,
      repo: _FakeDeviceSearchRepository(
        listError: ApiException('เซิร์ฟเวอร์ล่ม', statusCode: 500),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('device_search_error')), findsOneWidget);
    expect(find.text('เซิร์ฟเวอร์ล่ม'), findsOneWidget);
    expect(find.byKey(const Key('device_search_retry')), findsOneWidget);
  });

  testWidgets('แตะแถว -> navigate ไป device detail ด้วย deviceId', (
    tester,
  ) async {
    await _pumpRouted(
      tester,
      repo: _FakeDeviceSearchRepository(
        devices: [_device(deviceId: 'DEV-0117')],
      ),
    );

    await tester.tap(find.byKey(const Key('device_card_0')));
    await tester.pumpAndSettle();

    expect(find.text('DEVICE_DETAIL_STUB DEV-0117'), findsOneWidget);
  });

  group('ตัวกรอง รุ่น / ลูกค้า / โปรโตคอล / สถานะ', () {
    const custA = Customer(id: 'c-a', companyName: 'ขนส่ง A');
    const custB = Customer(id: 'c-b', companyName: 'โลจิสติกส์ B');
    final fleet = [
      _device(
        id: 'u1',
        deviceId: 'BOX-0001',
        deviceModel: 'ESP32-DEVKIT-V1',
        protocol: 'HTTP',
        status: DeviceLifecycleStatus.installed,
        customer: custA,
      ),
      _device(id: 'u2', deviceId: 'DEV-0092'),
      _device(
        id: 'u3',
        deviceId: 'DEV-0117',
        status: DeviceLifecycleStatus.installed,
        customer: custA,
      ),
      _device(
        id: 'u4',
        deviceId: 'DEV-0231',
        deviceModel: 'GT06L',
        status: DeviceLifecycleStatus.decommissioned,
        customer: custB,
      ),
    ];

    Future<void> pick(WidgetTester tester, String chip, String option) async {
      await tester.tap(find.byKey(Key('device_filter_$chip')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(Key('device_filter_option_$option')));
      await tester.pumpAndSettle();
    }

    testWidgets('กรองตามรุ่น -> เหลือเฉพาะรุ่นนั้น + ชิปบอกค่าที่เลือก', (
      tester,
    ) async {
      await _pump(tester, repo: _FakeDeviceSearchRepository(devices: fleet));

      await tester.tap(find.byKey(const Key('device_filter_model')));
      await tester.pumpAndSettle();
      // ตัวเลือกมาจากรุ่นที่มีจริงในรายการ พร้อมจำนวนเครื่อง
      expect(find.text('GT06N (2)'), findsOneWidget);
      expect(find.text('GT06L (1)'), findsOneWidget);
      expect(find.text('ESP32-DEVKIT-V1 (1)'), findsOneWidget);
      await tester.tap(find.byKey(const Key('device_filter_option_GT06N')));
      await tester.pumpAndSettle();

      expect(find.text('DEV-0092'), findsOneWidget);
      expect(find.text('DEV-0117'), findsOneWidget);
      expect(find.text('BOX-0001'), findsNothing);
      expect(find.text('DEV-0231'), findsNothing);
      expect(find.text('รุ่น: GT06N'), findsOneWidget);
      expect(find.text('แสดง 2 จาก 4 เครื่อง'), findsOneWidget);
    });

    testWidgets('กรองตามลูกค้า รวมถึง "ยังไม่ผูกลูกค้า"', (tester) async {
      await _pump(tester, repo: _FakeDeviceSearchRepository(devices: fleet));

      await pick(tester, 'customer', 'c-a');
      expect(find.text('BOX-0001'), findsOneWidget);
      expect(find.text('DEV-0117'), findsOneWidget);
      expect(find.text('DEV-0092'), findsNothing);
      expect(find.text('ลูกค้า: ขนส่ง A'), findsOneWidget);

      await pick(tester, 'customer', 'none');
      expect(find.text('DEV-0092'), findsOneWidget);
      expect(find.text('BOX-0001'), findsNothing);
      expect(find.text('ลูกค้า: ยังไม่ผูกลูกค้า'), findsOneWidget);
    });

    testWidgets('หลายตัวกรอง + คำค้น ทำงานร่วมกัน · ล้างตัวกรองแล้วกลับครบ', (
      tester,
    ) async {
      await _pump(tester, repo: _FakeDeviceSearchRepository(devices: fleet));

      await pick(tester, 'protocol', 'TCP');
      await pick(tester, 'status', 'installed');
      expect(find.text('DEV-0117'), findsOneWidget);
      expect(find.text('DEV-0092'), findsNothing);
      expect(find.text('BOX-0001'), findsNothing);
      expect(find.text('สถานะ: Installed'), findsOneWidget);

      await tester.enterText(
        find.byKey(const Key('device_search_field')),
        '0092',
      );
      await tester.pump();
      expect(
        find.text('ไม่พบอุปกรณ์ที่ตรงกับคำค้นหรือตัวกรอง'),
        findsOneWidget,
      );

      await tester.tap(find.byKey(const Key('device_filter_clear')));
      await tester.pump();
      expect(find.text('DEV-0092'), findsOneWidget);
      expect(find.byKey(const Key('device_filter_clear')), findsNothing);
      expect(find.text('รุ่น'), findsOneWidget);
    });

    testWidgets('เลือก "ทั้งหมด" -> ยกเลิกตัวกรองนั้น', (tester) async {
      await _pump(tester, repo: _FakeDeviceSearchRepository(devices: fleet));

      await pick(tester, 'model', 'GT06L');
      expect(find.text('DEV-0092'), findsNothing);
      await pick(tester, 'model', 'all');
      expect(find.text('DEV-0092'), findsOneWidget);
      expect(find.text('รุ่น'), findsOneWidget);
      expect(find.textContaining('แสดง '), findsNothing);
    });
  });
}
