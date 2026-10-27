import { buildCentralSettings, classifyCentralCommand } from './central-config';
import type {
  RawCentralCommand,
  RawCentralSchema,
} from './central-device.types';

const schema: RawCentralSchema = {
  hardware_model: 'ESP32-DEVKIT-V1',
  schema_version: 1,
  parameters: [
    { key: 'led.enabled', type: 'boolean' },
    { key: 'gps.baud_rate', type: 'enum', options: [4800, 9600, 38400] },
    { key: 'gps.send_interval_sec', type: 'integer', min: 5, max: 3600 },
    { key: 'data_server.protocol', type: 'enum', options: ['https', 'http'] },
    { key: 'data_server.host', type: 'hostname' },
    { key: 'speed.limit_kmh', type: 'number' },
  ],
};

describe('buildCentralSettings', () => {
  it('แปลงคีย์มีจุดเป็นโครงซ้อนชั้น และแปลงชนิดค่าตาม schema', () => {
    const r = buildCentralSettings(
      {
        'led.enabled': 'false',
        'gps.send_interval_sec': '20',
        'gps.baud_rate': '9600',
        'data_server.protocol': 'http',
        'data_server.host': '172.20.10.2',
        'speed.limit_kmh': '80.5',
      },
      schema,
    );
    expect(r).toEqual({
      settings: {
        led: { enabled: false },
        gps: { send_interval_sec: 20, baud_rate: 9600 },
        data_server: { protocol: 'http', host: '172.20.10.2' },
        speed: { limit_kmh: 80.5 },
      },
    });
  });

  it('ค่าที่ชนิดตรงอยู่แล้วคงเดิม', () => {
    expect(
      buildCentralSettings(
        { 'led.enabled': true, 'gps.send_interval_sec': 30 },
        schema,
      ),
    ).toEqual({
      settings: { led: { enabled: true }, gps: { send_interval_sec: 30 } },
    });
  });

  it('คีย์ที่ schema ไม่มี -> ส่งไม่ได้ทั้งชุด บอกชื่อคีย์และโมเดล', () => {
    const r = buildCentralSettings(
      { 'gps.send_interval_sec': 20, APN: 'internet' },
      schema,
    );
    expect(r).toHaveProperty('errors');
    const errors = (r as { errors: string[] }).errors;
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('APN');
    expect(errors[0]).toContain('ESP32-DEVKIT-V1');
  });

  it.each([
    ['boolean', { 'led.enabled': 'yes' }],
    ['integer เป็นทศนิยม', { 'gps.send_interval_sec': 1.5 }],
    ['integer เป็นข้อความที่ไม่ใช่ตัวเลข', { 'gps.send_interval_sec': 'abc' }],
    ['integer เป็นข้อความว่าง', { 'gps.send_interval_sec': '  ' }],
    ['enum นอกตัวเลือก', { 'gps.baud_rate': 1200 }],
    ['string เป็น object', { 'data_server.host': { a: 1 } }],
  ])('ค่าแปลงไม่ได้ (%s) -> ส่งไม่ได้', (_name, fields) => {
    const r = buildCentralSettings(fields, schema);
    expect(r).toHaveProperty('errors');
  });

  it('รวมข้อผิดพลาดทุกข้อให้เห็นครั้งเดียว ไม่หยุดที่ข้อแรก', () => {
    const r = buildCentralSettings(
      { 'led.enabled': 'maybe', UNKNOWN: 1 },
      schema,
    );
    expect((r as { errors: string[] }).errors).toHaveLength(2);
  });

  it('ไม่มี field เลย -> ส่งไม่ได้', () => {
    expect(buildCentralSettings({}, schema)).toEqual({
      errors: ['Config ไม่มี field ใดเลยให้ส่ง'],
    });
  });

  it('ช่วงค่า (min/max) ไม่ตรวจเอง ปล่อยให้ Server กลางซึ่งเป็นเจ้าของกฎตัดสิน', () => {
    expect(
      buildCentralSettings({ 'gps.send_interval_sec': 1 }, schema),
    ).toEqual({
      settings: { gps: { send_interval_sec: 1 } },
    });
  });
});

describe('classifyCentralCommand', () => {
  const cmd = (over: Partial<RawCentralCommand>): RawCentralCommand => ({
    command_id: 'CMD-1',
    device_id: 'D',
    action: 'UPDATE_CONFIG',
    status: 'PENDING',
    ...over,
  });

  it.each(['PENDING', 'DELIVERED', 'ACKNOWLEDGED', 'DOWNLOADING', 'REBOOTING'])(
    'สถานะระหว่างทาง %s -> ยังรอ',
    (status) => {
      expect(classifyCentralCommand(cmd({ status }))).toEqual({
        kind: 'pending',
      });
    },
  );

  it('SUCCESS -> สำเร็จ', () => {
    expect(classifyCentralCommand(cmd({ status: 'SUCCESS' }))).toEqual({
      kind: 'success',
    });
  });

  it.each(['FAILED', 'ROLLED_BACK'])(
    '%s -> ล้มเหลว พร้อมรหัสและข้อความ',
    (status) => {
      const r = classifyCentralCommand(
        cmd({
          status,
          error_code: 'VALIDATION_FAILED',
          error_message: 'ค่าผิด',
        }),
      );
      expect(r.kind).toBe('failed');
      expect((r as { detail: string }).detail).toContain('VALIDATION_FAILED');
      expect((r as { detail: string }).detail).toContain('ค่าผิด');
    },
  );

  // ตรวจจากโค้ด gateway จริง: DEVICE_OFFLINE มาพร้อมสถานะ FAILED ไม่ใช่ EXPIRED
  it('FAILED จาก DEVICE_OFFLINE (กล่องออฟไลน์เกิน 600 วินาที) -> ข้าม ไม่นับล้มเหลว', () => {
    const r = classifyCentralCommand(
      cmd({ status: 'FAILED', error_code: 'DEVICE_OFFLINE' }),
    );
    expect(r.kind).toBe('skipped');
  });

  it.each([
    ['EXPIRED', 'TTL_EXPIRED'],
    ['EXPIRED', 'SUPERSEDED'],
    ['EXPIRED', 'CANCELLED'],
  ])('%s จาก %s -> ข้าม (ไม่ใช่ความผิดของ Config)', (status, error_code) => {
    expect(classifyCentralCommand(cmd({ status, error_code })).kind).toBe(
      'skipped',
    );
  });

  it('รหัสข้ามชนะสถานะ: แม้รหัส DEVICE_OFFLINE มากับสถานะอื่นที่จบแล้วก็ยังข้าม', () => {
    expect(
      classifyCentralCommand(
        cmd({ status: 'EXPIRED', error_code: 'DEVICE_OFFLINE' }),
      ).kind,
    ).toBe('skipped');
  });

  it('FAILED จาก DEVICE_NO_RESPONSE (ส่งถึงแล้วแต่กล่องเงียบ) -> ล้มเหลว', () => {
    expect(
      classifyCentralCommand(
        cmd({ status: 'FAILED', error_code: 'DEVICE_NO_RESPONSE' }),
      ).kind,
    ).toBe('failed');
  });

  it('EXPIRED จาก DEVICE_NO_RESPONSE หรือรหัสที่ไม่รู้จัก -> ล้มเหลว', () => {
    expect(
      classifyCentralCommand(
        cmd({ status: 'EXPIRED', error_code: 'DEVICE_NO_RESPONSE' }),
      ).kind,
    ).toBe('failed');
    expect(
      classifyCentralCommand(cmd({ status: 'EXPIRED', error_code: 'NEW_CODE' }))
        .kind,
    ).toBe('failed');
    expect(classifyCentralCommand(cmd({ status: 'EXPIRED' })).kind).toBe(
      'failed',
    );
  });

  // docs/27 §7.2 — ข้อความอ่านง่ายตาม error_code ที่รู้จัก
  it.each([
    ['DEVICE_DISCONNECTED', 'กล่องหลุดการเชื่อมต่อเกิน 1 นาที — ส่งไม่ผ่าน'],
    ['DEVICE_NO_RESPONSE', 'กล่องไม่ตอบกลับภายในเวลาที่กำหนด'],
    [
      'ROLLED_BACK',
      'Firmware ใหม่ไม่ผ่านการตรวจหลังรีบูต กล่องย้อนกลับเวอร์ชันเดิม',
    ],
    [
      'NEW_FIRMWARE_FAILED_HEALTH_CHECK',
      'Firmware ใหม่ไม่ผ่านการตรวจหลังรีบูต กล่องย้อนกลับเวอร์ชันเดิม',
    ],
    ['DOWNLOAD_TIMEOUT', 'ดาวน์โหลด Firmware ค้าง (เน็ตช้าหรือหลุด)'],
  ])('error_code %s -> ข้อความอ่านง่าย %s', (error_code, message) => {
    const r = classifyCentralCommand(cmd({ status: 'FAILED', error_code }));
    expect(r.kind).toBe('failed');
    expect((r as { detail: string }).detail).toBe(message);
  });

  it('error_code ที่ไม่รู้จัก -> fallback เป็นข้อความดิบจาก Server กลาง', () => {
    const r = classifyCentralCommand(
      cmd({
        status: 'FAILED',
        error_code: 'SOME_NEW_CODE',
        error_message: 'something',
      }),
    );
    expect(r.kind).toBe('failed');
    expect((r as { detail: string }).detail).toBe(
      'Server กลางรายงาน FAILED SOME_NEW_CODE something',
    );
  });

  it('DEVICE_OFFLINE -> ข้อความไม่เจาะจง Config (ใช้กับ Firmware ได้ด้วย)', () => {
    const r = classifyCentralCommand(
      cmd({ status: 'FAILED', error_code: 'DEVICE_OFFLINE' }),
    );
    expect((r as { detail: string }).detail).toContain(
      'กล่องออฟไลน์ คำสั่งไปไม่ถึง',
    );
  });
});
