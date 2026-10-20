import { Injectable, Logger } from '@nestjs/common';
import type {
  RawGatewayDevice,
  RawRegistryDevice,
} from './central-device.types';

/** Injection token — ตัวจริงเลือกตาม env `CENTRAL_MODE` ใน central-device.module.ts */
export const CENTRAL_DEVICE_CLIENT = Symbol('CENTRAL_DEVICE_CLIENT');

/** ข้อผิดพลาดที่ client โยนเมื่อคุยกับ Server กลางไม่สำเร็จ (ข้อความไม่มี token/รหัสผ่าน) */
export class CentralUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CentralUnavailableError';
  }
}

export interface CentralDeviceClient {
  // property function type — เหตุผลเดียวกับ DeviceConnectionTester (กัน unbound-method ในเทส)
  listGatewayDevices: () => Promise<RawGatewayDevice[]>;
  listRegistryDevices: () => Promise<RawRegistryDevice[]>;
}

/** ข้อมูลตัวอย่างสำหรับ dev/CI โดยไม่ต้องมี Server กลาง — ค่าเริ่มต้นของ `CENTRAL_MODE` */
@Injectable()
export class MockCentralDeviceClient implements CentralDeviceClient {
  listGatewayDevices = (): Promise<RawGatewayDevice[]> => {
    const now = new Date().toISOString();
    return Promise.resolve([
      {
        device_id: 'ESP32-DEMO-01',
        hardware_model: 'ESP32-DEVKIT-V1',
        online: true,
        last_seen_at: now,
        firmware_version_reported: '1.0.0',
        config_version_reported: 1,
        schema_version_reported: 1,
        last_command: {
          command_id: 'CMD-10001',
          action: 'UPDATE_CONFIG',
          target: 1,
          status: 'SUCCESS',
          error_code: null,
          updated_at: now,
        },
      },
      {
        device_id: 'ESP32-DEMO-02',
        hardware_model: 'ESP32-DEVKIT-V1',
        online: true,
        last_seen_at: now,
        firmware_version_reported: '1.0.0',
        config_version_reported: 0,
        schema_version_reported: 1,
        last_command: null,
      },
      {
        device_id: 'ESP32-DEMO-03',
        hardware_model: 'ESP32-DEVKIT-V1',
        online: false,
        last_seen_at: new Date(Date.now() - 3_600_000).toISOString(),
        firmware_version_reported: '1.0.0',
        config_version_reported: 1,
        schema_version_reported: 1,
        last_command: {
          command_id: 'CMD-10002',
          action: 'UPDATE_CONFIG',
          target: 2,
          status: 'PENDING',
          error_code: null,
          updated_at: now,
        },
      },
    ]);
  };

  listRegistryDevices = (): Promise<RawRegistryDevice[]> =>
    Promise.resolve([
      {
        device_id: 'ESP32-DEMO-01',
        hardware_model: 'ESP32-DEVKIT-V1',
        schema_version: 1,
        status: 'active',
        config_version_desired: 1,
      },
      {
        device_id: 'ESP32-DEMO-02',
        hardware_model: 'ESP32-DEVKIT-V1',
        schema_version: 1,
        status: 'active',
        config_version_desired: null,
      },
      {
        device_id: 'ESP32-DEMO-03',
        hardware_model: 'ESP32-DEVKIT-V1',
        schema_version: 1,
        status: 'active',
        config_version_desired: 2,
      },
    ]);
}

export interface HttpCentralClientOptions {
  baseUrl: string;
  username: string;
  password: string;
  timeoutMs: number;
}

/**
 * ต่อ delivery-server ของ ESP32 Central Management ผ่าน REST
 * - `POST /api/login` ได้ token ร่วม (ไม่มี RBAC ฝั่งเขา — สิทธิ์จริงคุมที่ backend เรา)
 * - เก็บ token ไว้ในหน่วยความจำ เจอ 401 แล้ว login ใหม่ 1 ครั้ง
 * - ทุกคำขอมี timeout; ข้อผิดพลาดทุกแบบเป็น CentralUnavailableError ข้อความสั้น ไม่มีความลับ
 */
export class HttpCentralDeviceClient implements CentralDeviceClient {
  private readonly logger = new Logger(HttpCentralDeviceClient.name);
  private token: string | null = null;

  constructor(private readonly options: HttpCentralClientOptions) {}

  listGatewayDevices = (): Promise<RawGatewayDevice[]> =>
    this.getJson<RawGatewayDevice[]>('/api/gw/devices');

  listRegistryDevices = (): Promise<RawRegistryDevice[]> =>
    this.getJson<RawRegistryDevice[]>('/api/admin/devices');

  private async getJson<T>(path: string): Promise<T> {
    if (!this.token) await this.login();
    let res = await this.request(path, this.token);
    if (res.status === 401) {
      await this.login();
      res = await this.request(path, this.token);
    }
    if (!res.ok) {
      throw new CentralUnavailableError(
        `Server กลางตอบ HTTP ${res.status} ที่ ${path}`,
      );
    }
    return this.readJson<T>(res, path);
  }

  private async login(): Promise<void> {
    const res = await this.request('/api/login', null, {
      method: 'POST',
      body: JSON.stringify({
        username: this.options.username,
        password: this.options.password,
      }),
    });
    if (!res.ok) {
      this.token = null;
      throw new CentralUnavailableError(
        `เข้าสู่ระบบ Server กลางไม่สำเร็จ (HTTP ${res.status})`,
      );
    }
    const body = await this.readJson<{ token?: unknown }>(res, '/api/login');
    if (typeof body.token !== 'string' || !body.token) {
      throw new CentralUnavailableError('Server กลางไม่ส่ง token กลับมา');
    }
    this.token = body.token;
  }

  private async request(
    path: string,
    token: string | null,
    init: { method?: string; body?: string } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {};
    if (init.body) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      return await fetch(new URL(path, this.options.baseUrl), {
        ...init,
        headers,
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (err) {
      // ไม่ใช้ instanceof Error: DOMException ของ fetch อยู่คนละ realm ในเทส (jest)
      const timedOut =
        (err as { name?: string } | null)?.name === 'TimeoutError';
      this.logger.warn(
        `เรียก Server กลางไม่สำเร็จ ${path}: ${timedOut ? 'timeout' : 'เชื่อมต่อไม่ได้'}`,
      );
      throw new CentralUnavailableError(
        timedOut
          ? `Server กลางไม่ตอบภายใน ${this.options.timeoutMs} มิลลิวินาที`
          : 'เชื่อมต่อ Server กลางไม่ได้',
      );
    }
  }

  private async readJson<T>(res: Response, path: string): Promise<T> {
    try {
      return (await res.json()) as T;
    } catch {
      throw new CentralUnavailableError(
        `Server กลางตอบข้อมูลที่อ่านไม่ได้ที่ ${path}`,
      );
    }
  }
}
