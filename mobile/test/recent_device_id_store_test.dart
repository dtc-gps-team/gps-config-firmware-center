import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/device_connection_test/recent_device_id_store.dart';

void main() {
  group('InMemoryRecentDeviceIdStore', () {
    test('read() คืน list ว่างตอนยังไม่เคย add', () async {
      final store = InMemoryRecentDeviceIdStore();
      expect(await store.read(), isEmpty);
    });

    test('add() หลายตัว -> ใหม่สุดอยู่หน้าสุด', () async {
      final store = InMemoryRecentDeviceIdStore();
      await store.add('DEV-1');
      await store.add('DEV-2');
      await store.add('DEV-3');

      expect(await store.read(), ['DEV-3', 'DEV-2', 'DEV-1']);
    });

    test('add() ค่าที่ซ้ำเดิม -> ย้ายขึ้นมาบนสุดแทนการเก็บซ้ำ', () async {
      final store = InMemoryRecentDeviceIdStore();
      await store.add('DEV-1');
      await store.add('DEV-2');
      await store.add('DEV-1'); // ซ้ำ

      final result = await store.read();
      expect(result, ['DEV-1', 'DEV-2']);
      expect(result.length, 2);
    });

    test('เก็บสูงสุด 5 รายการล่าสุด ตัวเก่าสุดหลุดออก', () async {
      final store = InMemoryRecentDeviceIdStore();
      for (var i = 1; i <= 6; i++) {
        await store.add('DEV-$i');
      }

      final result = await store.read();
      expect(result.length, 5);
      expect(result, ['DEV-6', 'DEV-5', 'DEV-4', 'DEV-3', 'DEV-2']);
      expect(result, isNot(contains('DEV-1')));
    });

    test(
      'clear() ล้างประวัติทั้งหมด (issue #204 — ต้องไม่เหลือของ session ก่อนหน้า)',
      () async {
        final store = InMemoryRecentDeviceIdStore();
        await store.add('DEV-1');
        await store.add('DEV-2');

        await store.clear();

        expect(await store.read(), isEmpty);
      },
    );
  });
}
