import 'config_value_parser.dart';

/// key ของค่าใน [config] ที่กล่องรายงานว่าใช้ค่าอื่นอยู่ ([box] = `boxFields`
/// ค่าที่อ่านจากกล่องจริง) · ไม่รู้ค่าในกล่อง (null / ไม่มี key) = ไม่นับว่าต่าง
///
/// docs/33 §11.6 ข้อ 1 — Override ใช้ครั้งเดียว (มติ B 2026-11-03) ส่งแล้วค่าที่
/// แสดงกลับเป็นค่าตาม Config ทั้งที่กล่องยังใช้ค่าที่แก้ · ตัวเลขเทียบตามค่า
/// (30 = 30.0) ที่เหลือเทียบตามข้อความเดียวกับที่ช่องกรอกแสดง
List<String> boxDiffersFromConfig(
  Map<String, dynamic> config,
  Map<String, dynamic>? box,
) {
  if (box == null) return const [];
  return [
    for (final entry in config.entries)
      if (box.containsKey(entry.key) && !_same(entry.value, box[entry.key]))
        entry.key,
  ];
}

bool _same(dynamic a, dynamic b) {
  if (a is num && b is num) return a == b;
  return configValueToInput(a) == configValueToInput(b);
}
