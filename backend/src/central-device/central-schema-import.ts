/**
 * แปลง schema ของกล่องจาก Server กลาง (ESP32 Central Management, `GET /api/admin/schemas/{model}/{ver}`)
 * เป็นรายการ Parameter Library ของเรา (`ConfigFieldDefinition`) ให้สร้าง Config สำหรับกล่องได้ด้วยชื่อ
 * พารามิเตอร์ตัวเดียวกับที่ Server กลางรับ (`gps.send_interval_sec` ฯลฯ) · ฟังก์ชันล้วน เทสได้ ไม่แตะฐานข้อมูล
 */

export interface CentralSchemaParameter {
  key: string;
  label?: string;
  type: string;
  options?: (string | number)[];
  min?: number;
  max?: number;
  default?: unknown;
  pattern?: string;
  max_length?: number;
}

export interface CentralSchemaDoc {
  hardware_model: string;
  schema_version: number;
  parameters: CentralSchemaParameter[];
}

/** แถวที่จะ upsert ลง `ConfigFieldDefinition` (ชื่อ field ตรงกับ schema.prisma) */
export interface DefinitionSeed {
  fieldName: string;
  dataType: string;
  allowedValues: string[];
  required: boolean;
  unknownSpec: boolean;
  description: string | null;
  unit: string | null;
  category: string | null;
  defaultValue: string | null;
  restartRequired: boolean;
  sensitive: boolean;
}

export interface ImportPlan {
  definitions: DefinitionSeed[];
  /** พารามิเตอร์ที่แปลงไม่ได้ (ชนิดที่ไม่รู้จัก) ไม่ถูกนำเข้า */
  skipped: { key: string; reason: string }[];
}

const TYPE_MAP: Record<string, string> = {
  boolean: 'boolean',
  integer: 'integer',
  number: 'decimal',
  // enum ของ Server กลางคือรายการตัวเลือกคงที่: ใช้ string + allowedValues (ค่าตัวเลขแปลงเป็นข้อความ
  // ตอนเก็บ และแปลงกลับเป็นชนิดเดิมตอนส่งตาม schema ที่กล่องรายงาน — ดู `buildCentralSettings`)
  enum: 'string',
  string: 'string',
  hostname: 'string',
};

const CATEGORY_BY_PREFIX: Record<string, string> = {
  led: 'LED',
  gps: 'GPS',
  data_server: 'Data Server',
  speed_limit: 'ความเร็ว',
  geofence: 'Geofence',
};

const UNIT_BY_SUFFIX: [RegExp, string][] = [
  [/_sec$/, 'วินาที'],
  [/_kmh$/, 'กม./ชม.'],
  [/_m$/, 'เมตร'],
];

/** หน่วยจากวงเล็บท้ายป้าย เช่น "รอบส่ง GPS (วินาที)" · ข้ามวงเล็บที่เป็นคำอธิบายยาวหรือมี "=" */
function unitFromLabel(label: string | undefined): string | null {
  const m = /\(([^()]+)\)\s*$/.exec(label ?? '');
  if (!m) return null;
  const inner = m[1].trim();
  return inner.length > 0 && inner.length <= 12 && !inner.includes('=')
    ? inner
    : null;
}

function unitFor(p: CentralSchemaParameter): string | null {
  const fromLabel = unitFromLabel(p.label);
  if (fromLabel) return fromLabel;
  for (const [re, unit] of UNIT_BY_SUFFIX) {
    if (re.test(p.key)) return unit;
  }
  return null;
}

function categoryFor(key: string): string | null {
  const prefix = key.split('.')[0];
  return CATEGORY_BY_PREFIX[prefix] ?? (prefix ? prefix : null);
}

/** ค่าเริ่มต้นเป็นข้อความ (ค่าที่ไม่ใช่ข้อความ/ตัวเลข/boolean ถือว่าไม่มี ไม่เดา) */
function defaultAsText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

export function mapCentralParameter(
  p: CentralSchemaParameter,
): DefinitionSeed | { skipped: string } {
  const dataType = TYPE_MAP[p.type];
  if (!dataType) return { skipped: `ไม่รู้จักชนิดข้อมูล "${p.type}"` };
  if (p.type === 'enum' && (!p.options || p.options.length === 0)) {
    return { skipped: 'enum ไม่มีตัวเลือก' };
  }
  return {
    fieldName: p.key,
    dataType,
    allowedValues: p.type === 'enum' ? (p.options ?? []).map(String) : [],
    required: false,
    unknownSpec: false,
    description: p.label?.trim() ? p.label.trim() : null,
    unit: unitFor(p),
    category: categoryFor(p.key),
    defaultValue: defaultAsText(p.default),
    restartRequired: false,
    sensitive: false,
  };
}

/** แผนนำเข้าทั้ง schema: key ซ้ำในไฟล์เดียวใช้ตัวหลังสุด · ชนิดที่แปลงไม่ได้ถูกข้ามพร้อมเหตุผล */
export function planCentralSchemaImport(schema: CentralSchemaDoc): ImportPlan {
  const byKey = new Map<string, DefinitionSeed>();
  const skipped: ImportPlan['skipped'] = [];
  for (const p of schema.parameters) {
    const mapped = mapCentralParameter(p);
    if ('skipped' in mapped) {
      skipped.push({ key: p.key, reason: mapped.skipped });
    } else {
      byKey.set(mapped.fieldName, mapped);
    }
  }
  return { definitions: [...byKey.values()], skipped };
}
