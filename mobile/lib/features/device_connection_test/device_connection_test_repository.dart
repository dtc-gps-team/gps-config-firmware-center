import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/auth/auth_controller.dart'; // apiClientProvider

abstract class DeviceConnectionTestRepository {
  Future<DeviceConnectionTestResult> testConnection(String deviceId);
}

/// Calls the real backend — `POST /devices/{deviceId}/test-connection` is live
/// as of PR #54 (verified with curl). Unlike `config_simulator`, which still
/// ships a mock because its backend endpoint was not ready, this feature has
/// no mock implementation.
class ApiDeviceConnectionTestRepository
    implements DeviceConnectionTestRepository {
  ApiDeviceConnectionTestRepository(this._apiClient);

  final ApiClient _apiClient;

  @override
  Future<DeviceConnectionTestResult> testConnection(String deviceId) {
    return _apiClient.testDeviceConnection(deviceId);
  }
}

final deviceConnectionTestRepositoryProvider =
    Provider<DeviceConnectionTestRepository>(
      (ref) => ApiDeviceConnectionTestRepository(ref.watch(apiClientProvider)),
    );
