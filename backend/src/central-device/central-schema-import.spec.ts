import {
  type CentralSchemaDoc,
  mapCentralParameter,
  planCentralSchemaImport,
} from './central-schema-import';

// schema เวอร์ชัน 1 จริงของกล่อง (ESP32-DEVKIT-V1 firmware 1.0.0)
const schema1: CentralSchemaDoc = {
  hardware_model: 'ESP32-DEVKIT-V1',
  schema_version: 1,
  parameters: [
    { key: 'led.enabled', label: 'เปิดไฟ LED', type: 'boolean', default: true },
    { key: 'gps.enabled', label: 'เปิด GPS', type: 'boolean', default: true },
    {
      key: 'gps.baud_rate',
      label: 'GPS Baud Rate',
      type: 'enum',
      options: [4800, 9600, 38400],
      default: 9600,
    },
    {
      key: 'gps.send_interval_sec',
      label: 'รอบส่ง GPS (วินาที)',
      type: 'integer',
      min: 5,
      max: 3600,
      default: 10,
    },
    {
      key: 'data_server.protocol',
      label: 'โปรโตคอลส่งข้อมูล',
      type: 'enum',
      options: ['https', 'http'],
      default: 'https',
    },
    {
      key: 'data_server.host',
      label: 'โฮสต์ปลายทาง (ว่าง = ไม่ส่งพิกัด)',
      type: 'hostname',
      default: '',
    },
    {
      key: 'data_server.port',
      label: 'พอร์ต',
      type: 'integer',
      min: 1,
      max: 65535,
      default: 443,
    },
    {
      key: 'data_server.path',
      label: 'API Path',
      type: 'string',
      default: '/api/gps',
    },
  ],
};

describe('mapCentralParameter', () => {
  it('boolean และ integer แปลงตรงตัว พร้อมค่าเริ่มต้นเป็นข้อความ', () => {
    expect(
      mapCentralParameter({
        key: 'led.enabled',
        type: 'boolean',
        default: true,
      }),
    ).toMatchObject({
      fieldName: 'led.enabled',
      dataType: 'boolean',
      defaultValue: 'true',
      allowedValues: [],
    });
    expect(
      mapCentralParameter({
        key: 'data_server.port',
        type: 'integer',
        default: 443,
      }),
    ).toMatchObject({ dataType: 'integer', defaultValue: '443' });
  });

  it('number เป็น decimal ส่วน enum เป็น string พร้อมตัวเลือกเป็นข้อความ (ตัวเลขก็แปลงเป็นข้อความ)', () => {
    expect(
      mapCentralParameter({ key: 'geofence.center_lat', type: 'number' }),
    ).toMatchObject({ dataType: 'decimal' });
    expect(
      mapCentralParameter({
        key: 'gps.baud_rate',
        type: 'enum',
        options: [4800, 9600],
        default: 9600,
      }),
    ).toMatchObject({
      dataType: 'string',
      allowedValues: ['4800', '9600'],
      defaultValue: '9600',
    });
  });

  it('hostname เป็น string และค่าเริ่มต้นว่างเก็บเป็นข้อความว่าง ไม่ใช่ null', () => {
    expect(
      mapCentralParameter({
        key: 'data_server.host',
        type: 'hostname',
        default: '',
      }),
    ).toMatchObject({ dataType: 'string', defaultValue: '' });
  });

  it('ไม่มีค่าเริ่มต้น: defaultValue เป็น null', () => {
    expect(
      mapCentralParameter({ key: 'geofence.enabled', type: 'boolean' }),
    ).toMatchObject({ defaultValue: null });
  });

  it('หน่วย: จากวงเล็บท้ายป้าย หรือจากท้ายชื่อคีย์ และไม่เอาวงเล็บที่เป็นคำอธิบาย', () => {
    expect(
      mapCentralParameter({
        key: 'gps.send_interval_sec',
        label: 'รอบส่ง GPS (วินาที)',
        type: 'integer',
      }),
    ).toMatchObject({ unit: 'วินาที' });
    expect(
      mapCentralParameter({ key: 'speed_limit.max_kmh', type: 'number' }),
    ).toMatchObject({ unit: 'กม./ชม.' });
    expect(
      mapCentralParameter({ key: 'geofence.radius_m', type: 'integer' }),
    ).toMatchObject({ unit: 'เมตร' });
    expect(
      mapCentralParameter({
        key: 'data_server.host',
        label: 'โฮสต์ปลายทาง (ว่าง = ไม่ส่งพิกัด)',
        type: 'hostname',
      }),
    ).toMatchObject({ unit: null });
  });

  it('หมวดหมู่ตามส่วนหน้าของคีย์', () => {
    expect(
      mapCentralParameter({ key: 'gps.enabled', type: 'boolean' }),
    ).toMatchObject({
      category: 'GPS',
    });
    expect(
      mapCentralParameter({ key: 'data_server.host', type: 'hostname' }),
    ).toMatchObject({ category: 'Data Server' });
    expect(
      mapCentralParameter({ key: 'geofence.enabled', type: 'boolean' }),
    ).toMatchObject({ category: 'Geofence' });
    expect(
      mapCentralParameter({ key: 'newgroup.x', type: 'boolean' }),
    ).toMatchObject({
      category: 'newgroup',
    });
  });

  it('ชนิดที่ไม่รู้จัก หรือ enum ไม่มีตัวเลือก: ข้ามพร้อมเหตุผล', () => {
    expect(mapCentralParameter({ key: 'x.y', type: 'weird' })).toEqual({
      skipped: 'ไม่รู้จักชนิดข้อมูล "weird"',
    });
    expect(mapCentralParameter({ key: 'x.z', type: 'enum' })).toEqual({
      skipped: 'enum ไม่มีตัวเลือก',
    });
  });

  it('คืนช่อง ไม่ใช่ secret/restart: sensitive และ restartRequired เป็น false (ไม่เดา)', () => {
    expect(
      mapCentralParameter({ key: 'led.enabled', type: 'boolean' }),
    ).toMatchObject({
      sensitive: false,
      restartRequired: false,
      required: false,
      unknownSpec: false,
    });
  });
});

describe('planCentralSchemaImport', () => {
  it('schema เวอร์ชัน 1: นำเข้าครบ 8 ตัวด้วยชื่อคีย์เดิม ไม่มีที่ข้าม', () => {
    const plan = planCentralSchemaImport(schema1);
    expect(plan.skipped).toEqual([]);
    expect(plan.definitions.map((d) => d.fieldName)).toEqual([
      'led.enabled',
      'gps.enabled',
      'gps.baud_rate',
      'gps.send_interval_sec',
      'data_server.protocol',
      'data_server.host',
      'data_server.port',
      'data_server.path',
    ]);
  });

  it('คีย์ซ้ำใช้ตัวหลังสุด และชนิดแปลก ๆ ถูกข้ามพร้อมเหตุผล ไม่ทำให้ทั้งชุดล้ม', () => {
    const plan = planCentralSchemaImport({
      ...schema1,
      parameters: [
        { key: 'a.b', type: 'integer', default: 1 },
        { key: 'a.b', type: 'integer', default: 2 },
        { key: 'a.c', type: 'unknown' },
      ],
    });
    expect(plan.definitions).toHaveLength(1);
    expect(plan.definitions[0].defaultValue).toBe('2');
    expect(plan.skipped).toEqual([
      { key: 'a.c', reason: 'ไม่รู้จักชนิดข้อมูล "unknown"' },
    ]);
  });
});
