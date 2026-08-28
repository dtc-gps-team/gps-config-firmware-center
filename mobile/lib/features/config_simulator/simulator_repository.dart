import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/models.dart';

/// Runs a Config/Firmware simulation. Phase 1 ships only the mock — the real
/// implementation will call `POST /config/{configId}/simulate` once the backend
/// endpoint is wired up.
abstract class SimulatorRepository {
  Future<SimulationResult> simulate({
    required String configId,
    required String deviceModel,
  });
}

class MockSimulatorRepository implements SimulatorRepository {
  @override
  Future<SimulationResult> simulate({
    required String configId,
    required String deviceModel,
  }) async {
    await Future<void>.delayed(const Duration(milliseconds: 600));
    final passed = deviceModel.trim().isNotEmpty && configId.trim().isNotEmpty;
    return SimulationResult(
      passed: passed,
      details: [
        'MOCK — ยังไม่ได้เรียก backend จริง',
        'configId = $configId',
        'deviceModel = $deviceModel',
        if (passed)
          'ทุก field ผ่านการตรวจ (จำลอง)'
        else
          'ต้องระบุ configId และ deviceModel',
      ],
    );
  }
}

final simulatorRepositoryProvider = Provider<SimulatorRepository>(
  (ref) => MockSimulatorRepository(),
);
