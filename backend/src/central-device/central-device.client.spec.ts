import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  CentralRejectedError,
  CentralUnavailableError,
  HttpCentralDeviceClient,
  MockCentralDeviceClient,
} from './central-device.client';

type Handler = (req: IncomingMessage) => {
  status: number;
  body?: unknown;
  raw?: string;
  delayMs?: number;
};

describe('HttpCentralDeviceClient (กับ Server กลางปลอม)', () => {
  let server: Server;
  let baseUrl: string;
  let handler: Handler;
  let logins: number;

  beforeEach(async () => {
    logins = 0;
    handler = () => ({ status: 404 });
    server = createServer((req, res) => {
      if (req.url === '/api/login') logins += 1;
      const out = handler(req);
      const send = () => {
        res.statusCode = out.status;
        res.setHeader('Content-Type', 'application/json');
        res.end(out.raw ?? JSON.stringify(out.body ?? {}));
      };
      if (out.delayMs) setTimeout(send, out.delayMs);
      else send();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });

  const makeClient = (timeoutMs = 1000) =>
    new HttpCentralDeviceClient({
      baseUrl,
      username: 'u',
      password: 'p',
      timeoutMs,
    });

  it('login แล้วส่ง Bearer token และจำ token ไว้ใช้คำขอถัดไป', async () => {
    const seenAuth: (string | undefined)[] = [];
    handler = (req) => {
      if (req.url === '/api/login')
        return { status: 200, body: { token: 'tok-1' } };
      seenAuth.push(req.headers.authorization);
      return { status: 200, body: [{ device_id: 'D1' }] };
    };
    const client = makeClient();
    await client.listGatewayDevices();
    await client.listGatewayDevices();
    expect(logins).toBe(1);
    expect(seenAuth).toEqual(['Bearer tok-1', 'Bearer tok-1']);
  });

  it('เจอ 401 แล้ว login ใหม่หนึ่งครั้งและลองซ้ำ', async () => {
    let issued = 0;
    handler = (req) => {
      if (req.url === '/api/login') {
        issued += 1;
        return { status: 200, body: { token: `tok-${issued}` } };
      }
      return req.headers.authorization === 'Bearer tok-2'
        ? { status: 200, body: [{ device_id: 'D1' }] }
        : { status: 401 };
    };
    const client = makeClient();
    await expect(client.listRegistryDevices()).resolves.toEqual([
      { device_id: 'D1' },
    ]);
    expect(logins).toBe(2);
  });

  it('login ไม่ผ่าน -> CentralUnavailableError ไม่มีรหัสผ่านในข้อความ', async () => {
    handler = () => ({ status: 401 });
    const err = await makeClient()
      .listGatewayDevices()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CentralUnavailableError);
    expect((err as Error).message).not.toContain('p');
    expect((err as Error).message).toContain('401');
  });

  it('Server กลางตอบ 5xx -> CentralUnavailableError', async () => {
    handler = (req) =>
      req.url === '/api/login'
        ? { status: 200, body: { token: 't' } }
        : { status: 503 };
    await expect(makeClient().listGatewayDevices()).rejects.toThrow(/503/);
  });

  it('ตอบช้ากว่า timeout -> CentralUnavailableError', async () => {
    handler = () => ({ status: 200, body: { token: 't' }, delayMs: 400 });
    await expect(makeClient(100).listGatewayDevices()).rejects.toThrow(
      /ไม่ตอบภายใน/,
    );
  });

  it('ตอบ JSON เสีย -> CentralUnavailableError', async () => {
    handler = (req) =>
      req.url === '/api/login'
        ? { status: 200, body: { token: 't' } }
        : { status: 200, raw: '<html>oops' };
    await expect(makeClient().listGatewayDevices()).rejects.toThrow(
      /อ่านไม่ได้/,
    );
  });

  it('คำขอสองรายการพร้อมกันตอนยังไม่มี token: login รอบเดียว (single-flight)', async () => {
    handler = (req) =>
      req.url === '/api/login'
        ? { status: 200, body: { token: 'tok-1' }, delayMs: 100 }
        : { status: 200, body: [] };
    const client = makeClient();

    await Promise.all([
      client.listGatewayDevices(),
      client.listRegistryDevices(),
    ]);

    expect(logins).toBe(1);
  });

  it('เจอ 401 พร้อมกันสองคำขอ: login ใหม่รอบเดียวแล้วทั้งคู่สำเร็จ', async () => {
    let issued = 0;
    let revokeFirstToken = false;
    handler = (req) => {
      if (req.url === '/api/login') {
        issued += 1;
        return { status: 200, body: { token: `tok-${issued}` }, delayMs: 50 };
      }
      const valid = revokeFirstToken ? 'Bearer tok-2' : 'Bearer tok-1';
      return req.headers.authorization === valid
        ? { status: 200, body: [] }
        : { status: 401 };
    };
    const client = makeClient();
    await client.listGatewayDevices(); // login ครั้งแรกได้ tok-1
    expect(logins).toBe(1);

    revokeFirstToken = true; // tok-1 ถูกเพิกถอน ทั้งสองคำขอจะโดน 401 พร้อมกัน
    const results = await Promise.all([
      client.listGatewayDevices(),
      client.listRegistryDevices(),
    ]);

    expect(results).toEqual([[], []]);
    expect(logins).toBe(2); // เพิ่มแค่ 1 รอบ ไม่ใช่ 2
  });

  it('PUT config: ส่ง settings เป็น JSON และอ่านคำสั่งที่ได้กลับมา', async () => {
    let seenBody = '';
    let seenMethod = '';
    handler = (req) => {
      if (req.url === '/api/login')
        return { status: 200, body: { token: 't' } };
      seenMethod = req.method ?? '';
      return {
        status: 200,
        body: { config_version: 3, command: { command_id: 'CMD-3' } },
      };
    };
    server.on('request', (req) => {
      if (req.url?.includes('/config')) {
        req.on('data', (c: Buffer) => (seenBody += c.toString()));
      }
    });
    const out = await makeClient().putDeviceConfig('BOX-1', {
      gps: { send_interval_sec: 20 },
    });
    expect(out.config_version).toBe(3);
    expect(seenMethod).toBe('PUT');
    expect(JSON.parse(seenBody)).toEqual({
      settings: { gps: { send_interval_sec: 20 } },
    });
  });

  it('PUT config: Server กลางปฏิเสธ 400 -> CentralRejectedError พร้อมเหตุผลของเขา', async () => {
    handler = (req) =>
      req.url === '/api/login'
        ? { status: 200, body: { token: 't' } }
        : {
            status: 400,
            body: {
              error: 'INVALID_CONFIG',
              details: ['gps.send_interval_sec ต่ำกว่า 5'],
            },
          };
    const err = await makeClient()
      .putDeviceConfig('BOX-1', { gps: { send_interval_sec: 1 } })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CentralRejectedError);
    expect((err as CentralRejectedError).status).toBe(400);
    expect((err as Error).message).toContain('INVALID_CONFIG');
    expect((err as Error).message).toContain('ต่ำกว่า 5');
  });

  it('getCommand และ getSchema เรียกเส้นทางที่ถูกต้อง', async () => {
    const urls: string[] = [];
    handler = (req) => {
      if (req.url === '/api/login')
        return { status: 200, body: { token: 't' } };
      urls.push(req.url ?? '');
      return { status: 200, body: {} };
    };
    const client = makeClient();
    await client.getCommand('CMD-1');
    await client.getSchema('ESP32-DEVKIT-V1', 3);
    expect(urls).toEqual([
      '/api/gw/jobs/CMD-1',
      '/api/admin/schemas/ESP32-DEVKIT-V1/3',
    ]);
  });

  it('เชื่อมต่อไม่ได้เลย -> CentralUnavailableError', async () => {
    const client = new HttpCentralDeviceClient({
      baseUrl: 'http://127.0.0.1:1',
      username: 'u',
      password: 'p',
      timeoutMs: 500,
    });
    await expect(client.listGatewayDevices()).rejects.toBeInstanceOf(
      CentralUnavailableError,
    );
  });
});

describe('MockCentralDeviceClient', () => {
  it('คืนกล่องตัวอย่างที่ทั้งสองรายการ device_id ตรงกัน', async () => {
    const client = new MockCentralDeviceClient();
    const gw = await client.listGatewayDevices();
    const reg = await client.listRegistryDevices();
    expect(gw.map((d) => d.device_id).sort()).toEqual(
      reg.map((d) => d.device_id).sort(),
    );
    expect(gw.some((d) => d.online)).toBe(true);
    expect(gw.some((d) => !d.online)).toBe(true);
  });
});
