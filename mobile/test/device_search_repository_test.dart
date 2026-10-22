import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/core/config/app_config.dart';
import 'package:mobile/features/device_search/device_search_repository.dart';

class _RecordingDeviceSearchRepository implements DeviceSearchRepository {
  int listCalls = 0;
  final List<String> getCalls = [];

  @override
  Future<List<Device>> listDevices() async {
    listCalls++;
    return const [];
  }

  @override
  Future<Device> getDevice(String deviceId) async {
    getCalls.add(deviceId);
    throw UnimplementedError();
  }
}

void main() {
  group('deviceSearchRepositoryProvider', () {
    test('picks the implementation from API_MOCK_MODE', () {
      final container = ProviderContainer();
      addTearDown(container.dispose);

      final repo = container.read(deviceSearchRepositoryProvider);
      if (AppConfig.apiMockMode) {
        expect(repo, isA<MockDeviceSearchRepository>());
      } else {
        expect(repo, isA<ApiDeviceSearchRepository>());
      }
    });
  });

  group('deviceListProvider / deviceDetailProvider', () {
    test('deviceListProvider hits the repository (no role gate)', () async {
      final repo = _RecordingDeviceSearchRepository();
      final container = ProviderContainer(
        overrides: [deviceSearchRepositoryProvider.overrideWithValue(repo)],
      );
      addTearDown(container.dispose);

      final devices = await container.read(deviceListProvider.future);
      expect(devices, isEmpty);
      expect(repo.listCalls, 1);
    });

    test('deviceDetailProvider forwards the deviceId', () async {
      final repo = _RecordingDeviceSearchRepository();
      final container = ProviderContainer(
        overrides: [deviceSearchRepositoryProvider.overrideWithValue(repo)],
      );
      addTearDown(container.dispose);

      await expectLater(
        container.read(deviceDetailProvider('DEV-9').future),
        throwsA(isA<UnimplementedError>()),
      );
      expect(repo.getCalls, ['DEV-9']);
    });
  });

  group('MockDeviceSearchRepository', () {
    test('listDevices returns the seeded devices', () async {
      final repo = MockDeviceSearchRepository();
      final devices = await repo.listDevices();
      expect(devices, isNotEmpty);
      expect(devices.map((d) => d.deviceId), contains('DEV-0117'));
    });

    test('each device model uses exactly one protocol (#351)', () async {
      // ตรงกับข้อมูลตัวอย่างของ backend (prisma/seed.ts, scripts/seed-demo.ts)
      const backendProtocols = {
        'GT06N': 'TCP',
        'GT06L': 'TCP',
        'GT08-4G': 'TCP',
      };
      final devices = await MockDeviceSearchRepository().listDevices();

      final protocolsByModel = <String, Set<String>>{};
      for (final d in devices) {
        protocolsByModel.putIfAbsent(d.deviceModel, () => {}).add(d.protocol);
      }
      for (final entry in protocolsByModel.entries) {
        expect(entry.value, hasLength(1), reason: entry.key);
        expect(
          entry.value.single,
          backendProtocols[entry.key],
          reason: entry.key,
        );
      }
    });

    test('getDevice returns a match / throws 404 otherwise', () async {
      final repo = MockDeviceSearchRepository();

      final device = await repo.getDevice('DEV-0117');
      expect(device.deviceId, 'DEV-0117');
      expect(device.status, DeviceLifecycleStatus.installed);

      await expectLater(
        repo.getDevice('nope'),
        throwsA(
          isA<ApiException>().having((e) => e.statusCode, 'statusCode', 404),
        ),
      );
    });
  });
}
