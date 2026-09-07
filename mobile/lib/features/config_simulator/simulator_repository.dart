import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/auth/auth_controller.dart'; // apiClientProvider
import '../../core/config/app_config.dart';
import '../task/task_repository.dart'; // taskListProvider

/// Runs a Config readiness check — `POST /config/{configId}/simulate`, a
/// dry-run against the config's own persisted deviceModel/protocol/fields
/// (see `backend/src/config/config.service.ts` `simulate()`). Does not touch
/// the config's status.
///
/// **Phase 1 scope — partial readiness check only.** This confirms the
/// selected Config is internally consistent (has fields at all, no negative
/// Timeout/Interval values in mock mode) — it does **not** confirm the
/// selected device's actual model/protocol matches this Config. That
/// compatibility check exists server-side only inside
/// `TaskService.assertConfigAssignable()` / the apply-config flow, not as a
/// standalone endpoint yet (see survey, 2026-09-07) — a real device+config
/// compatibility check is a Phase 2 follow-up pending a new backend endpoint
/// from [A]. The selected device is therefore not sent to this call at all;
/// it is only carried in the UI for context and to require a deliberate
/// device+config pairing before "ทดสอบความพร้อม" is enabled.
abstract class SimulatorRepository {
  Future<SimulationResult> simulate({required String configId});
}

/// Talks to the real backend.
class ApiSimulatorRepository implements SimulatorRepository {
  ApiSimulatorRepository(this._api);

  final ApiClient _api;

  @override
  Future<SimulationResult> simulate({required String configId}) =>
      _api.simulateConfig(configId: configId);
}

/// In-memory fake for `API_MOCK_MODE`.
class MockSimulatorRepository implements SimulatorRepository {
  @override
  Future<SimulationResult> simulate({required String configId}) async {
    await Future<void>.delayed(const Duration(milliseconds: 600));
    final passed = configId.trim().isNotEmpty;
    return SimulationResult(
      passed: passed,
      details: [
        'MOCK — ยังไม่ได้เรียก backend จริง',
        'configId = $configId',
        if (passed) 'ทุก field ผ่านการตรวจ (จำลอง)' else 'ต้องระบุ configId',
      ],
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
