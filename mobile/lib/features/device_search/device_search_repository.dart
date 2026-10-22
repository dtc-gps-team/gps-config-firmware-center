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
  // ไม่มีแถว "ออนไลน์/ออฟไลน์" ใน model นี้เลย (ดู docs/18 ข้อ 6 — ค่านั้น
  // ตายตัวเป็น "ไม่ทราบ" เสมอ รอ #245 ทำ telemetry จริง) จึงไม่ fabricate field
  // นี้ในชุด mock — ความสมจริงที่เพิ่มในรอบนี้คือ imei/serialNumber/
  // blackboxId/customer ครบบางเครื่อง ว่างบางเครื่อง (null-safe ของ #306)
  //
  // 1 รุ่นมีได้โปรโตคอลเดียว (#351) — ใช้รุ่นและโปรโตคอลตามข้อมูลตัวอย่างของ
  // backend (`prisma/seed.ts`, `scripts/seed-demo.ts`): GT06N, GT06L, GT08-4G
  // ใช้ TCP ทั้งหมด
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
      imei: '860000000000117',
      serialNumber: 'SNGT06N000117',
      blackboxId: '7100000117',
      customer: const Customer(
        id: 'mock-customer-1',
        companyName: 'ขนส่งสมมติ จำกัด',
      ),
    ),
    Device(
      id: 'mock-device-2',
      deviceId: 'DEV-0092',
      simNumber: '0898765432',
      deviceModel: 'GT06L',
      protocol: 'TCP',
      status: DeviceLifecycleStatus.registered,
      registeredAt: DateTime(2026, 8, 20),
      // ลงทะเบียนก่อนมีกติกาบังคับกรอก — imei/serial/blackbox/customer ยังว่าง
    ),
    Device(
      id: 'mock-device-3',
      deviceId: 'DEV-0231',
      simNumber: '0865432109',
      deviceModel: 'GT06N',
      protocol: 'TCP',
      status: DeviceLifecycleStatus.installed,
      registeredAt: DateTime(2026, 7, 10),
      installedAt: DateTime(2026, 7, 12),
      imei: '860000000000231',
      serialNumber: 'SNGT06N000231',
      // blackboxId ยังไม่กรอก
      customer: const Customer(
        id: 'mock-customer-2',
        companyName: 'โลจิสติกส์ไทย จำกัด',
      ),
    ),
    Device(
      id: 'mock-device-4',
      deviceId: 'DEV-0305',
      simNumber: '0823456789',
      deviceModel: 'GT08-4G',
      protocol: 'TCP',
      status: DeviceLifecycleStatus.installed,
      registeredAt: DateTime(2026, 7, 25),
      installedAt: DateTime(2026, 7, 27),
      // ยังไม่ผูกลูกค้า — customer null
    ),
    Device(
      id: 'mock-device-5',
      deviceId: 'DEV-0410',
      simNumber: '0834567890',
      deviceModel: 'GT06L',
      protocol: 'TCP',
      status: DeviceLifecycleStatus.registered,
      registeredAt: DateTime(2026, 9, 1),
      imei: '860000000000410',
      // serial/blackbox ยังไม่กรอก, ผูกลูกค้าไว้แล้วตั้งแต่ลงทะเบียน
      customer: const Customer(id: 'mock-customer-3', companyName: 'ขนส่ง ABC'),
    ),
    Device(
      id: 'mock-device-6',
      deviceId: 'DEV-0512',
      simNumber: '0845678901',
      deviceModel: 'GT08-4G',
      protocol: 'TCP',
      status: DeviceLifecycleStatus.decommissioned,
      registeredAt: DateTime(2026, 3, 1),
      installedAt: DateTime(2026, 3, 5),
      imei: '860000000000512',
      serialNumber: 'SNGT084G000512',
      blackboxId: '7100000512',
      customer: const Customer(
        id: 'mock-customer-1',
        companyName: 'ขนส่งสมมติ จำกัด',
      ),
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
