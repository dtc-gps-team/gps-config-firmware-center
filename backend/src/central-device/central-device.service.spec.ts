import { ConfigService as NestConfigService } from '@nestjs/config';
import {
  type CentralDeviceClient,
  CentralRejectedError,
  CentralUnavailableError,
} from './central-device.client';
import { CentralDeviceService } from './central-device.service';

const unusedClientMethods = {
  getSchema: () => Promise.reject(new Error('ไม่ได้ใช้ในเทสนี้')),
  putDeviceConfig: () => Promise.reject(new Error('ไม่ได้ใช้ในเทสนี้')),
  getCommand: () => Promise.reject(new Error('ไม่ได้ใช้ในเทสนี้')),
};

function makeService(client: CentralDeviceClient, mode = 'mock') {
  const config = {
    get: (_k: string, d?: string) => mode ?? d,
  } as unknown as NestConfigService;
  return new CentralDeviceService(client, config);
}

describe('CentralDeviceService', () => {
  it('ผสมข้อมูล gateway กับทะเบียน delivery และเรียงตาม deviceId', async () => {
    const client: CentralDeviceClient = {
      ...unusedClientMethods,
      listGatewayDevices: () =>
        Promise.resolve([
          {
            device_id: 'B',
            online: true,
            hardware_model: 'M',
            firmware_version_reported: '1.0.0',
            config_version_reported: 2,
            last_command: {
              command_id: 'C1',
              action: 'UPDATE_CONFIG',
              target: 2,
              status: 'SUCCESS',
            },
          },
          { device_id: 'A', online: false },
        ]),
      listRegistryDevices: () =>
        Promise.resolve([
          { device_id: 'B', config_version_desired: 2 },
          { device_id: 'C', hardware_model: 'M', config_version_desired: null },
        ]),
    };
    const res = await makeService(client).listDevices();
    expect(res.reachable).toBe(true);
    expect(res.devices.map((d) => d.deviceId)).toEqual(['A', 'B', 'C']);
    const [a, b, c] = res.devices;
    expect(a.registered).toBe(false); // ต่อ gateway แล้วแต่ไม่อยู่ในทะเบียน delivery
    expect(b).toMatchObject({
      online: true,
      registered: true,
      desiredConfigVersion: 2,
      reportedConfigVersion: 2,
    });
    expect(b.lastCommand).toMatchObject({
      commandId: 'C1',
      target: '2',
      status: 'SUCCESS',
      errorCode: null,
    });
    expect(c).toMatchObject({
      online: false,
      registered: true,
      lastSeenAt: null,
    });
  });

  it('ติดต่อ Server กลางไม่ได้: ไม่โยน error ได้ reachable=false และรายการว่าง', async () => {
    const client: CentralDeviceClient = {
      ...unusedClientMethods,
      listGatewayDevices: () =>
        Promise.reject(
          new CentralUnavailableError('เชื่อมต่อ Server กลางไม่ได้'),
        ),
      listRegistryDevices: () => Promise.resolve([]),
    };
    const res = await makeService(client).listDevices();
    expect(res).toMatchObject({
      reachable: false,
      error: 'เชื่อมต่อ Server กลางไม่ได้',
      devices: [],
    });
  });

  it('error แปลกๆ ก็ไม่รั่วข้อความภายในออกไป', async () => {
    const client: CentralDeviceClient = {
      ...unusedClientMethods,
      listGatewayDevices: () =>
        Promise.reject(new Error('secret-internal-detail')),
      listRegistryDevices: () => Promise.resolve([]),
    };
    const res = await makeService(client).listDevices();
    expect(res.reachable).toBe(false);
    expect(res.error).not.toContain('secret');
  });

  it('cache สั้นๆ: เรียกซ้ำภายในไม่กี่วินาทียิง Server กลางครั้งเดียว', async () => {
    const listGatewayDevices = jest.fn(() => Promise.resolve([]));
    const client: CentralDeviceClient = {
      ...unusedClientMethods,
      listGatewayDevices,
      listRegistryDevices: () => Promise.resolve([]),
    };
    const svc = makeService(client);
    await svc.listDevices();
    await svc.getStatus();
    expect(listGatewayDevices).toHaveBeenCalledTimes(1);
  });

  it('findDevice: ไม่รู้จักเครื่อง -> device=null แต่ยังบอกสถานะการเชื่อมต่อ', async () => {
    const client: CentralDeviceClient = {
      ...unusedClientMethods,
      listGatewayDevices: () => Promise.resolve([]),
      listRegistryDevices: () => Promise.resolve([]),
    };
    const { list, device } = await makeService(client).findDevice('NOPE');
    expect(device).toBeNull();
    expect(list.reachable).toBe(true);
  });
});

describe('registered (กล่องที่ถูก revoke)', () => {
  const clientWith = (
    registry: { device_id: string; status?: string }[],
  ): CentralDeviceClient => ({
    ...unusedClientMethods,
    listGatewayDevices: () =>
      Promise.resolve([{ device_id: 'A', online: true }]),
    listRegistryDevices: () => Promise.resolve(registry),
  });

  it('อยู่ในทะเบียนและ active -> registered', async () => {
    const res = await makeService(
      clientWith([{ device_id: 'A', status: 'active' }]),
    ).listDevices();
    expect(res.devices[0].registered).toBe(true);
  });

  it('อยู่ในทะเบียนแต่ถูก revoke -> ไม่นับว่าลงทะเบียน (สั่ง Config ไม่ได้)', async () => {
    const res = await makeService(
      clientWith([{ device_id: 'A', status: 'revoked' }]),
    ).listDevices();
    expect(res.devices[0].registered).toBe(false);
  });

  it('กล่องที่อยู่แต่ในทะเบียน (ยังไม่เคยต่อ gateway) และถูก revoke -> ไม่นับว่าลงทะเบียน', async () => {
    const client: CentralDeviceClient = {
      ...unusedClientMethods,
      listGatewayDevices: () => Promise.resolve([]),
      listRegistryDevices: () =>
        Promise.resolve([{ device_id: 'Z', status: 'revoked' }]),
    };
    const res = await makeService(client).listDevices();
    expect(res.devices[0]).toMatchObject({ deviceId: 'Z', registered: false });
  });
});

describe('single-flight การโหลดรายการ', () => {
  it('คำขอที่มาพร้อมกันตอน cache ว่าง ยิง Server กลางรอบเดียวและได้ผลเดียวกัน', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const listGatewayDevices = jest.fn(async () => {
      await gate;
      return [];
    });
    const client: CentralDeviceClient = {
      ...unusedClientMethods,
      listGatewayDevices,
      listRegistryDevices: () => Promise.resolve([]),
    };
    const svc = makeService(client);

    const all = Promise.all([
      svc.listDevices(),
      svc.listDevices(),
      svc.getStatus(),
    ]);
    release();
    const [a, b] = await all;

    expect(listGatewayDevices).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it('รอบที่ล้มเหลวไม่ค้าง: เรียกใหม่หลังจากนั้นลองโหลดอีกครั้ง', async () => {
    const listGatewayDevices = jest
      .fn()
      .mockRejectedValueOnce(new CentralUnavailableError('x'))
      .mockResolvedValue([]);
    const client: CentralDeviceClient = {
      ...unusedClientMethods,
      listGatewayDevices,
      listRegistryDevices: () => Promise.resolve([]),
    };
    const svc = makeService(client);

    expect((await svc.listDevices()).reachable).toBe(false);
    // ผลล้มเหลวถูก cache สั้นๆ ตามปกติ ข้ามช่วง cache ด้วยการเรียกผ่านเวลา
    jest.useFakeTimers().setSystemTime(Date.now() + 10_000);
    expect((await svc.listDevices()).reachable).toBe(true);
    jest.useRealTimers();
    expect(listGatewayDevices).toHaveBeenCalledTimes(2);
  });
});

describe('pushConfig', () => {
  const gateway = {
    device_id: 'BOX-1',
    online: true,
    hardware_model: 'ESP32-DEVKIT-V1',
    firmware_version_reported: '1.0.0',
    config_version_reported: 1,
    schema_version_reported: 1,
  };
  const schema = {
    hardware_model: 'ESP32-DEVKIT-V1',
    schema_version: 1,
    parameters: [{ key: 'gps.send_interval_sec', type: 'integer' }],
  };

  function clientWith(over: Partial<CentralDeviceClient> = {}) {
    const client: CentralDeviceClient = {
      listGatewayDevices: () => Promise.resolve([gateway]),
      listRegistryDevices: () => Promise.resolve([{ device_id: 'BOX-1' }]),
      getSchema: jest.fn().mockResolvedValue(schema),
      putDeviceConfig: jest.fn().mockResolvedValue({
        config_version: 9,
        command: {
          command_id: 'CMD-9',
          device_id: 'BOX-1',
          action: 'UPDATE_CONFIG',
          status: 'DELIVERED',
        },
      }),
      getCommand: jest.fn(),
      ...over,
    };
    return client;
  }

  it('สำเร็จ: แปลงค่าตาม schema ที่กล่องรายงาน แล้วสั่ง PUT และคืนรหัสคำสั่ง', async () => {
    const client = clientWith();
    const out = await makeService(client).pushConfig('BOX-1', {
      'gps.send_interval_sec': '20',
    });
    expect(out).toEqual({ kind: 'sent', commandId: 'CMD-9', configVersion: 9 });
    expect(client.getSchema).toHaveBeenCalledWith('ESP32-DEVKIT-V1', 1);
    expect(client.putDeviceConfig).toHaveBeenCalledWith('BOX-1', {
      gps: { send_interval_sec: 20 },
    });
  });

  it('ติดต่อ Server กลางไม่ได้ -> unavailable ไม่ยิง PUT', async () => {
    const client = clientWith({
      listGatewayDevices: () =>
        Promise.reject(
          new CentralUnavailableError('เชื่อมต่อ Server กลางไม่ได้'),
        ),
    });
    const out = await makeService(client).pushConfig('BOX-1', {
      'gps.send_interval_sec': 20,
    });
    expect(out).toEqual({
      kind: 'unavailable',
      reason: 'เชื่อมต่อ Server กลางไม่ได้',
    });
    expect(client.putDeviceConfig).not.toHaveBeenCalled();
  });

  it('Server กลางไม่รู้จักกล่อง -> rejected', async () => {
    const out = await makeService(clientWith()).pushConfig('NOPE', {
      'gps.send_interval_sec': 20,
    });
    expect(out.kind).toBe('rejected');
    expect((out as { reason: string }).reason).toContain('ไม่รู้จัก');
  });

  it('กล่องไม่อยู่ในทะเบียน delivery -> rejected บอกว่าสั่ง Config ไม่ได้', async () => {
    const client = clientWith({
      listRegistryDevices: () => Promise.resolve([]),
    });
    const out = await makeService(client).pushConfig('BOX-1', {
      'gps.send_interval_sec': 20,
    });
    expect(out.kind).toBe('rejected');
    expect((out as { reason: string }).reason).toContain('ทะเบียน');
    expect(client.putDeviceConfig).not.toHaveBeenCalled();
  });

  it('กล่องยังไม่รายงาน schema -> rejected', async () => {
    const client = clientWith({
      listGatewayDevices: () =>
        Promise.resolve([{ ...gateway, schema_version_reported: null }]),
    });
    const out = await makeService(client).pushConfig('BOX-1', {
      'gps.send_interval_sec': 20,
    });
    expect(out.kind).toBe('rejected');
    expect(client.putDeviceConfig).not.toHaveBeenCalled();
  });

  it('คีย์ที่ไม่อยู่ใน schema -> rejected ไม่ยิง PUT', async () => {
    const client = clientWith();
    const out = await makeService(client).pushConfig('BOX-1', { APN: 'x' });
    expect(out.kind).toBe('rejected');
    expect((out as { reason: string }).reason).toContain('APN');
    expect(client.putDeviceConfig).not.toHaveBeenCalled();
  });

  it('Server กลางปฏิเสธ (400 ไม่ผ่าน schema) -> rejected พร้อมเหตุผลของเขา', async () => {
    const client = clientWith({
      putDeviceConfig: jest
        .fn()
        .mockRejectedValue(
          new CentralRejectedError(
            400,
            'INVALID_CONFIG: gps.send_interval_sec ต่ำกว่า 5 (HTTP 400)',
          ),
        ),
    });
    const out = await makeService(client).pushConfig('BOX-1', {
      'gps.send_interval_sec': 1,
    });
    expect(out).toEqual({
      kind: 'rejected',
      reason: 'INVALID_CONFIG: gps.send_interval_sec ต่ำกว่า 5 (HTTP 400)',
    });
  });

  it('PUT ล้มเหลวเพราะเครือข่ายกลางทาง -> unavailable', async () => {
    const client = clientWith({
      putDeviceConfig: jest
        .fn()
        .mockRejectedValue(new CentralUnavailableError('หมดเวลา')),
    });
    const out = await makeService(client).pushConfig('BOX-1', {
      'gps.send_interval_sec': 20,
    });
    expect(out).toEqual({ kind: 'unavailable', reason: 'หมดเวลา' });
  });

  it('PUT สำเร็จแต่ไม่มีคำสั่งกลับมา -> rejected', async () => {
    const client = clientWith({
      putDeviceConfig: jest
        .fn()
        .mockResolvedValue({ config_version: 9, command: null }),
    });
    const out = await makeService(client).pushConfig('BOX-1', {
      'gps.send_interval_sec': 20,
    });
    expect(out.kind).toBe('rejected');
  });
});

describe('getCommandOutcome', () => {
  const base = {
    listGatewayDevices: () => Promise.resolve([]),
    listRegistryDevices: () => Promise.resolve([]),
    getSchema: jest.fn(),
    putDeviceConfig: jest.fn(),
  };

  it('แปลงสถานะคำสั่งของ Server กลาง', async () => {
    const client: CentralDeviceClient = {
      ...base,
      getCommand: jest.fn().mockResolvedValue({
        command_id: 'C',
        device_id: 'D',
        action: 'UPDATE_CONFIG',
        status: 'SUCCESS',
      }),
    };
    expect(await makeService(client).getCommandOutcome('C')).toEqual({
      kind: 'success',
    });
  });

  it('ถามไม่ได้เพราะติดต่อ Server กลางไม่ได้ -> unavailable (ไม่ตัดสิน)', async () => {
    const client: CentralDeviceClient = {
      ...base,
      getCommand: jest.fn().mockRejectedValue(new CentralUnavailableError('x')),
    };
    expect(await makeService(client).getCommandOutcome('C')).toEqual({
      kind: 'unavailable',
    });
  });

  it('Server กลางไม่พบคำสั่ง (404) -> failed บอกรหัสคำสั่ง', async () => {
    const client: CentralDeviceClient = {
      ...base,
      getCommand: jest
        .fn()
        .mockRejectedValue(
          new CentralRejectedError(404, 'JOB_NOT_FOUND (HTTP 404)'),
        ),
    };
    const out = await makeService(client).getCommandOutcome('CMD-7');
    expect(out.kind).toBe('failed');
    expect((out as { detail: string }).detail).toContain('CMD-7');
  });
});
