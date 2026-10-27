import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DeviceService } from './device.service';
import type { ActingUser } from './device.service';
import { SELF_SCOPED_ROLES, UNSCOPED_TASK_ROLES } from '../task/task.service';
import {
  DEVICE_HISTORY_TYPES,
  type DeviceHistoryConfigRef,
  type DeviceHistoryDecision,
  type DeviceHistoryFirmwareRef,
  type DeviceHistoryItem,
  type DeviceHistoryResult,
  type DeviceHistorySummary,
  type DeviceHistoryType,
} from './device-history.types';
import type { QueryDeviceHistoryDto } from './dto/query-device-history.dto';

const DEFAULT_LIMIT = 30;
/** เผื่อรายการที่เวลาเท่ากับ cursor ซึ่งต้องตัดออกในหน่วยความจำ (ดู `isAfterCursor`) */
const CURSOR_TIE_ALLOWANCE = 20;

const EMPTY_REFS: DeviceHistoryItem['refs'] = {
  campaignId: null,
  rolloutId: null,
  taskId: null,
  incidentId: null,
  overrideId: null,
};

/** รายการดิบก่อนเติมชื่อ Config/Firmware/แคมเปญ (ดึงชื่อแบบ batch ครั้งเดียวทีหลัง) */
type DraftItem = Omit<DeviceHistoryItem, 'config' | 'firmware' | 'title'> & {
  title: string | null;
  configId: string | null;
  firmwareId: string | null;
  campaignId: string | null;
  /** เวลาที่ใช้ประมาณเวอร์ชัน Config ของรายการนี้ (เฉพาะ Rollout) */
  versionAt?: Date;
};

/**
 * `GET /devices/{deviceId}/history` — ประวัติของอุปกรณ์เครื่องเดียว รวมจากตารางเดิม
 * ทั้งหมดเป็นเส้นเวลา (ใหม่ไปเก่า) ไม่มีตารางประวัติใหม่
 *
 * **การแบ่งหน้า:** แต่ละแหล่งดึงเฉพาะที่ใหม่กว่า cursor และไม่เกิน `limit` (+ เผื่อรายการเวลา
 * เท่ากัน) แล้วรวมเรียงในหน่วยความจำ ตัดเหลือ `limit` · เรียง `occurredAt` มากไปน้อย
 * ตามด้วย `id` มากไปน้อย (tie-break) cursor = `<เวลา>_<id>` ของรายการสุดท้ายในหน้า
 *
 * **เวลาของเหตุการณ์ (`occurredAt`):** เป้าหมาย Rollout = `updatedAt` (เวลาที่ผลล่าสุดเปลี่ยน),
 * คำขอแก้ค่า/Firmware = `overriddenAt` (เวลาที่ขอ ผลการตัดสินใจอยู่ใน `decision`),
 * Task = `updatedAt`, Incident = `createdAt`, ลงทะเบียน/ติดตั้ง = `registeredAt`/`installedAt`
 */
@Injectable()
export class DeviceHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deviceService: DeviceService,
  ) {}

  async getHistory(
    deviceId: string,
    query: QueryDeviceHistoryDto,
    actor: ActingUser,
  ): Promise<DeviceHistoryResult> {
    const device = await this.deviceService.findByDeviceId(deviceId); // 404 ถ้าไม่พบ
    const limit = query.limit ?? DEFAULT_LIMIT;
    const types = new Set<DeviceHistoryType>(
      query.types && query.types.length > 0
        ? (query.types as DeviceHistoryType[])
        : DEVICE_HISTORY_TYPES,
    );
    const cursor = parseCursor(query.before);
    const take = limit + CURSOR_TIE_ALLOWANCE;
    const id = device.deviceId;

    const drafts: DraftItem[] = [];

    if (types.has('lifecycle')) {
      drafts.push(
        lifecycleDraft(id, 'registered', device.registeredAt),
        ...(device.installedAt
          ? [lifecycleDraft(id, 'installed', device.installedAt)]
          : []),
      );
    }

    if (types.has('rollout')) {
      const targets = await this.prisma.campaignRolloutTarget.findMany({
        where: { deviceId: id, ...atOrBefore('updatedAt', cursor) },
        orderBy: { updatedAt: 'desc' },
        take,
        include: {
          rollout: {
            select: {
              id: true,
              campaignId: true,
              payloadType: true,
              configId: true,
              firmwareId: true,
              isRollback: true,
              createdAt: true,
              approvedAt: true,
            },
          },
        },
      });
      for (const t of targets) {
        drafts.push({
          ...baseDraft(`rollout:${t.id}`, 'rollout', t.updatedAt),
          status: t.status,
          detail: t.resultDetail,
          payloadType: t.rollout.payloadType,
          isRollback: t.rollout.isRollback,
          configId: t.rollout.configId,
          firmwareId: t.rollout.firmwareId,
          campaignId: t.rollout.campaignId,
          refs: {
            ...EMPTY_REFS,
            campaignId: t.rollout.campaignId,
            rolloutId: t.rollout.id,
          },
          // เวลาที่ใช้ประมาณเวอร์ชัน Config ของ Rollout นี้ (ดู `versionAt`)
          versionAt: t.rollout.approvedAt ?? t.rollout.createdAt,
        });
      }
    }

    // config-override/firmware-override: `device-config-override:Read`/
    // `device-firmware-override:Read` grant ให้ Operation เท่านั้น (seed.ts)
    // — role อื่นเห็นได้เฉพาะคำขอที่ตัวเองเป็นคนส่ง (`overriddenBy`) เหมือน
    // เปิดดูคำขอของตัวเองได้เสมอ ไม่ต้องมีสิทธิ์ queue เต็ม (รีวิว B บน #371:
    // ก่อนแก้ ทุก role เห็นเหตุผล/ผู้ขอ/ผลตัดสินของทุกคำขอ) — role ที่ไม่เคย
    // ส่งคำขอเลย (ไม่มี grant `Override`) กรองนี้ก็ได้ผลลัพธ์ว่างเองตามธรรมชาติ
    if (types.has('config-override')) {
      const canReadAll = actor.role === 'Operation';
      const rows = await this.prisma.deviceConfigOverride.findMany({
        where: {
          deviceId: id,
          ...atOrBefore('overriddenAt', cursor),
          ...(canReadAll ? {} : { overriddenBy: actor.id }),
        },
        orderBy: { overriddenAt: 'desc' },
        take,
      });
      for (const o of rows) {
        drafts.push({
          ...baseDraft(
            `config-override:${o.id}`,
            'config-override',
            o.overriddenAt,
          ),
          status: o.status,
          detail: o.reason,
          actorId: o.overriddenBy,
          configId: o.configId,
          decision: decisionOf(o.decidedBy, o.decidedAt, o.rejectReason),
          refs: { ...EMPTY_REFS, overrideId: o.id },
        });
      }
    }

    if (types.has('firmware-override')) {
      const canReadAll = actor.role === 'Operation';
      const rows = await this.prisma.deviceFirmwareOverride.findMany({
        where: {
          deviceId: id,
          ...atOrBefore('overriddenAt', cursor),
          ...(canReadAll ? {} : { overriddenBy: actor.id }),
        },
        orderBy: { overriddenAt: 'desc' },
        take,
      });
      for (const o of rows) {
        drafts.push({
          ...baseDraft(
            `firmware-override:${o.id}`,
            'firmware-override',
            o.overriddenAt,
          ),
          status: o.status,
          detail: o.reason,
          actorId: o.overriddenBy,
          firmwareId: o.firmwareId,
          decision: decisionOf(o.decidedBy, o.decidedAt, o.rejectReason),
          refs: { ...EMPTY_REFS, overrideId: o.id },
        });
      }
    }

    // task: `tasks:Read` ไม่ได้ grant ให้ทุก role (ConfigEngineer/
    // FirmwareEngineer/QAEngineer ไม่มีเลย) และ ST/OT เห็นเฉพาะงานที่ตัวเอง
    // ถูก assign (mirror `TaskService.isHiddenFromActor()`) — ก่อนแก้ ทุก
    // role เห็นทุกงานของเครื่องนี้ไม่ว่าใครเป็นคนทำ (รีวิว B บน #371) ·
    // role ที่ไม่อยู่ใน 2 ลิสต์เลย (default-deny ตาม IDOR Prevention Pattern)
    // ข้ามไปเลย ไม่ query
    const canReadAnyTask = UNSCOPED_TASK_ROLES.includes(actor.role);
    const canReadOwnTask = SELF_SCOPED_ROLES.includes(actor.role);
    if (types.has('task') && (canReadAnyTask || canReadOwnTask)) {
      const rows = await this.prisma.task.findMany({
        where: {
          deviceId: id,
          ...atOrBefore('updatedAt', cursor),
          ...(canReadAnyTask ? {} : { assignedTo: actor.id }),
        },
        orderBy: { updatedAt: 'desc' },
        take,
      });
      for (const t of rows) {
        drafts.push({
          ...baseDraft(`task:${t.id}`, 'task', t.updatedAt),
          status: t.status,
          title: t.title,
          detail: t.description,
          actorId: t.assignedTo,
          configId: t.configId,
          campaignId: t.campaignId,
          refs: { ...EMPTY_REFS, taskId: t.id, campaignId: t.campaignId },
        });
      }
    }

    if (types.has('incident')) {
      // ปัญหาที่แจ้งกับเครื่องนี้ (`deviceId`) และ Incident จาก Rollout ที่เครื่องนี้อยู่
      // ในรายชื่อเครื่องที่ล้ม (`metadata.failedDeviceIds` เก็บไว้สูงสุด 20 เครื่อง)
      const rows = await this.prisma.incident.findMany({
        where: {
          AND: [
            {
              OR: [
                { deviceId: id },
                {
                  source: 'rollout-failure',
                  metadata: { path: ['failedDeviceIds'], array_contains: id },
                },
              ],
            },
            atOrBefore('createdAt', cursor),
          ],
        },
        orderBy: { createdAt: 'desc' },
        take,
      });
      for (const i of rows) {
        drafts.push({
          ...baseDraft(`incident:${i.id}`, 'incident', i.createdAt),
          status: i.status,
          title: i.title,
          detail: i.description,
          actorId: i.reportedBy,
          severity: i.severity,
          configId: i.relatedConfigId,
          firmwareId: i.relatedFirmwareId,
          refs: { ...EMPTY_REFS, incidentId: i.id },
        });
      }
    }

    const page = drafts
      .filter((d) => isAfterCursor(d, cursor))
      .sort(compareNewestFirst)
      .slice(0, limit + 1);
    const hasMore = page.length > limit;
    const slice = page.slice(0, limit);

    const [items, summary] = await Promise.all([
      this.resolve(slice),
      this.getSummary(id),
    ]);
    const last = slice[slice.length - 1];
    return {
      summary,
      items,
      nextCursor: hasMore && last ? `${last.occurredAt}_${last.id}` : null,
    };
  }

  /** Config และ Firmware ที่ใช้อยู่ตอนนี้ */
  private async getSummary(deviceId: string): Promise<DeviceHistorySummary> {
    const [config, firmware] = await Promise.all([
      this.deviceService.findCurrentConfigOrNull(deviceId),
      this.findCurrentFirmware(deviceId),
    ]);
    return {
      currentConfig: config ? { id: config.id, name: config.name } : null,
      currentFirmware: firmware,
    };
  }

  /** Firmware ที่ติดตั้งสำเร็จล่าสุด: เป้าหมาย Rollout Firmware ที่สำเร็จล่าสุด หรือคำขอ
   * Firmware Override ที่ช่างยืนยันติดตั้งแล้ว (`consumedAt`) อันไหนใหม่กว่า · Rollback
   * ที่สำเร็จมี `firmwareId` ของรุ่นก่อนหน้า ผลจึงกลับเป็นรุ่นเก่าเองโดยอัตโนมัติ */
  private async findCurrentFirmware(
    deviceId: string,
  ): Promise<DeviceHistoryFirmwareRef | null> {
    const [target, override] = await Promise.all([
      this.prisma.campaignRolloutTarget.findFirst({
        where: {
          deviceId,
          status: 'success',
          rollout: { payloadType: 'Firmware', firmwareId: { not: null } },
        },
        orderBy: { updatedAt: 'desc' },
        include: { rollout: { select: { firmwareId: true } } },
      }),
      this.prisma.deviceFirmwareOverride.findFirst({
        where: { deviceId, consumedAt: { not: null } },
        orderBy: { consumedAt: 'desc' },
      }),
    ]);
    const targetAt = target?.updatedAt ?? null;
    const overrideAt = override?.consumedAt ?? null;
    const firmwareId =
      targetAt && (!overrideAt || targetAt >= overrideAt)
        ? (target?.rollout.firmwareId ?? null)
        : (override?.firmwareId ?? null);
    if (!firmwareId) return null;
    const firmware = await this.prisma.firmware.findUnique({
      where: { id: firmwareId },
      select: { id: true, version: true },
    });
    return firmware ? { id: firmware.id, version: firmware.version } : null;
  }

  /** เติมชื่อแคมเปญ ชื่อและเวอร์ชัน Config และเวอร์ชัน Firmware แบบ batch (ไม่ query ทีละรายการ) */
  private async resolve(drafts: DraftItem[]): Promise<DeviceHistoryItem[]> {
    const configIds = unique(drafts.map((d) => d.configId));
    const firmwareIds = unique(drafts.map((d) => d.firmwareId));
    const campaignIds = unique(
      drafts.filter((d) => d.type === 'rollout').map((d) => d.campaignId),
    );

    const noConfigs: { id: string; name: string }[] = [];
    const noVersions: {
      configId: string;
      versionNumber: number;
      approvedAt: Date;
    }[] = [];
    const noFirmwares: { id: string; version: string }[] = [];
    const [configs, versions, firmwares, campaigns] = await Promise.all([
      configIds.length
        ? this.prisma.config.findMany({
            where: { id: { in: configIds } },
            select: { id: true, name: true },
          })
        : noConfigs,
      configIds.length
        ? this.prisma.configVersion.findMany({
            where: { configId: { in: configIds } },
            select: { configId: true, versionNumber: true, approvedAt: true },
          })
        : noVersions,
      firmwareIds.length
        ? this.prisma.firmware.findMany({
            where: { id: { in: firmwareIds } },
            select: { id: true, version: true },
          })
        : noFirmwares,
      campaignIds.length
        ? this.prisma.campaign.findMany({
            where: { id: { in: campaignIds } },
            select: { id: true, name: true },
          })
        : noConfigs,
    ]);
    const configName = new Map(configs.map((c) => [c.id, c.name]));
    const firmwareVersion = new Map(firmwares.map((f) => [f.id, f.version]));
    const campaignName = new Map(campaigns.map((c) => [c.id, c.name]));

    return drafts.map((d) => {
      const { configId, firmwareId, campaignId, versionAt, ...item } = d;
      const config: DeviceHistoryConfigRef | null =
        configId && configName.has(configId)
          ? {
              id: configId,
              name: configName.get(configId)!,
              versionNumber: versionAt
                ? versionAtTime(versions, configId, versionAt)
                : null,
            }
          : null;
      const firmware: DeviceHistoryFirmwareRef | null =
        firmwareId && firmwareVersion.has(firmwareId)
          ? { id: firmwareId, version: firmwareVersion.get(firmwareId)! }
          : null;
      return {
        ...item,
        title:
          item.title ??
          (d.type === 'rollout' && campaignId
            ? (campaignName.get(campaignId) ?? null)
            : null),
        config,
        firmware,
      };
    });
  }
}

function baseDraft(id: string, type: DeviceHistoryType, at: Date): DraftItem {
  return {
    id,
    type,
    occurredAt: at.toISOString(),
    status: null,
    title: null,
    detail: null,
    actorId: null,
    payloadType: null,
    isRollback: null,
    severity: null,
    decision: null,
    refs: { ...EMPTY_REFS },
    configId: null,
    firmwareId: null,
    campaignId: null,
  };
}

function lifecycleDraft(
  deviceId: string,
  kind: 'registered' | 'installed',
  at: Date,
): DraftItem {
  return {
    ...baseDraft(`lifecycle:${deviceId}:${kind}`, 'lifecycle', at),
    status: kind,
  };
}

function decisionOf(
  byId: string | null,
  at: Date | null,
  note: string | null,
): DeviceHistoryDecision | null {
  if (!byId && !at) return null;
  return { byId, at: at ? at.toISOString() : null, note };
}

/** เวอร์ชันของ Config ที่อนุมัติล่าสุดก่อนหรือ ณ เวลาที่ระบุ · null ถ้าไม่มี */
function versionAtTime(
  versions: { configId: string; versionNumber: number; approvedAt: Date }[],
  configId: string,
  at: Date,
): number | null {
  let best: number | null = null;
  for (const v of versions) {
    if (v.configId !== configId || v.approvedAt > at) continue;
    if (best === null || v.versionNumber > best) best = v.versionNumber;
  }
  return best;
}

function unique(ids: (string | null)[]): string[] {
  return [...new Set(ids.filter((id): id is string => id !== null))];
}

interface Cursor {
  at: string;
  id: string;
}

function parseCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  const sep = raw.indexOf('_');
  return { at: raw.slice(0, sep), id: raw.slice(sep + 1) };
}

/** เงื่อนไขฝั่ง DB: เวลา <= เวลาของ cursor (รายการเวลาเท่ากันตัดออกทีหลังในหน่วยความจำ) */
function atOrBefore<K extends string>(
  field: K,
  cursor: Cursor | null,
): Partial<Record<K, Prisma.DateTimeFilter>> {
  return cursor
    ? ({ [field]: { lte: new Date(cursor.at) } } as Partial<
        Record<K, Prisma.DateTimeFilter>
      >)
    : {};
}

/** รายการนี้อยู่หลัง cursor ในลำดับ (เวลา มากไปน้อย แล้ว id มากไปน้อย) หรือไม่ */
function isAfterCursor(
  item: { occurredAt: string; id: string },
  c: Cursor | null,
) {
  if (!c) return true;
  return item.occurredAt < c.at || (item.occurredAt === c.at && item.id < c.id);
}

function compareNewestFirst(
  a: { occurredAt: string; id: string },
  b: { occurredAt: string; id: string },
): number {
  if (a.occurredAt !== b.occurredAt)
    return a.occurredAt < b.occurredAt ? 1 : -1;
  if (a.id !== b.id) return a.id < b.id ? 1 : -1;
  return 0;
}
