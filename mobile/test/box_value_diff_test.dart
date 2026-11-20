import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/config_override/box_value_diff.dart';

/// ค่าในกล่องจริงที่ต่างจากค่าใน Config (docs/33 §11.6 ข้อ 1) — Override ใช้ครั้งเดียว
/// ส่งแล้วหน้าจอกลับเป็นค่าตาม Config แต่กล่องยังใช้ค่าที่แก้ ช่างต้องเห็นว่าต่างกัน
void main() {
  test('คืนเฉพาะ key ที่กล่องรายงานค่าต่างจาก Config', () {
    expect(
      boxDiffersFromConfig(
        {'meitrack.led_off': false, 'meitrack.track_interval_sec': 60},
        {'meitrack.led_off': true, 'meitrack.track_interval_sec': 60},
      ),
      ['meitrack.led_off'],
    );
  });

  test('ไม่รู้ค่าในกล่อง (box null หรือไม่มี key) -> ไม่นับว่าต่าง', () {
    expect(boxDiffersFromConfig({'a': 1}, null), isEmpty);
    expect(boxDiffersFromConfig({'a': 1}, {'b': 2}), isEmpty);
  });

  test('ตัวเลขค่าเดียวกันคนละชนิด (30 กับ 30.0) -> ไม่นับว่าต่าง', () {
    expect(boxDiffersFromConfig({'a': 30}, {'a': 30.0}), isEmpty);
  });

  test('object / list เทียบตามเนื้อหา', () {
    expect(
      boxDiffersFromConfig(
        {
          'idling': {'a': 1},
        },
        {
          'idling': {'a': 1},
        },
      ),
      isEmpty,
    );
    expect(
      boxDiffersFromConfig(
        {
          'idling': {'a': 1},
        },
        {
          'idling': {'a': 2},
        },
      ),
      ['idling'],
    );
  });
}
