import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/auth/auth_controller.dart'; // apiClientProvider
import '../../core/config/app_config.dart';

/// `GET /devices/{deviceId}/central` สำหรับหน้ากล่อง — แยกจาก
/// [DeviceStatusRepository] เพราะเป็นข้อมูลเสริม (โหลดไม่ได้ก็ยังแสดงหน้าได้)
abstract class DeviceCentralRepository {
  Future<DeviceCentral> getDeviceCentral(String deviceId);
}

class ApiDeviceCentralRepository implements DeviceCentralRepository {
  ApiDeviceCentralRepository(this._api);

  final ApiClient _api;

  @override
  Future<DeviceCentral> getDeviceCentral(String deviceId) =>
      _api.getDeviceCentral(deviceId);
}

/// `API_MOCK_MODE` — ไม่มี Server กลาง หน้ากล่องจึงใช้ `/status` ตามเดิม
class MockDeviceCentralRepository implements DeviceCentralRepository {
  @override
  Future<DeviceCentral> getDeviceCentral(String deviceId) =>
      Future.value(const DeviceCentral(reachable: false));
}

final deviceCentralRepositoryProvider = Provider<DeviceCentralRepository>((
  ref,
) {
  if (AppConfig.apiMockMode) return MockDeviceCentralRepository();
  return ApiDeviceCentralRepository(ref.watch(apiClientProvider));
});

/// สถานะกล่องจาก Server กลาง keyed by `Device.deviceId`
final deviceCentralProvider = FutureProvider.autoDispose
    .family<DeviceCentral, String>((ref, deviceId) {
      return ref
          .watch(deviceCentralRepositoryProvider)
          .getDeviceCentral(deviceId);
    });
