import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/models.dart';
import 'package:mobile/features/config_simulator/config_repository.dart';

void main() {
  group('MockConfigRepository', () {
    test('listConfigs() คืนทั้ง 3 สถานะ (draft/testing/approved)', () async {
      final configs = await MockConfigRepository().listConfigs();

      expect(configs, hasLength(3));
      expect(
        configs.map((c) => c.status),
        containsAll(<ConfigStatus>[
          ConfigStatus.draft,
          ConfigStatus.testing,
          ConfigStatus.approved,
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

  group('simulatableConfigListProvider', () {
    test('กรองเหลือแค่ draft/testing — ตัด approved ออก (POST .../simulate '
        'ปฏิเสธด้วย 409 ถ้าไม่ใช่ 2 สถานะนี้ ดู backend/src/config/config-status.ts '
        'SIMULATABLE_CONFIG_STATUSES)', () async {
      final container = ProviderContainer(
        overrides: [
          configRepositoryProvider.overrideWithValue(MockConfigRepository()),
        ],
      );
      addTearDown(container.dispose);

      final result = await container.read(simulatableConfigListProvider.future);

      expect(result, hasLength(2));
      expect(
        result.map((c) => c.status),
        everyElement(anyOf(ConfigStatus.draft, ConfigStatus.testing)),
      );
    });
  });
}
