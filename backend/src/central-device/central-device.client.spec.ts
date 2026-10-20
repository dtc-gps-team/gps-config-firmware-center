import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
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
