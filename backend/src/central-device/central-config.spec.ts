import {
  buildCentralSettings,
  classifyCentralCommand,
  isRetryableCentralOutcome,
} from './central-config';
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

  // รหัสที่กล่องรายงานเอง (ws-gateway/src/errors.js + finishCommand ของ firmware)
  it.each([
    [
      'SCHEMA_NOT_SUPPORTED',
      'Firmware ในกล่องไม่รองรับ Config ชุดนี้ — อัปเดต Firmware ก่อน',
    ],
    ['SETTINGS_MISSING', 'Config ไม่มีค่าตั้งให้กล่อง'],
    ['HARDWARE_MISMATCH', 'Firmware นี้ไม่ใช่ของรุ่นบอร์ดในกล่อง'],
    ['VERSION_MISMATCH', 'Server ส่ง Firmware ไม่ตรงกับเวอร์ชันที่สั่ง'],
    ['UNSIGNED_FIRMWARE', 'Firmware ไม่มีลายเซ็น กล่องไม่ยอมติดตั้ง'],
    ['SIGNATURE_INVALID', 'ลายเซ็น Firmware ไม่ถูกต้อง กล่องไม่ยอมติดตั้ง'],
    [
      'NO_OTA_PARTITION',
      'กล่องไม่มีพื้นที่สำหรับอัปเดต Firmware ผ่านเน็ต — ต้องแฟลชผ่าน USB',
    ],
    ['SIZE_NOT_SUPPORTED', 'Firmware ใหญ่เกินพื้นที่ในกล่อง'],
    [
      'DOWNLOAD_URL_INVALID',
      'ลิงก์ดาวน์โหลด Firmware บน Server ไม่ถูกต้อง — แจ้งผู้ดูแล Server',
    ],
    ['UNSUPPORTED_ACTION', 'Firmware ในกล่องไม่รู้จักคำสั่งนี้'],
    ['SHA256_MISMATCH', 'ไฟล์ Firmware เสียระหว่างดาวน์โหลด กล่องไม่ติดตั้ง'],
    ['SIZE_MISMATCH', 'ขนาดไฟล์ Firmware ที่ดาวน์โหลดไม่ตรงกับที่ Server แจ้ง'],
    ['UPDATE_BEGIN_FAILED', 'กล่องเตรียมพื้นที่ติดตั้ง Firmware ไม่ได้'],
    ['FLASH_WRITE_FAILED', 'เขียน Firmware ลงกล่องไม่สำเร็จ'],
    ['UPDATE_END_FAILED', 'ติดตั้ง Firmware ไม่สำเร็จ'],
    ['CONFIG_INVALID_JSON', 'Config ที่กล่องได้รับเสียหาย'],
    ['MANIFEST_INVALID_JSON', 'ข้อมูล Firmware ที่กล่องได้รับเสียหาย'],
    ['CONFIG_VERSION_MISMATCH', 'Config บน Server เปลี่ยนระหว่างส่ง'],
  ])('กล่องรายงาน %s -> %s', (error_code, message) => {
    const r = classifyCentralCommand(cmd({ status: 'FAILED', error_code }));
    expect((r as { detail: string }).detail).toBe(message);
  });

  it.each([
    [
      'UNSUPPORTED_PARAMETER:gps.send_interval_sec',
      'Firmware ในกล่องไม่รองรับค่า "gps.send_interval_sec" — อัปเดต Firmware ก่อน หรือเอาค่านี้ออก',
    ],
    [
      'INVALID_VALUE:speed_limit.max_kmh',
      'ค่า "speed_limit.max_kmh" ไม่ถูกต้อง (ชนิดข้อมูลหรือช่วงค่าไม่ผ่าน)',
    ],
    ['INVALID_GROUP:geofence', 'กลุ่มค่าตั้ง "geofence" มีรูปแบบไม่ถูกต้อง'],
  ])('รหัสมีชื่อ field ต่อท้าย %s -> %s', (error_code, message) => {
    const r = classifyCentralCommand(cmd({ status: 'FAILED', error_code }));
    expect((r as { detail: string }).detail).toBe(message);
  });

  it.each([
    ['CONFIG_HTTP_500', 'ดึง Config จาก Server ไม่สำเร็จ (HTTP 500)'],
    ['MANIFEST_HTTP_404', 'ขอข้อมูล Firmware จาก Server ไม่สำเร็จ (HTTP 404)'],
    ['DOWNLOAD_HTTP_403', 'ดาวน์โหลด Firmware จาก Server ไม่สำเร็จ (HTTP 403)'],
    [
      'DOWNLOAD_HTTP_-1',
      'ดาวน์โหลด Firmware ไม่สำเร็จ — กล่องต่อ Server ไม่ได้',
    ],
  ])('HTTP ฝั่งกล่อง %s -> %s', (error_code, message) => {
    const r = classifyCentralCommand(cmd({ status: 'FAILED', error_code }));
    expect((r as { detail: string }).detail).toBe(message);
  });

  it('MANIFEST_HTTP_409 ที่ Server ห้ามลดเวอร์ชัน -> บอกเหตุผลจริง', () => {
    const r = classifyCentralCommand(
      cmd({
        status: 'FAILED',
        error_code: 'MANIFEST_HTTP_409',
        error_message:
          '{"error":"DOWNGRADE_NOT_ALLOWED","current":"1.2.1","target":"1.0.0"}',
      }),
    );
    expect((r as { detail: string }).detail).toBe(
      'Server ไม่อนุญาตให้ลดเวอร์ชัน Firmware',
    );
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

// docs/31 §3.1 — ผลแบบไหนลองส่งใหม่ (denylist ของ "ไม่ลอง")
describe('isRetryableCentralOutcome', () => {
  const cmd = (over: Partial<RawCentralCommand>): RawCentralCommand => ({
    command_id: 'CMD-1',
    device_id: 'D',
    action: 'UPDATE_CONFIG',
    status: 'FAILED',
    ...over,
  });

  it.each([
    ['FAILED', 'DEVICE_DISCONNECTED'],
    ['FAILED', 'DEVICE_NO_RESPONSE'],
    ['FAILED', 'DOWNLOAD_TIMEOUT'],
    ['ROLLED_BACK', 'ROLLED_BACK'],
    ['ROLLED_BACK', 'NEW_FIRMWARE_FAILED_HEALTH_CHECK'],
    ['FAILED', 'DEVICE_OFFLINE'],
    ['EXPIRED', 'TTL_EXPIRED'],
    ['FAILED', 'SOME_NEW_CODE_FROM_GATEWAY'],
    // R1.1: ส่งซ้ำแล้วอาจผ่าน (ข้อมูลเสียระหว่างทาง / Server เปลี่ยนระหว่างส่ง / เน็ต)
    ['FAILED', 'SHA256_MISMATCH'],
    ['FAILED', 'SIZE_MISMATCH'],
    ['FAILED', 'FLASH_WRITE_FAILED'],
    ['FAILED', 'UPDATE_BEGIN_FAILED'],
    ['FAILED', 'UPDATE_END_FAILED'],
    ['FAILED', 'CONFIG_INVALID_JSON'],
    ['FAILED', 'CONFIG_VERSION_MISMATCH'],
    ['FAILED', 'MANIFEST_INVALID_JSON'],
    ['FAILED', 'CONFIG_HTTP_500'],
    ['FAILED', 'DOWNLOAD_HTTP_-1'],
  ])('%s %s -> ลองใหม่', (status, error_code) => {
    const outcome = classifyCentralCommand(cmd({ status, error_code }));
    expect(outcome).toMatchObject({ errorCode: error_code });
    expect(isRetryableCentralOutcome(outcome)).toBe(true);
  });

  it('FAILED ไม่มีรหัส -> ลองใหม่ (ไม่รู้ = ให้โอกาส)', () => {
    const outcome = classifyCentralCommand(cmd({ error_code: null }));
    expect(isRetryableCentralOutcome(outcome)).toBe(true);
  });

  it.each(['SUPERSEDED', 'CANCELLED'])(
    'EXPIRED %s -> ไม่ลอง (มีคนสั่งทับหรือยกเลิก)',
    (error_code) => {
      const outcome = classifyCentralCommand(
        cmd({ status: 'EXPIRED', error_code }),
      );
      expect(isRetryableCentralOutcome(outcome)).toBe(false);
    },
  );

  // R1.1 (docs/31 §6.3 ข้อ 4): กล่องรายงานว่ารับของชุดนี้ไม่ได้เลย ส่งซ้ำก็ผิดซ้ำ
  it.each([
    'SCHEMA_NOT_SUPPORTED',
    'SETTINGS_MISSING',
    'HARDWARE_MISMATCH',
    'VERSION_MISMATCH',
    'UNSIGNED_FIRMWARE',
    'SIGNATURE_INVALID',
    'NO_OTA_PARTITION',
    'SIZE_NOT_SUPPORTED',
    'DOWNLOAD_URL_INVALID',
    'UNSUPPORTED_ACTION',
  ])('FAILED %s -> ไม่ลอง (ส่งซ้ำก็ผิดซ้ำ)', (error_code) => {
    const outcome = classifyCentralCommand(cmd({ error_code }));
    expect(outcome).toMatchObject({ kind: 'failed', errorCode: error_code });
    expect(isRetryableCentralOutcome(outcome)).toBe(false);
  });

  it.each([
    'UNSUPPORTED_PARAMETER:gps.send_interval_sec',
    'INVALID_VALUE:speed_limit.max_kmh',
    'INVALID_GROUP:geofence',
  ])('FAILED %s -> ไม่ลอง (รหัสมีชื่อ field ต่อท้าย)', (error_code) => {
    const outcome = classifyCentralCommand(cmd({ error_code }));
    expect(isRetryableCentralOutcome(outcome)).toBe(false);
  });

  it('ชื่อที่แค่ขึ้นต้นคล้ายกัน ไม่นับว่าอยู่ในรายการไม่ลอง', () => {
    for (const error_code of [
      'INVALID_VALUE',
      'SIGNATURE_INVALID_TEMPORARY',
      'HARDWARE_MISMATCHED',
    ]) {
      const outcome = classifyCentralCommand(cmd({ error_code }));
      expect(isRetryableCentralOutcome(outcome)).toBe(true);
    }
  });

  it('ยังรอ / สำเร็จ / ถามไม่ได้ -> ไม่ใช่ผลที่ต้องลองใหม่', () => {
    expect(isRetryableCentralOutcome({ kind: 'pending' })).toBe(false);
    expect(isRetryableCentralOutcome({ kind: 'success' })).toBe(false);
    expect(isRetryableCentralOutcome({ kind: 'unavailable' })).toBe(false);
  });
});
