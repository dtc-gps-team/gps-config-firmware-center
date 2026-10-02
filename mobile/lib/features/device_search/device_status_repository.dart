import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/auth/auth_controller.dart'; // apiClientProvider
import '../../core/config/app_config.dart';

/// Reads `GET /devices/{deviceId}/status` for the Device detail screen. Kept
/// separate from [DeviceSearchRepository] so the status call can fail
/// independently of the device record. Open to every logged-in role.
abstract class DeviceStatusRepository {
  Future<DeviceStatus> getDeviceStatus(String deviceId);
}

class ApiDeviceStatusRepository implements DeviceStatusRepository {
  ApiDeviceStatusRepository(this._api);

  final ApiClient _api;

  @override
  Future<DeviceStatus> getDeviceStatus(String deviceId) =>
      _api.getDeviceStatus(deviceId);
}

/// In-memory fake for `API_MOCK_MODE`. Returns the "never in a rollout" shape
/// (`unknown` / `null`) — the normal value for a device without a rollout.
class MockDeviceStatusRepository implements DeviceStatusRepository {
  @override
  Future<DeviceStatus> getDeviceStatus(String deviceId) async {
    await Future<void>.delayed(const Duration(milliseconds: 200));
    return DeviceStatus(
      deviceId: deviceId,
      configStatus: DevicePayloadStatus.unknown,
      firmwareStatus: DevicePayloadStatus.unknown,
    );
  }
}

final deviceStatusRepositoryProvider = Provider<DeviceStatusRepository>((ref) {
  if (AppConfig.apiMockMode) return MockDeviceStatusRepository();
  return ApiDeviceStatusRepository(ref.watch(apiClientProvider));
});

/// Config/Firmware status of one device, keyed by `Device.deviceId`.
final deviceStatusProvider = FutureProvider.autoDispose
    .family<DeviceStatus, String>((ref, deviceId) {
      return ref
          .watch(deviceStatusRepositoryProvider)
          .getDeviceStatus(deviceId);
    });
