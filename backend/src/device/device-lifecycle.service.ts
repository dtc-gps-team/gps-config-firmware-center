import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Device, Prisma } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import type { AuditLogMetadata } from '../audit/audit-log-metadata';
import { OPEN_CAMPAIGN_ROLLOUT_STATUSES } from '../campaign/campaign-rollout-status';
import { lockCustomerForReference } from '../customer/customer-lock';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertDeviceIdentifiersFree,
  lockDeviceIdentifiers,
} from './device-identifiers';
import { lockDeviceForChange } from './device-lock';
import type { ActingUser, DeviceWithCustomer } from './device.service';
import type { RegisterDeviceResult } from './device.service';
import {
  DecommissionDeviceDto,
  ReactivateDeviceDto,
} from './dto/decommission-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';

const AUDIT_MODULE = 'device';

const CUSTOMER_INCLUDE = {
  customer: { select: { id: true, companyName: true } },
} as const;

/** งานของ Task ที่ยังไม่จบ — ตรงกับ `OPEN_TASK_STATUSES` ของ task module (ไม่ import ข้าม เพื่อไม่ให้พึ่งกัน) */
const OPEN_TASK_STATUSES = ['pending', 'in_progress'] as const;
/** คำขอส่งเข้ากล่องที่ยังไม่จบ (ผู้ตัดสิน/ช่างยังต้องทำต่อ หรือกำลังส่งอยู่) */
const OPEN_APPLY_REQUEST_STATUSES = ['pending', 'approved', 'sending'] as const;

/**
 * วงจรชีวิตของอุปกรณ์หลังลงทะเบียน (มติ A 2026-11-05): แก้ไขข้อมูล · ปลดระวาง · เปิดใช้กลับ
 *
 * แยกจาก `DeviceService` ที่ใหญ่อยู่แล้ว — logic ชุดนี้พึ่ง transaction + ล็อกแถวเป็นหลัก
 * (แพทเทิร์นเดียวกับ customer/device-model: ผู้ปลดระวางล็อก `Device` FOR UPDATE แล้วตรวจงานค้างซ้ำ
 * ผู้สร้างงานล็อก FOR SHARE ใน transaction เดียวกับการ insert — ดู `device-lock.ts`)
 */
@Injectable()
export class DeviceLifecycleService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `PATCH /devices/{deviceId}` — แก้ SIM / ลูกค้า / hardware revision / IMEI / Serial / Blackbox ID
   * (Device ID, โมเดล, โปรโตคอลแก้ไม่ได้) · เครื่องที่ปลดระวางแล้วแก้ไม่ได้ (409)
   *
   * ล็อก: `Device` FOR UPDATE -> ลูกค้า FOR SHARE (ถ้าเปลี่ยนลูกค้า) -> advisory ของเลขประจำตัว
   * (ถ้าเปลี่ยน IMEI/Serial/Blackbox) · ตรวจเฉพาะช่องที่ค่าเปลี่ยนจริง (ส่งค่าเดิมมาไม่ถือว่าซ้ำกับตัวเอง
   * และไม่ถูกบล็อกด้วยเครื่องอื่นที่ซ้ำอยู่ก่อนหน้า) · ไม่มีช่องไหนเปลี่ยน = คืนค่าเดิม ไม่เขียน AuditLog
   * · SIM ชนเครื่องอื่นที่ใช้งานอยู่ = 409 (unique index `Device_simNumber_active_key`)
   */
  async update(
    deviceId: string,
    dto: UpdateDeviceDto,
    actor: ActingUser,
  ): Promise<DeviceWithCustomer> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const locked = await lockDeviceForChange(tx, deviceId);
        if (locked.status === 'decommissioned') {
          throw new ConflictException(
            `เครื่อง ${deviceId} ปลดระวางแล้ว แก้ไขข้อมูลไม่ได้ - เปิดใช้งานเครื่องกลับก่อน`,
          );
        }
        const existing = await tx.device.findUniqueOrThrow({
          where: { deviceId },
          include: CUSTOMER_INCLUDE,
        });

        const data: Prisma.DeviceUncheckedUpdateInput = {};
        const changed: string[] = [];
        const apply = <K extends keyof Device>(
          key: K,
          next: Device[K] | undefined,
        ) => {
          if (next === undefined || next === existing[key]) return;
          (data as Record<string, unknown>)[key as string] = next;
          changed.push(key);
        };
        apply('simNumber', dto.simNumber);
        apply('customerId', dto.customerId);
        apply('hardwareRevisionCode', dto.hardwareRevisionCode);
        apply('imei', dto.imei);
        apply('serialNumber', dto.serialNumber);
        apply('blackboxId', dto.blackboxId);

        if (changed.length === 0) return existing;

        if (data.customerId) {
          await lockCustomerForReference(tx, data.customerId as string);
        }
        const identifiersChanged = (
          ['imei', 'serialNumber', 'blackboxId'] as const
        ).filter((k) => changed.includes(k));
        if (identifiersChanged.length > 0) {
          await lockDeviceIdentifiers(tx);
          await assertDeviceIdentifiersFree(
            tx,
            Object.fromEntries(
              identifiersChanged.map((k) => [k, data[k] as string]),
            ),
            deviceId,
          );
        }

        const updated = await tx.device.update({
          where: { deviceId },
          data,
          include: CUSTOMER_INCLUDE,
        });
        const metadata: AuditLogMetadata = {
          deviceId,
          changedFields: changed,
        };
        await tx.auditLog.create({
          data: {
            userId: actor.id,
            auditModule: AUDIT_MODULE,
            action: 'update',
            metadata: metadata as Prisma.InputJsonValue,
            ipAddress: actor.ipAddress ?? null,
          },
        });
        return updated;
      });
    } catch (err) {
      throw this.mapUniqueViolation(err, deviceId, dto.simNumber);
    }
  }

  /**
   * `POST /devices/{deviceId}/decommission` — ปลดระวาง: `status = decommissioned` + ล้าง API key กับ key
   * telemetry (กล่องคุยกับระบบไม่ได้ทันที) + เก็บเวลา/เหตุผล · ประวัติทุกอย่างอยู่ต่อ · ซ่อนจากรายการ
   * Device Search ตามค่าเริ่มต้น · SIM ถูกปล่อย (เครื่องอื่นใช้ต่อได้) ส่วน IMEI/Serial/Blackbox **ไม่ถูกปล่อย**
   * (เครื่องเดิมที่กลับมาให้เปิดใช้กลับที่เรคคอร์ดเดิม)
   *
   * 409 พร้อมรายการ ถ้ายังมีงานค้างที่อ้างเครื่องนี้: คำขอส่งเข้ากล่องที่ยังไม่จบ, Rollout ที่ยังเปิดอยู่และ
   * เครื่องนี้ยังรอผล, Task ที่ยังไม่จบ, คำขอ Override (Config/Firmware) ที่รออนุมัติ · ตรวจหลังล็อก
   * `Device` FOR UPDATE ใน transaction เดียวกับการเปลี่ยนสถานะ (ผู้สร้างงานล็อก FOR SHARE ที่ `device-lock.ts`)
   */
  async decommission(
    deviceId: string,
    dto: DecommissionDeviceDto,
    actor: ActingUser,
  ): Promise<DeviceWithCustomer> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await lockDeviceForChange(tx, deviceId);
      if (locked.status === 'decommissioned') {
        throw new ConflictException(`เครื่อง ${deviceId} ปลดระวางไปแล้ว`);
      }

      const [
        applyRequests,
        rolloutTargets,
        tasks,
        configOverrides,
        firmwareOverrides,
      ] = await Promise.all([
        tx.configApplyRequest.count({
          where: { deviceId, status: { in: [...OPEN_APPLY_REQUEST_STATUSES] } },
        }),
        tx.campaignRolloutTarget.count({
          where: {
            deviceId,
            status: 'pending',
            rollout: { status: { in: [...OPEN_CAMPAIGN_ROLLOUT_STATUSES] } },
          },
        }),
        tx.task.count({
          where: { deviceId, status: { in: [...OPEN_TASK_STATUSES] } },
        }),
        tx.deviceConfigOverride.count({
          where: { deviceId, status: 'pending' },
        }),
        tx.deviceFirmwareOverride.count({
          where: { deviceId, status: 'pending' },
        }),
      ]);
      const blockers = [
        applyRequests > 0 &&
          `คำขอส่งเข้ากล่องที่ยังไม่จบ ${applyRequests} รายการ`,
        rolloutTargets > 0 &&
          `Rollout ที่ยังเปิดอยู่และเครื่องนี้ยังรอผล ${rolloutTargets} รายการ`,
        tasks > 0 && `งาน (Task) ที่ยังไม่จบ ${tasks} รายการ`,
        configOverrides > 0 &&
          `คำขอแก้ค่า Config เฉพาะเครื่องที่รออนุมัติ ${configOverrides} รายการ`,
        firmwareOverrides > 0 &&
          `คำขอ Firmware Override ที่รออนุมัติ ${firmwareOverrides} รายการ`,
      ].filter((b): b is string => typeof b === 'string');
      if (blockers.length > 0) {
        throw new ConflictException(
          `ปลดระวางเครื่อง ${deviceId} ไม่ได้ เพราะยังมีงานค้างอยู่: ${blockers.join(' · ')} - ทำให้จบหรือยกเลิกก่อน`,
        );
      }

      const updated = await tx.device.update({
        where: { deviceId },
        data: {
          status: 'decommissioned',
          apiKeyHash: null,
          telemetryKeyHash: null,
          decommissionedAt: new Date(),
          decommissionReason: dto.reason,
        },
        include: CUSTOMER_INCLUDE,
      });
      const metadata: AuditLogMetadata = { deviceId, reason: dto.reason };
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          auditModule: AUDIT_MODULE,
          action: 'decommission',
          metadata: metadata as Prisma.InputJsonValue,
          ipAddress: actor.ipAddress ?? null,
        },
      });
      return updated;
    });
  }

  /**
   * `POST /devices/{deviceId}/reactivate` — เปิดใช้เครื่องที่ปลดระวางกลับ: `status = registered` (ต้องยืนยัน
   * ติดตั้งใหม่) + ออก API key ใหม่ **แสดงครั้งเดียว** (เหมือนตอนลงทะเบียน) + ล้างเวลา/เหตุผลปลดระวาง ·
   * SIM ชนเครื่องอื่นที่ใช้งานอยู่แล้ว = 409 ให้ส่ง `simNumber` ใหม่มา
   */
  async reactivate(
    deviceId: string,
    dto: ReactivateDeviceDto,
    actor: ActingUser,
  ): Promise<RegisterDeviceResult> {
    const apiKey = randomBytes(32).toString('hex');
    const apiKeyHash = await bcrypt.hash(apiKey, 10);
    try {
      const device = await this.prisma.$transaction(async (tx) => {
        const locked = await lockDeviceForChange(tx, deviceId);
        if (locked.status !== 'decommissioned') {
          throw new ConflictException(
            `เครื่อง ${deviceId} ไม่ได้ปลดระวางอยู่ (สถานะ ${locked.status}) เปิดใช้งานกลับไม่ได้`,
          );
        }
        const updated = await tx.device.update({
          where: { deviceId },
          data: {
            status: 'registered',
            apiKeyHash,
            decommissionedAt: null,
            decommissionReason: null,
            ...(dto.simNumber ? { simNumber: dto.simNumber } : {}),
          },
        });
        const metadata: AuditLogMetadata = {
          deviceId,
          ...(dto.simNumber ? { changedFields: ['simNumber'] } : {}),
        };
        await tx.auditLog.create({
          data: {
            userId: actor.id,
            auditModule: AUDIT_MODULE,
            action: 'reactivate',
            metadata: metadata as Prisma.InputJsonValue,
            ipAddress: actor.ipAddress ?? null,
          },
        });
        return updated;
      });
      return { ...device, apiKey };
    } catch (err) {
      throw this.mapUniqueViolation(err, deviceId, dto.simNumber, true);
    }
  }

  /** P2002 ของ unique index SIM (เครื่องที่ใช้งานอยู่) -> 409 ที่บอกทางแก้ · P2025 -> 404 · อื่นๆ ส่งต่อ */
  private mapUniqueViolation(
    err: unknown,
    deviceId: string,
    simNumber: string | undefined,
    reactivating = false,
  ): unknown {
    if (err instanceof PrismaClientKnownRequestError) {
      if (err.code === 'P2002') {
        return new ConflictException(
          reactivating && !simNumber
            ? `SIM ของเครื่อง ${deviceId} ถูกเครื่องอื่นที่ใช้งานอยู่ใช้ไปแล้ว - ส่ง simNumber ใหม่มาตอนเปิดใช้งานกลับ`
            : `SIM Number "${simNumber ?? ''}" ถูกเครื่องอื่นที่ใช้งานอยู่ใช้แล้ว`,
        );
      }
      if (err.code === 'P2025') {
        return new NotFoundException(`ไม่พบ Device deviceId ${deviceId}`);
      }
    }
    return err;
  }
}
