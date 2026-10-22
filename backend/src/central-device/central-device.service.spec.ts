import { ConfigService as NestConfigService } from '@nestjs/config';
import {
  type CentralDeviceClient,
  CentralUnavailableError,
} from './central-device.client';
import { CentralDeviceService } from './central-device.service';

function makeService(client: CentralDeviceClient, mode = 'mock') {
  const config = {
    get: (_k: string, d?: string) => mode ?? d,
  } as unknown as NestConfigService;
  return new CentralDeviceService(client, config);
}

describe('CentralDeviceService', () => {
  it('ผสมข้อมูล gateway กับทะเบียน delivery และเรียงตาม deviceId', async () => {
    const client: CentralDeviceClient = {
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
