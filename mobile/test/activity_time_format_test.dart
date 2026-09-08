import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/activity_log/activity_time_format.dart';

void main() {
  final now = DateTime(2026, 9, 8, 12, 0, 0);

  test('< 45 วินาที -> "เมื่อสักครู่"', () {
    expect(
      activityRelativeTime(now.subtract(const Duration(seconds: 10)), now),
      'เมื่อสักครู่',
    );
  });

  test('นาที', () {
    expect(
      activityRelativeTime(now.subtract(const Duration(minutes: 5)), now),
      '5 นาทีที่แล้ว',
    );
  });

  test('ชั่วโมง', () {
    expect(
      activityRelativeTime(now.subtract(const Duration(hours: 3)), now),
      '3 ชั่วโมงที่แล้ว',
    );
  });

  test('วัน (< 7)', () {
    expect(
      activityRelativeTime(now.subtract(const Duration(days: 2)), now),
      '2 วันที่แล้ว',
    );
  });

  test('>= 7 วัน -> วันที่ d/M', () {
    expect(activityRelativeTime(DateTime(2026, 8, 20, 9), now), '20/8');
  });

  test('เวลาในอนาคต (clock skew) -> "เมื่อสักครู่" ไม่ติดลบ', () {
    expect(
      activityRelativeTime(now.add(const Duration(minutes: 3)), now),
      'เมื่อสักครู่',
    );
  });
}
