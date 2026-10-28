import { Inject, Injectable } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';
import {
  CENTRAL_DEVICE_CLIENT,
  type CentralDeviceClient,
  CentralRejectedError,
  CentralUnavailableError,
} from './central-device.client';
import {
  buildCentralSettings,
  classifyCentralCommand,
  type CentralCommandOutcome,
} from './central-config';
import type {
  CentralDevice,
  CentralDeviceList,
  CentralMode,
  CentralStatus,
  PushFirmwareOptions,
  RawGatewayDevice,
  RawRegistryDevice,
} from './central-device.types';

/** ผลการสั่งส่ง Config ให้กล่องหนึ่งเครื่อง */
export type PushConfigOutcome =
  /** Server กลางรับคำสั่งแล้ว ผลสำเร็จหรือไม่ต้องตามด้วย `getCommandOutcome` */
  | { kind: 'sent'; commandId: string; configVersion: number }
  /** ส่งไม่ได้เพราะข้อมูลหรือสถานะกล่องไม่เหมาะ (ไม่รู้จักกล่อง, ไม่ผ่าน schema ฯลฯ) ลองซ้ำไม่ช่วย */
  | { kind: 'rejected'; reason: string }
  /** ติดต่อ Server กลางไม่ได้ */
  | { kind: 'unavailable'; reason: string };

/** ค่าที่กล่องรายงานว่าใช้อยู่ (`readReportedFields`) เป็นชื่อพารามิเตอร์แบบจุด */
export interface ReportedBoxFields {
  fields: Record<string, unknown>;
  reportedAt: string | null;
}

/** ไม่ส่งค่าเหล่านี้ออกไป — `data_server.path` มี key ส่ง telemetry อยู่ใน URL (docs/23 §7) */
const HIDDEN_REPORTED_KEYS = new Set(['data_server.path']);

/** `{gps: {send_interval_sec: 10}}` -> `{'gps.send_interval_sec': 10}` */
function flattenSettings(
  settings: Record<string, unknown>,
  prefix = '',
  out: Record<string, unknown> = {},
): Record<string, unknown> {
  for (const [key, value] of Object.entries(settings)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      flattenSettings(value as Record<string, unknown>, name, out);
    } else {
      out[name] = value;
    }
  }
  return out;
}

/** ผลการสั่งอัปเดต Firmware ให้กล่องหนึ่งเครื่อง — รูปร่างเดียวกับ `PushConfigOutcome`
 * (ไม่มี version ตอน sent เพราะ Server กลางไม่คืน config_version สำหรับ firmware) */
export type PushFirmwareOutcome =
  | { kind: 'sent'; commandId: string }
  | { kind: 'rejected'; reason: string }
  | { kind: 'unavailable'; reason: string };

/** เก็บผลล่าสุดสั้นๆ กันหน้าเว็บที่ refresh ทุก 5 วินาทีหลายหน้าต่างยิง Server กลางถี่เกินจำเป็น */
const CACHE_TTL_MS = 3000;

/**
 * อ่านสถานะกล่องจาก Server กลาง (อ่านอย่างเดียว) — **ไม่โยน error ออกไปให้ฟีเจอร์อื่น**:
 * ติดต่อไม่ได้จะได้ `reachable=false` พร้อมเหตุผล หน้าอื่นของระบบเราต้องใช้งานได้ตามปกติ
 */
@Injectable()
export class CentralDeviceService {
  private cache: { at: number; value: CentralDeviceList } | null = null;
  private inFlight: Promise<CentralDeviceList> | null = null;

  constructor(
    @Inject(CENTRAL_DEVICE_CLIENT) private readonly client: CentralDeviceClient,
    private readonly nestConfig: NestConfigService,
  ) {}

  get mode(): CentralMode {
    return this.nestConfig.get<string>('CENTRAL_MODE', 'mock') === 'real'
      ? 'real'
      : 'mock';
  }

  async listDevices(): Promise<CentralDeviceList> {
    if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) {
      return this.cache.value;
    }
    // single-flight: คำขอที่มาพร้อมกันตอน cache หมดอายุรอผลของรอบที่กำลังโหลดอยู่ร่วมกัน
    // ไม่ยิง Server กลางซ้ำซ้อน (cache อย่างเดียวกันคำขอที่กำลังวิ่งพร้อมกันไม่ได้)
    this.inFlight ??= this.fetchDevices()
      .then((value) => {
        this.cache = { at: Date.now(), value };
        return value;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  async getStatus(): Promise<CentralStatus> {
    const list = await this.listDevices();
    return {
      mode: list.mode,
      reachable: list.reachable,
      error: list.error,
      checkedAt: list.fetchedAt,
    };
  }

  /** `null` = Server กลางไม่รู้จักกล่องนี้ (หรือติดต่อไม่ได้ — ดู `reachable` จาก listDevices) */
  async findDevice(
    deviceId: string,
  ): Promise<{ list: CentralDeviceList; device: CentralDevice | null }> {
    const list = await this.listDevices();
    return {
      list,
      device: list.devices.find((d) => d.deviceId === deviceId) ?? null,
    };
  }

  /**
   * ค่าที่กล่องรายงานว่าใช้อยู่จริง (ทุกพารามิเตอร์ ไม่ใช่แค่ที่อยู่ใน Config ของเรา) ให้หน้าขอแก้ค่า
   * แสดงค่าที่แก้ไม่ได้ด้วย · ซ่อน {@link HIDDEN_REPORTED_KEYS} · ติดต่อไม่ได้/กล่องยังไม่รายงาน = null
   * ไม่โยน error
   */
  async readReportedFields(
    deviceId: string,
  ): Promise<ReportedBoxFields | null> {
    try {
      const raw = await this.client.getDeviceConfig(deviceId);
      const settings = raw.reported?.settings;
      if (!settings) return null;
      const fields = flattenSettings(settings);
      for (const key of HIDDEN_REPORTED_KEYS) delete fields[key];
      return { fields, reportedAt: raw.reported?.reported_at ?? null };
    } catch {
      return null;
    }
  }

  /**
   * สั่งส่ง Config ให้กล่อง: ตรวจว่า Server กลางรู้จักและกล่องอยู่ในทะเบียน, แปลงค่าตาม schema
   * ที่กล่อง **รายงานว่ารันอยู่จริง**, แล้ว `PUT config` (Server กลางสร้างเวอร์ชันใหม่และส่งทันที
   * ถ้ากล่องออนไลน์ ถ้าออฟไลน์เขาเก็บคิวไว้ส่งตอนกล่องกลับมา) · ไม่โยน error ออกไป
   */
  async pushConfig(
    deviceId: string,
    fields: Record<string, unknown>,
  ): Promise<PushConfigOutcome> {
    const { list, device } = await this.findDevice(deviceId);
    if (!list.reachable) {
      return {
        kind: 'unavailable',
        reason: list.error ?? 'ติดต่อ Server กลางไม่ได้',
      };
    }
    if (!device) {
      return {
        kind: 'rejected',
        reason: `Server กลางไม่รู้จักกล่อง ${deviceId} (ยังไม่เคยเชื่อมต่อ)`,
      };
    }
    if (!device.registered) {
      return {
        kind: 'rejected',
        reason: `กล่อง ${deviceId} ยังไม่อยู่ในทะเบียนของ delivery-server จึงสั่ง Config ไม่ได้`,
      };
    }
    if (!device.hardwareModel || device.reportedSchemaVersion === null) {
      return {
        kind: 'rejected',
        reason: `กล่อง ${deviceId} ยังไม่รายงานโมเดลหรือ schema ที่รัน (ต้องให้กล่องเชื่อมต่อก่อน)`,
      };
    }

    try {
      const schema = await this.client.getSchema(
        device.hardwareModel,
        device.reportedSchemaVersion,
      );
      const built = buildCentralSettings(fields, schema);
      if ('errors' in built) {
        return { kind: 'rejected', reason: built.errors.join(' | ') };
      }
      const result = await this.client.putDeviceConfig(
        deviceId,
        built.settings,
      );
      // สถานะกล่องเปลี่ยนแล้ว ไม่ให้หน้าเว็บเห็นข้อมูลเก่าจาก cache
      this.cache = null;
      const commandId = result.command?.command_id;
      if (!commandId) {
        return {
          kind: 'rejected',
          reason: 'Server กลางรับ Config แล้วแต่ไม่สร้างคำสั่งส่งให้กล่อง',
        };
      }
      return { kind: 'sent', commandId, configVersion: result.config_version };
    } catch (err) {
      if (err instanceof CentralRejectedError) {
        return { kind: 'rejected', reason: err.message };
      }
      return {
        kind: 'unavailable',
        reason:
          err instanceof CentralUnavailableError
            ? err.message
            : 'ติดต่อ Server กลางไม่สำเร็จ',
      };
    }
  }

  /**
   * สั่งอัปเดต Firmware ให้กล่อง: ตรวจว่า Server กลางรู้จักและกล่องอยู่ในทะเบียนเหมือน
   * `pushConfig()` แต่ **ไม่ตรวจ schema เองฝั่งเรา** — Server กลางตรวจรุ่นฮาร์ดแวร์/เวอร์ชัน/
   * downgrade เองจากไฟล์ที่ส่งไป (`checkHardwareModel`/`VERSION_MISMATCH`/`DOWNGRADE_NOT_ALLOWED`
   * ใน `admin.js`) ไม่โยน error ออกไปเหมือนกัน
   */
  async pushFirmware(
    deviceId: string,
    data: Buffer,
    options: PushFirmwareOptions,
  ): Promise<PushFirmwareOutcome> {
    const { list, device } = await this.findDevice(deviceId);
    if (!list.reachable) {
      return {
        kind: 'unavailable',
        reason: list.error ?? 'ติดต่อ Server กลางไม่ได้',
      };
    }
    if (!device) {
      return {
        kind: 'rejected',
        reason: `Server กลางไม่รู้จักกล่อง ${deviceId} (ยังไม่เคยเชื่อมต่อ)`,
      };
    }
    if (!device.registered) {
      return {
        kind: 'rejected',
        reason: `กล่อง ${deviceId} ยังไม่อยู่ในทะเบียนของ delivery-server จึงอัปเดต Firmware ไม่ได้`,
      };
    }

    try {
      const result = await this.client.pushFirmware(deviceId, data, options);
      // สถานะกล่องเปลี่ยนแล้ว ไม่ให้หน้าเว็บเห็นข้อมูลเก่าจาก cache
      this.cache = null;
      const commandId = result.command?.command_id;
      if (!commandId) {
        return {
          kind: 'rejected',
          reason:
            result.message ??
            'Server กลางรับไฟล์ Firmware แล้วแต่ไม่สร้างคำสั่งส่งให้กล่อง',
        };
      }
      return { kind: 'sent', commandId };
    } catch (err) {
      if (err instanceof CentralRejectedError) {
        return { kind: 'rejected', reason: err.message };
      }
      return {
        kind: 'unavailable',
        reason:
          err instanceof CentralUnavailableError
            ? err.message
            : 'ติดต่อ Server กลางไม่สำเร็จ',
      };
    }
  }

  /** ผลล่าสุดของคำสั่งที่เคยสั่งไว้ · ถามไม่ได้ = `unavailable` (ไม่ตัดสิน รอถามใหม่) */
  async getCommandOutcome(commandId: string): Promise<CentralCommandOutcome> {
    try {
      return classifyCentralCommand(await this.client.getCommand(commandId));
    } catch (err) {
      if (err instanceof CentralRejectedError) {
        return {
          kind: 'failed',
          detail: `Server กลางไม่พบคำสั่ง ${commandId} (${err.message})`,
        };
      }
      return { kind: 'unavailable' };
    }
  }

  /**
   * fallback หา Firmware เดิมตอน Rollback ไม่มีบันทึกในระบบเราเลย (#362
   * ส่วนขยาย, พี่เลี้ยงแนะนำ) — ไล่ประวัติคำสั่งจาก Server กลางเอง (ground
   * truth จริง ไม่ต้องพึ่งข้อมูลที่เราบันทึกเอง) หาคำสั่งอัปเดต Firmware
   * ล่าสุดที่ `SUCCESS` และเวอร์ชันต่างจากที่กล่องรายงานว่ารันอยู่ตอนนี้ ·
   * **best-effort ล้วนๆ เหมือน method อื่นในคลาสนี้** — ติดต่อไม่ได้/ไม่รู้จัก
   * กล่อง/ไม่มีประวัติที่เข้าเกณฑ์ -> `null` เสมอ ไม่ throw ให้ผู้เรียกต้อง
   * ตัดสินเองว่าจะแจ้ง error อะไรต่อ (ดู `CampaignRolloutService.rollback()`)
   */
  async findPreviousSuccessfulFirmwareVersion(
    deviceId: string,
  ): Promise<string | null> {
    try {
      const { device } = await this.findDevice(deviceId);
      if (!device) return null;
      const commands = await this.client.listDeviceCommands(deviceId);
      const match = commands.find(
        (c) =>
          c.action === 'UPDATE_FIRMWARE' &&
          c.status === 'SUCCESS' &&
          c.target_firmware_version &&
          c.target_firmware_version !== device.reportedFirmwareVersion,
      );
      return match?.target_firmware_version ?? null;
    } catch {
      return null;
    }
  }

  private async fetchDevices(): Promise<CentralDeviceList> {
    const base = { mode: this.mode, fetchedAt: new Date().toISOString() };
    try {
      const [gateway, registry] = await Promise.all([
        this.client.listGatewayDevices(),
        this.client.listRegistryDevices(),
      ]);
      return {
        ...base,
        reachable: true,
        error: null,
        devices: mergeDevices(gateway, registry),
      };
    } catch (err) {
      const message =
        err instanceof CentralUnavailableError
          ? err.message
          : 'ติดต่อ Server กลางไม่สำเร็จ';
      return { ...base, reachable: false, error: message, devices: [] };
    }
  }
}

/** อยู่ในทะเบียนของ delivery-server และยังไม่ถูก revoke (กล่องที่ถูกเพิกถอนสั่ง Config ไม่ได้) */
function isUsableRegistration(reg: RawRegistryDevice | undefined): boolean {
  return reg !== undefined && reg.status !== 'revoked';
}

function mergeDevices(
  gateway: RawGatewayDevice[],
  registry: RawRegistryDevice[],
): CentralDevice[] {
  const registryById = new Map(registry.map((r) => [r.device_id, r]));
  const seen = new Set<string>();
  const devices: CentralDevice[] = [];

  for (const g of gateway) {
    seen.add(g.device_id);
    const reg = registryById.get(g.device_id);
    devices.push({
      deviceId: g.device_id,
      hardwareModel: g.hardware_model ?? reg?.hardware_model ?? null,
      online: g.online === true,
      lastSeenAt: g.last_seen_at ?? null,
      reportedFirmwareVersion: g.firmware_version_reported ?? null,
      reportedConfigVersion: g.config_version_reported ?? null,
      reportedSchemaVersion: g.schema_version_reported ?? null,
      desiredConfigVersion: reg?.config_version_desired ?? null,
      registered: isUsableRegistration(reg),
      lastCommand: g.last_command
        ? {
            commandId: g.last_command.command_id,
            action: g.last_command.action,
            target:
              g.last_command.target === null ||
              g.last_command.target === undefined
                ? null
                : String(g.last_command.target),
            status: g.last_command.status,
            errorCode: g.last_command.error_code ?? null,
            updatedAt: g.last_command.updated_at ?? null,
          }
        : null,
    });
  }

  // อยู่ในทะเบียน delivery แต่กล่องยังไม่เคยต่อ gateway
  for (const reg of registry) {
    if (seen.has(reg.device_id)) continue;
    devices.push({
      deviceId: reg.device_id,
      hardwareModel: reg.hardware_model ?? null,
      online: false,
      lastSeenAt: null,
      reportedFirmwareVersion: null,
      reportedConfigVersion: null,
      reportedSchemaVersion: null,
      desiredConfigVersion: reg.config_version_desired ?? null,
      registered: isUsableRegistration(reg),
      lastCommand: null,
    });
  }

  return devices.sort((a, b) => a.deviceId.localeCompare(b.deviceId));
}
