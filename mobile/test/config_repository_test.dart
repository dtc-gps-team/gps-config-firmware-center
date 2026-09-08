import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/features/config_simulator/config_repository.dart';

void main() {
  group('MockConfigRepository', () {
    test('listConfigs() คืนทั้ง 3 สถานะ (approved/synced/draft)', () async {
      final configs = await MockConfigRepository().listConfigs();

      expect(configs, hasLength(3));
      expect(
        configs.map((c) => c.status),
        containsAll(<ConfigStatus>[
          ConfigStatus.approved,
          ConfigStatus.synced,
          ConfigStatus.draft,
        ]),
      );
    });
  });

  test(
    'configRepositoryProvider ให้ ApiConfigRepository เมื่อ API_MOCK_MODE=false (default ตอนรันเทส)',
    () {
      final container = ProviderContainer();
      addTearDown(container.dispose);
      expect(
        container.read(configRepositoryProvider),
        isA<ApiConfigRepository>(),
      );
    },
  );

  group('deployableConfigListProvider', () {
    test(
      'กรองเหลือแค่ approved/synced — ตัด draft ออก (POST '
      '/devices/{deviceId}/simulate-config ปฏิเสธด้วย 409 ถ้าไม่ใช่ 2 สถานะนี้ '
      'ดู backend/src/device/config-applier.ts APPLICABLE_CONFIG_STATUSES)',
      () async {
        final container = ProviderContainer(
          overrides: [
            configRepositoryProvider.overrideWithValue(MockConfigRepository()),
          ],
        );
        addTearDown(container.dispose);

        final result = await container.read(
          deployableConfigListProvider.future,
        );

        expect(result, hasLength(2));
        expect(
          result.map((c) => c.status),
          everyElement(anyOf(ConfigStatus.approved, ConfigStatus.synced)),
        );
      },
    );
  });
}
