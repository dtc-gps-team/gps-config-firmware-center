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
