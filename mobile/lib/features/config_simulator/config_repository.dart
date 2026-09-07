import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/models.dart';
import '../../core/auth/auth_controller.dart'; // apiClientProvider
import '../../core/config/app_config.dart';

/// Lists Configs (`GET /config`) — not scoped per-user by the backend, so
/// every role sees the same list.
abstract class ConfigRepository {
  Future<List<DeviceConfigDraft>> listConfigs();
}

/// Talks to the real backend.
class ApiConfigRepository implements ConfigRepository {
  ApiConfigRepository(this._api);

  final ApiClient _api;

  @override
  Future<List<DeviceConfigDraft>> listConfigs() => _api.listConfigs();
}

/// In-memory fake for `API_MOCK_MODE`.
class MockConfigRepository implements ConfigRepository {
  final List<DeviceConfigDraft> _configs = const [
    DeviceConfigDraft(
      id: 'mock-config-1',
      deviceModel: 'GT06N',
      protocol: 'TCP',
      status: ConfigStatus.draft,
      fields: {'APN': 'internet'},
    ),
    DeviceConfigDraft(
      id: 'mock-config-2',
      deviceModel: 'GT06N',
      protocol: 'TCP',
      status: ConfigStatus.testing,
      fields: {'APN': 'internet', 'REPORT_INTERVAL_MOVING': 30},
    ),
    // approved -> intentionally excluded by simulatableConfigListProvider,
    // kept here so MockConfigRepository.listConfigs() itself (unfiltered)
    // has a non-simulatable example to test that filter against.
    DeviceConfigDraft(
      id: 'mock-config-3',
      deviceModel: 'GT06L',
      protocol: 'TCP',
      status: ConfigStatus.approved,
      fields: {'APN': 'internet'},
    ),
  ];

  @override
  Future<List<DeviceConfigDraft>> listConfigs() async {
    await Future<void>.delayed(const Duration(milliseconds: 250));
    return List.unmodifiable(_configs);
  }
}

final configRepositoryProvider = Provider<ConfigRepository>((ref) {
  if (AppConfig.apiMockMode) return MockConfigRepository();
  return ApiConfigRepository(ref.watch(apiClientProvider));
});

/// Configs eligible for a readiness check. `POST /config/{id}/simulate`
/// blocks (409) anything outside `draft`/`testing` — see
/// `backend/src/config/config-status.ts` `SIMULATABLE_CONFIG_STATUSES` — so
/// the picker only offers configs that won't immediately fail. Filtered
/// client-side because `GET /config`'s `status` query param only accepts one
/// value, not "draft or testing".
final simulatableConfigListProvider =
    FutureProvider.autoDispose<List<DeviceConfigDraft>>((ref) async {
      final all = await ref.watch(configRepositoryProvider).listConfigs();
      return all
          .where(
            (c) =>
                c.status == ConfigStatus.draft ||
                c.status == ConfigStatus.testing,
          )
          .toList(growable: false);
    });
