import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/config_override/config_value_parser.dart';

void main() {
  group('parseConfigValue', () {
    group('integer', () {
      test('ค่าถูกต้อง -> int', () {
        expect(parseConfigValue('8080', 'integer').value, 8080);
        expect(parseConfigValue('-5', 'integer').value, -5);
        expect(parseConfigValue(' 42 ', 'integer').value, 42);
      });

      test('ทศนิยม/hex/scientific/ว่าง/Infinity -> error', () {
        for (final bad in ['1.5', '0x10', '1e3', '', ' ', 'Infinity', 'abc']) {
          expect(parseConfigValue(bad, 'integer').isOk, isFalse, reason: bad);
        }
      });

      test('ใหญ่เกิน int -> error ไม่ throw', () {
        expect(parseConfigValue('99999999999999999999', 'integer').isOk, false);
      });
    });

    group('decimal และ legacy number', () {
      for (final type in ['decimal', 'number']) {
        test('$type: ค่าถูกต้อง -> num', () {
          expect(parseConfigValue('12.5', type).value, 12.5);
          expect(parseConfigValue('90', type).value, 90);
          expect(parseConfigValue('-0.25', type).value, -0.25);
        });

        test('$type: ค่าผิด -> error', () {
          for (final bad in ['', 'NaN', 'Infinity', '0x10', '1e3', '1.', 'x']) {
            expect(parseConfigValue(bad, type).isOk, isFalse, reason: bad);
          }
        });
      }
    });

    test('boolean', () {
      expect(parseConfigValue('true', 'boolean').value, true);
      expect(parseConfigValue('false', 'boolean').value, false);
      expect(parseConfigValue('yes', 'boolean').isOk, isFalse);
    });

    group('date', () {
      test('วันที่จริง -> string เดิม', () {
        expect(parseConfigValue('2026-02-28', 'date').value, '2026-02-28');
        expect(parseConfigValue('2028-02-29', 'date').isOk, isTrue);
      });

      test('วันที่ไม่มีจริง/รูปแบบผิด -> error', () {
        for (final bad in ['2026-02-31', '2026-13-01', '2026-2-1', '', 'x']) {
          expect(parseConfigValue(bad, 'date').isOk, isFalse, reason: bad);
        }
      });
    });

    group('datetime', () {
      test('ถูกต้อง (มี/ไม่มี timezone)', () {
        for (final ok in [
          '2026-10-06T08:30:00',
          '2026-10-06T08:30:00Z',
          '2026-10-06T08:30:00.123+07:00',
        ]) {
          expect(parseConfigValue(ok, 'datetime').value, ok);
        }
      });

      test('ผิด -> error', () {
        for (final bad in [
          '2026-10-06',
          '2026-02-31T00:00:00',
          '2026-10-06T24:00:00',
          '2026-10-06T08:60:00',
        ]) {
          expect(parseConfigValue(bad, 'datetime').isOk, isFalse, reason: bad);
        }
      });
    });

    group('json', () {
      test('object -> Map', () {
        expect(parseConfigValue('{"a": 1}', 'json').value, {'a': 1});
      });

      test('array/ค่าเดี่ยว/JSON เสีย -> error ไม่ throw', () {
        for (final bad in ['[1]', '"s"', '5', '{a: 1}', '', '{']) {
          expect(parseConfigValue(bad, 'json').isOk, isFalse, reason: bad);
        }
      });
    });

    group('array', () {
      test('array -> List', () {
        expect(parseConfigValue('[1, "a"]', 'array').value, [1, 'a']);
      });

      test('object/JSON เสีย -> error ไม่ throw', () {
        for (final bad in ['{"a": 1}', '1', '[1,', '']) {
          expect(parseConfigValue(bad, 'array').isOk, isFalse, reason: bad);
        }
      });
    });

    test('uuid', () {
      const ok = '123e4567-e89b-12d3-a456-426614174000';
      expect(parseConfigValue(ok, 'uuid').value, ok);
      expect(parseConfigValue('not-a-uuid', 'uuid').isOk, isFalse);
    });

    test('string/text -> ส่งค่าดิบ', () {
      expect(parseConfigValue('internet', 'string').value, 'internet');
      expect(parseConfigValue('บรรทัด 1\nบรรทัด 2', 'text').isOk, isTrue);
    });
  });

  group('configValueToInput', () {
    test('Map/List -> JSON จริง (parse กลับได้)', () {
      expect(configValueToInput({'a': 1}), '{"a":1}');
      expect(configValueToInput([1, 2]), '[1,2]');
    });

    test('null -> ว่าง, ชนิดอื่น -> toString', () {
      expect(configValueToInput(null), '');
      expect(configValueToInput(8080), '8080');
      expect(configValueToInput(true), 'true');
    });
  });
}
