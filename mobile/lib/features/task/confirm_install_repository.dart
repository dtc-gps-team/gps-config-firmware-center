import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/auth/auth_controller.dart'; // apiClientProvider

/// "ยืนยันติดตั้งสำเร็จ" (Confirm Install, Sprint 3) — ส่ง `Task.configId` ให้
/// อุปกรณ์ `Task.deviceId` ผ่าน `POST /devices/{deviceId}/apply-config` หลัง
/// ช่างติดตั้งกล่อง GPS จริงเสร็จแล้ว.
abstract class ConfirmInstallRepository {
  Future<ConfigApplyResult> applyConfig({
    required String deviceId,
    required String configId,
  });
}

/// Talks to the real backend — endpoint is live (device module, PR #85 +
/// `applyConfigToDevice`). No mock implementation: same call as
/// `ApiDeviceConnectionTestRepository`, which also always hits the real
/// backend regardless of `API_MOCK_MODE` because both actions only make
/// sense against a real Device/Config record.
class ApiConfirmInstallRepository implements ConfirmInstallRepository {
  ApiConfirmInstallRepository(this._api);

  final ApiClient _api;

  @override
  Future<ConfigApplyResult> applyConfig({
    required String deviceId,
    required String configId,
  }) => _api.applyConfigToDevice(deviceId: deviceId, configId: configId);
}

final confirmInstallRepositoryProvider = Provider<ConfirmInstallRepository>(
  (ref) => ApiConfirmInstallRepository(ref.watch(apiClientProvider)),
);
