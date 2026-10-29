import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/auth/auth_controller.dart'; // apiClientProvider
import '../../core/config/app_config.dart';

/// `GET /devices/{deviceId}/history` — ประวัติรายเครื่อง (R4-04 · docs/29) ใช้ API
/// ที่ backend มีอยู่แล้ว ไม่เพิ่ม endpoint · หน้า Device Detail ใช้ `summary`
/// (Config/Firmware ปัจจุบัน) ส่วนหน้าประวัติใช้ `items` แบ่งหน้าด้วย cursor
abstract class DeviceHistoryRepository {
  Future<DeviceHistoryResult> getHistory(String deviceId, {String? before});
}

class ApiDeviceHistoryRepository implements DeviceHistoryRepository {
  ApiDeviceHistoryRepository(this._api);

  final ApiClient _api;

  @override
  Future<DeviceHistoryResult> getHistory(String deviceId, {String? before}) =>
      _api.getDeviceHistory(deviceId, before: before);
}

/// `API_MOCK_MODE` — ตัวอย่างไม่กี่รายการ หน้าเดียวจบ
class MockDeviceHistoryRepository implements DeviceHistoryRepository {
  @override
  Future<DeviceHistoryResult> getHistory(
    String deviceId, {
    String? before,
  }) async {
    await Future<void>.delayed(const Duration(milliseconds: 200));
    return DeviceHistoryResult(
      currentConfigName: 'ส่งพิกัดทุก 20 วินาที',
      currentFirmwareVersion: '1.2.0',
      items: [
        DeviceHistoryItem(
          id: 'rollout:mock-1',
          type: DeviceHistoryType.rollout,
          occurredAt: DateTime(2026, 10, 27, 14, 35),
          status: 'success',
          title: 'อัปเดต Firmware หน้างาน',
          payloadType: 'Firmware',
          firmwareVersion: '1.2.0',
        ),
        DeviceHistoryItem(
          id: 'task:mock-1',
          type: DeviceHistoryType.task,
          occurredAt: DateTime(2026, 10, 27, 14, 20),
          status: 'completed',
          title: 'ติดตั้งกล่อง GPS',
        ),
        DeviceHistoryItem(
          id: 'lifecycle:mock-installed',
          type: DeviceHistoryType.lifecycle,
          occurredAt: DateTime(2026, 10, 26, 9, 0),
          status: 'installed',
        ),
      ],
    );
  }
}

final deviceHistoryRepositoryProvider = Provider<DeviceHistoryRepository>((
  ref,
) {
  if (AppConfig.apiMockMode) return MockDeviceHistoryRepository();
  return ApiDeviceHistoryRepository(ref.watch(apiClientProvider));
});

/// หน้าแรกของประวัติ — Device Detail ใช้ `summary` ส่วนหน้าประวัติใช้เป็นหน้าแรก
final deviceHistoryProvider = FutureProvider.autoDispose
    .family<DeviceHistoryResult, String>((ref, deviceId) {
      return ref.watch(deviceHistoryRepositoryProvider).getHistory(deviceId);
    });
