import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/auth/auth_controller.dart'; // apiClientProvider
import '../../core/config/app_config.dart';
import '../device_search/device_search_repository.dart'; // deviceListProvider
import '../task/task_repository.dart'; // taskListProvider

/// Runs a full Config readiness check for a specific device —
/// `POST /devices/{deviceId}/simulate-config` (config_simulator Phase 2).
/// Rolls up 3 checks into one [DeviceSimulateConfigResult]: the Config itself
/// (`configCheck`), whether its deviceModel/protocol match the selected device
/// (`compatibilityCheck`), and that device's live signal (`connectionCheck`).
/// A dry-run — nothing is written and the Config's status is untouched.
abstract class SimulatorRepository {
  Future<DeviceSimulateConfigResult> simulate({
    required String deviceId,
    required String configId,
  });
}

/// Talks to the real backend.
class ApiSimulatorRepository implements SimulatorRepository {
  ApiSimulatorRepository(this._api);

  final ApiClient _api;

  @override
  Future<DeviceSimulateConfigResult> simulate({
    required String deviceId,
    required String configId,
  }) => _api.simulateConfigOnDevice(deviceId: deviceId, configId: configId);
}

/// In-memory fake for `API_MOCK_MODE`.
class MockSimulatorRepository implements SimulatorRepository {
  @override
  Future<DeviceSimulateConfigResult> simulate({
    required String deviceId,
    required String configId,
  }) async {
    await Future<void>.delayed(const Duration(milliseconds: 600));
    final passed = configId.trim().isNotEmpty && deviceId.trim().isNotEmpty;
    final missing = [
      if (configId.trim().isEmpty) 'configId',
      if (deviceId.trim().isEmpty) 'deviceId',
    ];
    return DeviceSimulateConfigResult(
      passed: passed,
      configCheck: SimulationResult(
        passed: configId.trim().isNotEmpty,
        details: [
          'MOCK — ยังไม่ได้เรียก backend จริง',
          'configId = $configId',
          if (configId.trim().isNotEmpty)
            'ทุก field ผ่านการตรวจ (จำลอง)'
          else
            'ต้องระบุ configId',
        ],
      ),
      compatibilityCheck: CompatibilityCheckResult(
        passed: passed,
        details: [
          if (passed)
            'MOCK — deviceModel/protocol ตรงกับอุปกรณ์ $deviceId (จำลอง)'
          else
            'ต้องระบุ ${missing.join(' และ ')}',
        ],
      ),
      connectionCheck: DeviceConnectionTestResult(
        passed: deviceId.trim().isNotEmpty,
        signalStrength: -65,
        details: [
          if (deviceId.trim().isNotEmpty)
            'MOCK — อุปกรณ์ $deviceId ออนไลน์ สัญญาณ -65 dBm (จำลอง)'
          else
            'ต้องระบุ deviceId',
        ],
        testedAt: DateTime.now(),
      ),
    );
  }
}

final simulatorRepositoryProvider = Provider<SimulatorRepository>((ref) {
  if (AppConfig.apiMockMode) return MockSimulatorRepository();
  return ApiSimulatorRepository(ref.watch(apiClientProvider));
});

/// Device IDs the signed-in user can pick for a readiness check.
///
/// `Task.deviceId` ใน response มีได้ 2 รูปแบบขึ้นกับว่าใครสร้าง task:
///   - Prisma UUID (`285445ee-...`) — Operation เลือก Device จาก dropdown บน Web
///   - เลขเครื่องจริง (`SMOKE-001`, `DEV-0003`) — seed data เก่าหรือ migration
///
/// provider นี้ normalize ทั้งสองรูปแบบให้เป็น `Device.deviceId` จริง
/// (เลขเครื่อง) ที่ endpoint `POST /devices/{deviceId}/simulate-config` ต้องการ
/// โดย join กับ `GET /devices`:
///   1. ถ้า task.deviceId ตรงกับ Device.id (Prisma UUID) → ใช้ Device.deviceId
///   2. ถ้า task.deviceId ตรงกับ Device.deviceId โดยตรง → ใช้ค่านั้นเลย
///   3. ถ้าไม่ match → ข้าม (device นั้นไม่มีใน Device table จริง)
final assignedDeviceIdListProvider =
    Provider.autoDispose<AsyncValue<List<String>>>((ref) {
      final tasksAsync = ref.watch(taskListProvider);
      final devicesAsync = ref.watch(deviceListProvider);

      if (tasksAsync.isLoading || devicesAsync.isLoading) {
        return const AsyncValue.loading();
      }
      if (tasksAsync.hasError) {
        return AsyncValue.error(tasksAsync.error!, tasksAsync.stackTrace!);
      }
      if (devicesAsync.hasError) {
        return AsyncValue.error(devicesAsync.error!, devicesAsync.stackTrace!);
      }

      final tasks = tasksAsync.requireValue;
      final devices = devicesAsync.requireValue;

      // index ทั้งสองทิศทาง
      final byPrismaId = <String, String>{
        for (final d in devices) d.id: d.deviceId, // UUID → เลขเครื่อง
      };
      final knownDeviceIds = <String>{
        for (final d in devices) d.deviceId, // เลขเครื่องที่มีจริง
      };

      final realIds = <String>{};
      for (final task in tasks) {
        final raw = (task.deviceId ?? '').trim();
        if (raw.isEmpty) continue;

        if (byPrismaId.containsKey(raw)) {
          // กรณี 1: Prisma UUID → แปลงเป็นเลขเครื่อง
          realIds.add(byPrismaId[raw]!);
        } else if (knownDeviceIds.contains(raw)) {
          // กรณี 2: เป็นเลขเครื่องจริงอยู่แล้ว
          realIds.add(raw);
        }
        // กรณี 3: ไม่ match → ข้าม (device ไม่มีใน DB จริง)
      }

      return AsyncValue.data(realIds.toList()..sort());
    });

// deviceListProvider ใช้ตัวที่มีอยู่แล้วใน device_search_repository.dart
// (รองรับ mock mode + real API ในตัวเดียวกัน — ไม่ define ซ้ำ)
