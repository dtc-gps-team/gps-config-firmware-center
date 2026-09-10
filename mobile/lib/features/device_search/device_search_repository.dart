import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/auth/auth_controller.dart'; // apiClientProvider
import '../../core/config/app_config.dart';

/// Reads the device inventory for the "ค้นหาอุปกรณ์" screen.
///
/// `GET /devices` / `GET /devices/{deviceId}` are open to every logged-in role
/// (RBAC "R" for all), so — unlike [TaskRepository] — there is no client-side
/// role gate here.
abstract class DeviceSearchRepository {
  Future<List<Device>> listDevices();
  Future<Device> getDevice(String deviceId);
}

/// Talks to the real backend. Default outside `API_MOCK_MODE` — the Device
/// endpoints are live on `main` (PR #128).
class ApiDeviceSearchRepository implements DeviceSearchRepository {
  ApiDeviceSearchRepository(this._api);

  final ApiClient _api;

  @override
  Future<List<Device>> listDevices() => _api.listDevices();

  @override
  Future<Device> getDevice(String deviceId) => _api.getDevice(deviceId);
}

/// In-memory fake for `API_MOCK_MODE` (dev/demo without a backend). Mirrors the
/// same pattern as [MockTaskRepository].
class MockDeviceSearchRepository implements DeviceSearchRepository {
  final List<Device> _devices = [
    Device(
      id: 'mock-device-1',
      deviceId: 'DEV-0117',
      simNumber: '0812345678',
      deviceModel: 'GT06N',
      protocol: 'TCP',
      status: DeviceLifecycleStatus.installed,
      registeredAt: DateTime(2026, 6, 1),
      installedAt: DateTime(2026, 6, 3),
    ),
    Device(
      id: 'mock-device-2',
      deviceId: 'DEV-0092',
      simNumber: '0898765432',
      deviceModel: 'GT06L',
      protocol: 'TCP',
      status: DeviceLifecycleStatus.registered,
      registeredAt: DateTime(2026, 8, 20),
    ),
  ];

  @override
  Future<List<Device>> listDevices() async {
    await Future<void>.delayed(const Duration(milliseconds: 300));
    return List.unmodifiable(_devices);
  }

  @override
  Future<Device> getDevice(String deviceId) async {
    await Future<void>.delayed(const Duration(milliseconds: 200));
    final match = _devices.where((d) => d.deviceId == deviceId);
    if (match.isEmpty) {
      throw ApiException('ไม่พบอุปกรณ์นี้', statusCode: 404);
    }
    return match.first;
  }
}

final deviceSearchRepositoryProvider = Provider<DeviceSearchRepository>((ref) {
  if (AppConfig.apiMockMode) return MockDeviceSearchRepository();
  return ApiDeviceSearchRepository(ref.watch(apiClientProvider));
});

/// The full device list. Every role may call `GET /devices` (unlike
/// `taskListProvider`, which is limited to ST/OT) — no role check here.
final deviceListProvider = FutureProvider.autoDispose<List<Device>>((ref) {
  return ref.watch(deviceSearchRepositoryProvider).listDevices();
});

/// One device by its real hardware number, for the detail screen.
final deviceDetailProvider = FutureProvider.autoDispose.family<Device, String>((
  ref,
  deviceId,
) {
  return ref.watch(deviceSearchRepositoryProvider).getDevice(deviceId);
});
