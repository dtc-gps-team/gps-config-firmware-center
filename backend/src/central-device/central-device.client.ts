import { Injectable, Logger } from '@nestjs/common';
import type {
  PushFirmwareOptions,
  RawCentralCommand,
  RawCentralSchema,
  RawGatewayDevice,
  RawPushFirmwareResult,
  RawDeviceConfig,
  RawPutConfigResult,
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

/**
 * Server กลางปฏิเสธคำขอเพราะข้อมูลที่เราส่งไปไม่ผ่าน (HTTP 4xx เช่น config ไม่ผ่าน schema,
 * ไม่รู้จักกล่อง, schema ไม่ตรงกับที่กล่องรัน) ต่างจาก `CentralUnavailableError` ที่หมายถึง
 * ติดต่อไม่ได้ · ลองซ้ำด้วยข้อมูลเดิมไม่ช่วย
 */
export class CentralRejectedError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'CentralRejectedError';
  }
}

export interface CentralDeviceClient {
  // property function type — เหตุผลเดียวกับ DeviceConnectionTester (กัน unbound-method ในเทส)
  listGatewayDevices: () => Promise<RawGatewayDevice[]>;
  listRegistryDevices: () => Promise<RawRegistryDevice[]>;
  /** schema ของโมเดลและเวอร์ชันนั้น (ใช้แปลง Config ของเราเป็นรูปที่ Server กลางรับ) */
  getSchema: (model: string, version: number) => Promise<RawCentralSchema>;
  /** ตั้ง Config ใหม่ให้กล่องและสั่งส่งทันที (Server กลางสร้างเวอร์ชันใหม่ทุกครั้งที่เรียก) */
  putDeviceConfig: (
    deviceId: string,
    settings: Record<string, unknown>,
  ) => Promise<RawPutConfigResult>;
  /** สถานะปัจจุบันของคำสั่งหนึ่งรายการ */
  getCommand: (commandId: string) => Promise<RawCentralCommand>;
  /** Config ของกล่อง: ค่าที่ตั้งเป้าไว้และค่าที่กล่องรายงานว่าใช้อยู่ (อ่านอย่างเดียว) */
  getDeviceConfig: (deviceId: string) => Promise<RawDeviceConfig>;
  /** อัปโหลดไฟล์ firmware (.bin) ให้กล่องเครื่องเดียว — Server กลางเก็บไฟล์และสั่งอัปเดตทันที
   * ถ้ากล่องออนไลน์ (ไม่รอผลลัพธ์จริง — ใช้ `getCommand` ตามผลต่อ) */
  pushFirmware: (
    deviceId: string,
    data: Buffer,
    options: PushFirmwareOptions,
  ) => Promise<RawPushFirmwareResult>;
  /** ประวัติคำสั่งทั้งหมดของกล่องเครื่องเดียว เรียงล่าสุดก่อน (`GET
   * /api/gw/devices/{id}/commands` ของ ws-gateway) — ใช้เป็น fallback หา
   * Firmware เดิมตอน Rollback ไม่มีบันทึกในระบบเราเลย (#362 ส่วนขยาย,
   * พี่เลี้ยงแนะนำ) */
  listDeviceCommands: (deviceId: string) => Promise<RawCentralCommand[]>;
}

/**
 * ข้อมูลตัวอย่างสำหรับ dev/CI โดยไม่ต้องมี Server กลาง — ค่าเริ่มต้นของ `CENTRAL_MODE`
 * `DEV-0001` / `DEV-0002` ตรงกับเครื่องใน seed ของเรา (หน้า Device Search จึงเห็นออนไลน์/ออฟไลน์
 * ในโหมด mock) ส่วน `ESP32-DEMO-01` เป็นกล่องที่ Server กลางรู้จักแต่ยังไม่ได้ลงทะเบียนในระบบเรา
 * ไว้ลองเลือกจาก Server กลางตอนลงทะเบียนอุปกรณ์
 */
@Injectable()
export class MockCentralDeviceClient implements CentralDeviceClient {
  listGatewayDevices = (): Promise<RawGatewayDevice[]> => {
    const now = new Date().toISOString();
    return Promise.resolve([
      {
        device_id: 'DEV-0001',
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
        device_id: 'ESP32-DEMO-01',
        hardware_model: 'ESP32-DEVKIT-V1',
        online: true,
        last_seen_at: now,
        firmware_version_reported: '1.0.0',
        config_version_reported: 0,
        schema_version_reported: 1,
        last_command: null,
      },
      {
        device_id: 'DEV-0002',
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

  // โหมด mock: ทุกคำสั่งสำเร็จทันที (ไม่มีกล่องจริงให้รอ) เก็บคำสั่งไว้ให้ getCommand ตอบ
  private readonly commands = new Map<string, RawCentralCommand>();
  private commandSeq = 20000;
  private configSeq = new Map<string, number>();

  getSchema = (model: string, version: number): Promise<RawCentralSchema> =>
    Promise.resolve({
      hardware_model: model,
      schema_version: version,
      parameters: [
        { key: 'led.enabled', type: 'boolean' },
        { key: 'gps.enabled', type: 'boolean' },
        { key: 'gps.baud_rate', type: 'enum', options: [4800, 9600, 38400] },
        { key: 'gps.send_interval_sec', type: 'integer', min: 5, max: 3600 },
        {
          key: 'data_server.protocol',
          type: 'enum',
          options: ['https', 'http'],
        },
        { key: 'data_server.host', type: 'hostname' },
        { key: 'data_server.port', type: 'integer', min: 1, max: 65535 },
        { key: 'data_server.path', type: 'string' },
      ],
    });

  // mock ไม่ใช้ค่า settings (ทุกคำสั่งสำเร็จทันที) จึงรับแค่ deviceId
  getDeviceConfig = (deviceId: string): Promise<RawDeviceConfig> =>
    Promise.resolve({
      device_id: deviceId,
      reported: {
        config_version: 1,
        settings: {
          led: { enabled: true },
          gps: { enabled: true, baud_rate: 9600, send_interval_sec: 10 },
        },
        reported_at: new Date().toISOString(),
      },
    });

  putDeviceConfig = (deviceId: string): Promise<RawPutConfigResult> => {
    const version = (this.configSeq.get(deviceId) ?? 0) + 1;
    this.configSeq.set(deviceId, version);
    this.commandSeq += 1;
    const command: RawCentralCommand = {
      command_id: `CMD-${this.commandSeq}`,
      device_id: deviceId,
      action: 'UPDATE_CONFIG',
      status: 'SUCCESS',
      target_config_version: version,
      error_code: null,
    };
    this.commands.set(command.command_id, command);
    return Promise.resolve({ config_version: version, command });
  };

  getCommand = (commandId: string): Promise<RawCentralCommand> => {
    const command = this.commands.get(commandId);
    if (!command) {
      return Promise.reject(new CentralRejectedError(404, 'ไม่พบคำสั่งนี้'));
    }
    return Promise.resolve(command);
  };

  listRegistryDevices = (): Promise<RawRegistryDevice[]> =>
    Promise.resolve([
      {
        device_id: 'DEV-0001',
        hardware_model: 'ESP32-DEVKIT-V1',
        schema_version: 1,
        status: 'active',
        config_version_desired: 1,
      },
      {
        device_id: 'ESP32-DEMO-01',
        hardware_model: 'ESP32-DEVKIT-V1',
        schema_version: 1,
        status: 'active',
        config_version_desired: null,
      },
      {
        device_id: 'DEV-0002',
        hardware_model: 'ESP32-DEVKIT-V1',
        schema_version: 1,
        status: 'active',
        config_version_desired: 2,
      },
    ]);

  // โหมด mock: อัปโหลดสำเร็จทันทีเสมอ (ไม่มีกล่องจริงให้ตรวจเวอร์ชัน/ฮาร์ดแวร์)
  pushFirmware = (
    deviceId: string,
    _data: Buffer,
    options: PushFirmwareOptions,
  ): Promise<RawPushFirmwareResult> => {
    this.commandSeq += 1;
    const command: RawCentralCommand = {
      command_id: `CMD-${this.commandSeq}`,
      device_id: deviceId,
      action: 'UPDATE_FIRMWARE',
      status: 'SUCCESS',
      target_firmware_version: options.firmwareVersion,
      error_code: null,
    };
    this.commands.set(command.command_id, command);
    return Promise.resolve({
      ok: true,
      device_id: deviceId,
      command,
      message: `ส่งคำสั่งอัปเดตให้กล่องแล้ว (mock) — v${options.firmwareVersion}`,
    });
  };

  // mock ไม่มีประวัติจริงให้ fallback (ไม่เคยเกิดในทางปฏิบัติเพราะ mock ไม่มี
  // กล่องจริงให้ประวัติหายได้) — คืนค่าว่างเสมอ ปล่อยให้ fallback ไม่พบอะไร
  listDeviceCommands = (deviceId: string): Promise<RawCentralCommand[]> =>
    Promise.resolve(
      [...this.commands.values()]
        .filter((c) => c.device_id === deviceId)
        .reverse(),
    );
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
  private loginInFlight: Promise<string> | null = null;

  constructor(private readonly options: HttpCentralClientOptions) {}

  listGatewayDevices = (): Promise<RawGatewayDevice[]> =>
    this.getJson<RawGatewayDevice[]>('/api/gw/devices');

  listRegistryDevices = (): Promise<RawRegistryDevice[]> =>
    this.getJson<RawRegistryDevice[]>('/api/admin/devices');

  getSchema = (model: string, version: number): Promise<RawCentralSchema> =>
    this.getJson<RawCentralSchema>(
      `/api/admin/schemas/${encodeURIComponent(model)}/${version}`,
    );

  putDeviceConfig = (
    deviceId: string,
    settings: Record<string, unknown>,
  ): Promise<RawPutConfigResult> =>
    this.sendJson<RawPutConfigResult>(
      `/api/admin/devices/${encodeURIComponent(deviceId)}/config`,
      { method: 'PUT', body: JSON.stringify({ settings }) },
    );

  getDeviceConfig = (deviceId: string): Promise<RawDeviceConfig> =>
    this.getJson<RawDeviceConfig>(
      `/api/admin/devices/${encodeURIComponent(deviceId)}/config`,
    );

  getCommand = (commandId: string): Promise<RawCentralCommand> =>
    this.getJson<RawCentralCommand>(
      `/api/gw/jobs/${encodeURIComponent(commandId)}`,
    );

  pushFirmware = (
    deviceId: string,
    data: Buffer,
    options: PushFirmwareOptions,
  ): Promise<RawPushFirmwareResult> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
      'X-Firmware-Version': options.firmwareVersion,
    };
    if (options.schemaVersion !== undefined) {
      headers['X-Schema-Version'] = String(options.schemaVersion);
    }
    if (options.signature) headers['X-Firmware-Signature'] = options.signature;
    if (options.allowDowngrade) headers['X-Allow-Downgrade'] = 'true';
    return this.sendBinary<RawPushFirmwareResult>(
      `/api/admin/devices/${encodeURIComponent(deviceId)}/firmware`,
      data,
      headers,
    );
  };

  listDeviceCommands = (deviceId: string): Promise<RawCentralCommand[]> =>
    this.getJson<RawCentralCommand[]>(
      `/api/gw/devices/${encodeURIComponent(deviceId)}/commands`,
    );

  private getJson<T>(path: string): Promise<T> {
    return this.sendJson<T>(path, {});
  }

  /**
   * ส่งคำขอพร้อม token (single-flight login ใหม่ 1 ครั้งเมื่อ 401 — คำขอขนานที่เจอ 401 พร้อมกัน
   * รอ login รอบเดียวกัน) · 4xx อื่นๆ = Server กลางปฏิเสธข้อมูล (`CentralRejectedError` พร้อม
   * เหตุผลจากเขา) · 5xx/เครือข่าย = `CentralUnavailableError`
   */
  private async sendJson<T>(
    path: string,
    init: { method?: string; body?: string },
  ): Promise<T> {
    let token = await this.getToken();
    let res = await this.request(path, token, init);
    if (res.status === 401) {
      // token หมดอายุ/ถูกเปลี่ยน: login ใหม่ 1 ครั้ง (ถ้าคำขอขนานอื่นเพิ่ง login ใหม่ไปแล้ว ใช้ token นั้น)
      token = await this.getToken(token);
      res = await this.request(path, token, init);
    }
    if (res.status >= 400 && res.status < 500) {
      throw new CentralRejectedError(
        res.status,
        await this.rejectionMessage(res),
      );
    }
    if (!res.ok) {
      throw new CentralUnavailableError(
        `Server กลางตอบ HTTP ${res.status} ที่ ${path}`,
      );
    }
    return this.readJson<T>(res, path);
  }

  /**
   * เหมือน `sendJson` แต่ body เป็นไฟล์ดิบ + header กำหนดเอง (POST firmware ไม่ใช่ JSON) —
   * แยกจาก `sendJson`/`request` เพราะ body/Content-Type คนละแบบ แต่ retry/error ใช้กฎเดียวกัน
   */
  private async sendBinary<T>(
    path: string,
    data: Buffer,
    headers: Record<string, string>,
  ): Promise<T> {
    let token = await this.getToken();
    let res = await this.requestBinary(path, token, data, headers);
    if (res.status === 401) {
      token = await this.getToken(token);
      res = await this.requestBinary(path, token, data, headers);
    }
    if (res.status >= 400 && res.status < 500) {
      throw new CentralRejectedError(
        res.status,
        await this.rejectionMessage(res),
      );
    }
    if (!res.ok) {
      throw new CentralUnavailableError(
        `Server กลางตอบ HTTP ${res.status} ที่ ${path}`,
      );
    }
    return this.readJson<T>(res, path);
  }

  private async requestBinary(
    path: string,
    token: string | null,
    data: Buffer,
    extraHeaders: Record<string, string>,
  ): Promise<Response> {
    const headers = { ...extraHeaders };
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      return await fetch(new URL(path, this.options.baseUrl), {
        method: 'POST',
        // Buffer ไม่อยู่ใน BodyInit ของ lib.dom.d.ts เวอร์ชันนี้ แต่ undici (fetch ของ
        // Node) รับ Buffer ได้จริง — cast เฉพาะจุดนี้
        body: data as unknown as BodyInit,
        headers,
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (err) {
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

  /** ดึงเหตุผลจาก body ของ Server กลาง (`error` + `details`/`message`) ไม่มีก็บอกแค่ HTTP status */
  private async rejectionMessage(res: Response): Promise<string> {
    try {
      const body = (await res.json()) as {
        error?: unknown;
        message?: unknown;
        details?: unknown;
      };
      const parts: string[] = [];
      if (typeof body.error === 'string') parts.push(body.error);
      if (typeof body.message === 'string') parts.push(body.message);
      if (Array.isArray(body.details)) {
        // delivery-server ส่ง details เป็น `{ key, message }` ไม่ใช่ string
        // (ดู validateSettings ใน schemas.js) — String(d) ตรงๆ ได้ "[object
        // Object]" ไม่สื่อความหมาย ต้องดึง key/message ออกมาก่อน
        parts.push(
          body.details
            .map((d) => {
              if (d && typeof d === 'object') {
                const { key, message } = d as {
                  key?: unknown;
                  message?: unknown;
                };
                if (key !== undefined || message !== undefined) {
                  return `${String(key)}: ${String(message)}`;
                }
              }
              return String(d);
            })
            .join('; '),
        );
      }
      if (parts.length > 0) return `${parts.join(': ')} (HTTP ${res.status})`;
    } catch {
      // body อ่านไม่ได้ ใช้ข้อความกลางด้านล่าง
    }
    return `Server กลางปฏิเสธคำขอ (HTTP ${res.status})`;
  }

  /**
   * single-flight: คำขอที่มาพร้อมกันตอนยังไม่มี token (เช่น `Promise.all` ของสองรายการ) หรือ
   * เจอ 401 พร้อมกัน รอ login รอบเดียวกัน ไม่ login ซ้อน · `rejected` = token ที่เพิ่งถูกปฏิเสธ
   * ถ้า token ปัจจุบันเป็นตัวใหม่กว่านั้นแล้ว (มีคำขออื่น login ไปแล้ว) ใช้ตัวนั้นเลย
   */
  private async getToken(rejected?: string): Promise<string> {
    if (this.token && this.token !== rejected) return this.token;
    this.loginInFlight ??= this.login().finally(() => {
      this.loginInFlight = null;
    });
    return this.loginInFlight;
  }

  private async login(): Promise<string> {
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
    return body.token;
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
