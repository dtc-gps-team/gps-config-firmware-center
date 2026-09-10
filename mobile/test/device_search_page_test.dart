import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/router/app_router.dart';
import 'package:mobile/features/device_search/device_search_page.dart';
import 'package:mobile/features/device_search/device_search_repository.dart';

Device _device({
  String id = 'uuid',
  String deviceId = 'DEV-0001',
  String simNumber = '0812345678',
  DeviceLifecycleStatus status = DeviceLifecycleStatus.registered,
}) => Device(
  id: id,
  deviceId: deviceId,
  simNumber: simNumber,
  deviceModel: 'GT06N',
  protocol: 'TCP',
  status: status,
  registeredAt: DateTime(2026, 6, 1),
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
}
