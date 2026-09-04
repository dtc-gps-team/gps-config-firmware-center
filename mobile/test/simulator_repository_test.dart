import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/config_simulator/simulator_repository.dart';

void main() {
  group('MockSimulatorRepository', () {
    test(
      'configId + deviceModel ครบ -> passed + details มี MOCK/ค่าที่ส่ง',
      () async {
        final result = await MockSimulatorRepository().simulate(
          configId: 'cfg-1',
          deviceModel: 'GT06N',
        );

        expect(result.passed, isTrue);
        expect(result.details.first, startsWith('MOCK'));
        expect(result.details, contains('configId = cfg-1'));
        expect(result.details, contains('deviceModel = GT06N'));
        expect(
          result.details.any((line) => line.contains('ผ่านการตรวจ')),
          isTrue,
        );
      },
    );

    test('configId ว่าง -> ไม่ผ่าน + แจ้งให้ระบุครบ', () async {
      final result = await MockSimulatorRepository().simulate(
        configId: '',
        deviceModel: 'GT06N',
      );

      expect(result.passed, isFalse);
      expect(result.details.first, startsWith('MOCK'));
      expect(result.details, contains('ต้องระบุ configId และ deviceModel'));
    });

    test('deviceModel เป็น whitespace ล้วน -> ไม่ผ่าน', () async {
      final result = await MockSimulatorRepository().simulate(
        configId: 'cfg-1',
        deviceModel: '   ',
      );

      expect(result.passed, isFalse);
      expect(result.details, contains('ต้องระบุ configId และ deviceModel'));
    });

    test('ทั้งคู่ว่าง -> ไม่ผ่าน', () async {
      final result = await MockSimulatorRepository().simulate(
        configId: '',
        deviceModel: '',
      );
      expect(result.passed, isFalse);
    });
  });

  test('simulatorRepositoryProvider ให้ MockSimulatorRepository (Phase 1)', () {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    expect(
      container.read(simulatorRepositoryProvider),
      isA<MockSimulatorRepository>(),
    );
  });
}
