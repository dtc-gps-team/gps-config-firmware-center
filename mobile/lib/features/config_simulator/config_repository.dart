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
      status: ConfigStatus.approved,
      fields: {'APN': 'internet'},
    ),
    DeviceConfigDraft(
      id: 'mock-config-2',
      deviceModel: 'GT06N',
      protocol: 'TCP',
      status: ConfigStatus.synced,
      fields: {'APN': 'internet', 'REPORT_INTERVAL_MOVING': 30},
    ),
    // draft -> intentionally excluded by deployableConfigListProvider (endpoint
    // 409s anything outside approved/synced), kept here so
    // MockConfigRepository.listConfigs() itself (unfiltered) has a
    // non-deployable example to test that filter against.
    DeviceConfigDraft(
      id: 'mock-config-3',
      deviceModel: 'GT06L',
      protocol: 'TCP',
      status: ConfigStatus.draft,
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

/// Configs ที่พร้อมเช็คความพร้อมกับอุปกรณ์จริง (`POST
/// /devices/{deviceId}/simulate-config` บล็อก 409 ถ้าไม่ใช่สถานะนี้ — ดู
/// `APPLICABLE_CONFIG_STATUSES` ใน `backend/src/device/config-applier.ts`,
/// ชุดเดียวกับที่ `applyConfigToDevice` ใช้). Filtered client-side because
/// `GET /config`'s `status` query param only accepts one value, not
/// "approved or synced".
final deployableConfigListProvider =
    FutureProvider.autoDispose<List<DeviceConfigDraft>>((ref) async {
      final all = await ref.watch(configRepositoryProvider).listConfigs();
      return all
          .where(
            (c) =>
                c.status == ConfigStatus.approved ||
                c.status == ConfigStatus.synced,
          )
          .toList(growable: false);
    });
