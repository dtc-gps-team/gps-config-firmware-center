import 'dart:convert';

/// ชุด `dataType` ที่ backend รู้จัก (PR #255 / issue #201) —
/// `integer, decimal, string, text, boolean, date, datetime, json, array, uuid`
/// บวก `number` ที่เป็น **legacy alias** ของ `integer`/`decimal`: field เดิมที่
/// ยังไม่ผ่าน backfill (`prisma db seed`) อาจยังตอบ `number` อยู่ชั่วคราว
/// ต้องไม่พังทันทีที่ deploy (backend เองก็คง `case 'number'` ไว้เช่นกัน)
bool isIntegerDataType(String dataType) => dataType == 'integer';

bool isDecimalDataType(String dataType) =>
    dataType == 'decimal' || dataType == 'number';

bool isNumericDataType(String dataType) =>
    isIntegerDataType(dataType) || isDecimalDataType(dataType);

bool isJsonDataType(String dataType) =>
    dataType == 'json' || dataType == 'array';

/// ผลของการ parse ค่าจากช่อง input: มี `value` (ผ่าน) หรือ `error` (ไม่ผ่าน)
/// อย่างใดอย่างหนึ่งเท่านั้น — ไม่ throw เพื่อให้ฟอร์มโชว์ error ได้เอง
class ConfigValueParseResult {
  const ConfigValueParseResult.ok(this.value) : error = null;
  const ConfigValueParseResult.fail(String this.error) : value = null;

  final dynamic value;
  final String? error;

  bool get isOk => error == null;
}

// regex ชุดเดียวกับ backend (`config-definition.service.ts`) — กันค่าที่
// `num.tryParse` ยอมแต่ไม่ใช่ตัวเลขธรรมดา เช่น `0x10`, `1e3`, `Infinity`
final _integerRegex = RegExp(r'^-?\d+$');
final _decimalRegex = RegExp(r'^-?\d+(\.\d+)?$');
final _dateRegex = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$');
final _datetimeRegex = RegExp(
  r'^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$',
);
final _uuidRegex = RegExp(
  r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
  caseSensitive: false,
);

bool _isValidCalendarDate(int y, int m, int d) {
  // DateTime rollover วันที่ผิดเงียบๆ (2026-02-31 -> 3 มี.ค.) จึงอ่านกลับมาเทียบ
  final dt = DateTime.utc(y, m, d);
  return dt.year == y && dt.month == m && dt.day == d;
}

/// parse ค่าจาก input (string เสมอ) ตาม `dataType` ของ field — mirror
/// `matchesDataType` ฝั่ง backend เพื่อให้ error ขึ้นที่ฟอร์มก่อนยิง API
ConfigValueParseResult parseConfigValue(String raw, String dataType) {
  if (isIntegerDataType(dataType)) {
    final text = raw.trim();
    if (!_integerRegex.hasMatch(text)) {
      return const ConfigValueParseResult.fail('ต้องเป็นจำนวนเต็ม');
    }
    final n = int.tryParse(text);
    if (n == null) {
      return const ConfigValueParseResult.fail('ตัวเลขใหญ่เกินไป');
    }
    return ConfigValueParseResult.ok(n);
  }

  if (isDecimalDataType(dataType)) {
    final text = raw.trim();
    if (!_decimalRegex.hasMatch(text)) {
      return const ConfigValueParseResult.fail('ต้องเป็นตัวเลข');
    }
    final n = num.tryParse(text);
    if (n == null || !n.isFinite) {
      return const ConfigValueParseResult.fail('ต้องเป็นตัวเลข');
    }
    return ConfigValueParseResult.ok(n);
  }

  switch (dataType) {
    case 'boolean':
      if (raw == 'true') return const ConfigValueParseResult.ok(true);
      if (raw == 'false') return const ConfigValueParseResult.ok(false);
      return const ConfigValueParseResult.fail('เลือก true หรือ false');
    case 'json':
    case 'array':
      final Object? decoded;
      try {
        decoded = jsonDecode(raw);
      } on FormatException {
        return const ConfigValueParseResult.fail('JSON ไม่ถูกต้อง');
      }
      if (dataType == 'json') {
        return decoded is Map<String, dynamic>
            ? ConfigValueParseResult.ok(decoded)
            : const ConfigValueParseResult.fail(
                'ต้องเป็น JSON object เช่น {"key": "value"}',
              );
      }
      return decoded is List
          ? ConfigValueParseResult.ok(decoded)
          : const ConfigValueParseResult.fail('ต้องเป็น array เช่น [1, 2, 3]');
    case 'date':
      final m = _dateRegex.firstMatch(raw);
      if (m == null ||
          !_isValidCalendarDate(
            int.parse(m.group(1)!),
            int.parse(m.group(2)!),
            int.parse(m.group(3)!),
          )) {
        return const ConfigValueParseResult.fail(
          'วันที่ไม่ถูกต้อง (รูปแบบ YYYY-MM-DD)',
        );
      }
      return ConfigValueParseResult.ok(raw);
    case 'datetime':
      final m = _datetimeRegex.firstMatch(raw);
      final valid =
          m != null &&
          _isValidCalendarDate(
            int.parse(m.group(1)!),
            int.parse(m.group(2)!),
            int.parse(m.group(3)!),
          ) &&
          int.parse(m.group(4)!) <= 23 &&
          int.parse(m.group(5)!) <= 59 &&
          int.parse(m.group(6)!) <= 59;
      return valid
          ? ConfigValueParseResult.ok(raw)
          : const ConfigValueParseResult.fail(
              'วันเวลาไม่ถูกต้อง (รูปแบบ YYYY-MM-DDTHH:MM:SS)',
            );
    case 'uuid':
      return _uuidRegex.hasMatch(raw)
          ? ConfigValueParseResult.ok(raw)
          : const ConfigValueParseResult.fail('UUID ไม่ถูกต้อง');
    default:
      // string / text (และชนิดที่ไม่รู้จัก — backend เป็นคนตัดสิน)
      return ConfigValueParseResult.ok(raw);
  }
}

/// แปลงค่าปัจจุบันของ field เป็นข้อความสำหรับช่อง input — object/array ต้องเป็น
/// JSON จริง (ไม่ใช่ `Map.toString()` แบบ `{a: 1}`) ไม่งั้น parse กลับไม่ได้
/// และการเทียบ "แก้ค่าหรือยัง" ผิดเพี้ยน
String configValueToInput(dynamic value) {
  if (value == null) return '';
  if (value is Map || value is List) return jsonEncode(value);
  return value.toString();
}
