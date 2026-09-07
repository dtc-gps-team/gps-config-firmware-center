import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/auth/auth_controller.dart'; // apiClientProvider
import '../../core/config/app_config.dart';

/// Registers / unregisters this device's FCM token with the backend
/// (`POST` / `DELETE /notifications/device-tokens`, from PR A — see
/// `backend/src/notification/notification.controller.ts`). Talking to
/// Firebase itself (getting the token, listening for refresh) is
/// `PushNotificationService`'s job, not this repository's — this layer only
/// knows how to persist a token string against the signed-in user.
abstract class PushTokenRepository {
  Future<void> register({required String token, required String platform});
  Future<void> unregister(String token);
}

/// Talks to the real backend. Default outside `API_MOCK_MODE`.
class ApiPushTokenRepository implements PushTokenRepository {
  ApiPushTokenRepository(this._api);

  final ApiClient _api;

  @override
  Future<void> register({required String token, required String platform}) =>
      _api.registerDeviceToken(token: token, platform: platform);

  @override
  Future<void> unregister(String token) => _api.unregisterDeviceToken(token);
}

/// No-op fake for `API_MOCK_MODE` (dev without a backend).
class MockPushTokenRepository implements PushTokenRepository {
  @override
  Future<void> register({
    required String token,
    required String platform,
  }) async {
    await Future<void>.delayed(const Duration(milliseconds: 100));
  }

  @override
  Future<void> unregister(String token) async {
    await Future<void>.delayed(const Duration(milliseconds: 100));
  }
}

final pushTokenRepositoryProvider = Provider<PushTokenRepository>((ref) {
  if (AppConfig.apiMockMode) return MockPushTokenRepository();
  return ApiPushTokenRepository(ref.watch(apiClientProvider));
});
