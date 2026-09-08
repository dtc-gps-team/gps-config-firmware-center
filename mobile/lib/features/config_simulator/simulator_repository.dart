import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/auth/auth_controller.dart'; // apiClientProvider
import '../../core/config/app_config.dart';
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

/// Device IDs the signed-in user can pick for a readiness check — derived
/// from their own assigned tasks' `Task.deviceId`, deduped + sorted.
///
/// There is no backend endpoint that lists "devices assigned to me"
/// directly (see survey, 2026-09-07); `GET /tasks` is already self-scoped to
/// the caller for ST/OT and carries `deviceId` on each task, so this reuses
/// `taskListProvider` rather than adding a second task-fetching path.
final assignedDeviceIdListProvider =
    Provider.autoDispose<AsyncValue<List<String>>>((ref) {
      final tasksAsync = ref.watch(taskListProvider);
      return tasksAsync.whenData((tasks) {
        final ids = <String>{
          for (final task in tasks)
            if ((task.deviceId ?? '').trim().isNotEmpty) task.deviceId!,
        };
        return ids.toList()..sort();
      });
    });
