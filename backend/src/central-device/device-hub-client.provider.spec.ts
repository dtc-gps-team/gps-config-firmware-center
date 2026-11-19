import { HttpCentralDeviceClient } from './central-device.client';
import { createDeviceHubClient } from './device-hub-client.provider';

/** client ของ device-hub (docs/33) — env `DEVICE_HUB_MODE` ค่าเริ่มต้น mock ตาม Mock Mode Pattern */
describe('createDeviceHubClient', () => {
  const env =
    (values: Record<string, string>) =>
    (key: string): string | undefined =>
      values[key];
  const full = {
    DEVICE_HUB_MODE: 'real',
    DEVICE_HUB_BASE_URL: 'http://127.0.0.1:8090',
    DEVICE_HUB_ADMIN_USERNAME: 'hub',
    DEVICE_HUB_ADMIN_PASSWORD: 'secret-pw',
  };

  it('ไม่ตั้ง -> null (ปิด device-hub)', () => {
    expect(createDeviceHubClient(env({}))).toBeNull();
  });

  it('mock -> null', () => {
    expect(createDeviceHubClient(env({ DEVICE_HUB_MODE: 'mock' }))).toBeNull();
  });

  it('real ครบ -> HttpCentralDeviceClient (API รูปเดียวกับ Server กลาง)', () => {
    expect(createDeviceHubClient(env(full))).toBeInstanceOf(
      HttpCentralDeviceClient,
    );
  });

  it('real ขาด BASE_URL -> throw บอกชื่อ env และไม่มีรหัสผ่านในข้อความ', () => {
    const { DEVICE_HUB_BASE_URL: _omit, ...rest } = full;
    expect(() => createDeviceHubClient(env(rest))).toThrow(
      /DEVICE_HUB_BASE_URL/,
    );
    try {
      createDeviceHubClient(env(rest));
    } catch (err) {
      expect((err as Error).message).not.toContain('secret-pw');
    }
  });

  it('ค่าที่ไม่รู้จัก -> throw', () => {
    expect(() => createDeviceHubClient(env({ DEVICE_HUB_MODE: 'on' }))).toThrow(
      /DEVICE_HUB_MODE/,
    );
  });
});
