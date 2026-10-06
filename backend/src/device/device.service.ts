import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CampaignRolloutStatus,
  CampaignRolloutTargetStatus,
  Config,
  Device,
  DeviceConfigOverride,
  DeviceConfigOverrideStatus,
  DeviceFirmwareOverride,
  DeviceFirmwareOverrideStatus,
  Firmware,
  Prisma,
} from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import type { AuditLogMetadata } from '../audit/audit-log-metadata';
import { CampaignRolloutService } from '../campaign/campaign-rollout.service';
import { CustomerSummary } from '../customer/customer.service';
import { DeviceModelService } from '../device-model/device-model.service';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { mergeApprovedOverride } from './config-override-merge';
import { QueryDeviceDto } from './dto/query-device.dto';
import { RegisterDeviceDto } from './dto/register-device.dto';

/** Device + ลูกค้าแบบย่อ (ถ้าผูกไว้) — docs/12_CustomerScope_Proposal.md เฟส B
 * (PR #127) · ใช้ `CustomerSummary` เดียวกับ `GET /customers` (id +
 * companyName เท่านั้น ไม่ embed contactName/email/phone) เพราะ Device Search
 * เปิดให้ทุก role อ่านได้ ไม่ควรพ่วงข้อมูลติดต่อลูกค้าที่ละเอียดกว่านั้นมาด้วย
 * — mirror pattern `ConfigFieldDefinitionWithSupport` ใน config-definition */
export type DeviceWithCustomer = Device & { customer: CustomerSummary | null };
import {
  APPLICABLE_CONFIG_STATUSES,
  CONFIG_APPLIER,
  type ConfigApplier,
  type ConfigApplyResult,
} from './config-applier';
import {
  DEVICE_SIMULATOR,
  type DeviceSimulator,
} from '../config/device-simulator';
import {
  DEVICE_CONNECTION_TESTER,
  type DeviceConnectionTester,
  type DeviceConnectionTestResult,
} from './device-connection-tester';
import type {
  CompatibilityCheckResult,
  DeviceSimulateConfigResult,
} from './simulate-config-result';
import { ConfirmFirmwareInstallDto } from './dto/confirm-firmware-install.dto';
import {
  CAMPAIGN_ELIGIBLE_FIRMWARE_APPROVAL_STATUS,
  SIMULATABLE_FIRMWARE_STATUS,
} from '../firmware/firmware-status';
import { ConfigDefinitionService } from '../config-definition/config-definition.service';
import { DeviceConfigOverrideDto } from './dto/device-config-override.dto';
import { RejectDeviceConfigOverrideDto } from './dto/reject-device-config-override.dto';
import { DeviceFirmwareOverrideDto } from './dto/device-firmware-override.dto';
import { RejectDeviceFirmwareOverrideDto } from './dto/reject-device-firmware-override.dto';

/** `GET /devices/{deviceId}/config` response — `Config` (base) + สถานะ
 * override เฉพาะเครื่องนี้ (issue #223, มติ 2026-09-24 ผ่านอนุมัติแล้วเท่านั้น
 * ถึงมีผล) — `hasDeviceOverride` = มีแถว `approved` ที่ merge ทับ `fields`
 * อยู่ไหม, `pendingOverride` = คำขอที่ยังรอ Operation ตัดสินใจของเครื่องนี้
 * (ถ้ามี — เครื่องหนึ่งมีได้ทีละ 1 รายการ) ดู `DeviceService.getCurrentConfig()` */
export type ConfigWithDeviceOverride = Config & {
  hasDeviceOverride: boolean;
  pendingOverride: DeviceConfigOverride | null;
};

/** สถานะเดียวที่ทดสอบสัญญาณ / ใส่ Config ได้ — อุปกรณ์ต้องติดตั้งจริงแล้ว
 * อุปกรณ์ที่ยัง `registered` (ยังไม่ติดตั้ง) หรือ `decommissioned` (ปลดระวางแล้ว)
 * ไม่มีความหมาย (ดู docs/06_Device_Connection_Test_Spec.md ข้อ 5) */
const TESTABLE_DEVICE_STATUS = 'installed';

/** AuditLog.auditModule ของแถวที่โมดูลนี้เขียน (#27) — `applyConfig`
 * (CLAUDE.md Audit Pattern ระบุ "นำ Config ไปใช้" ไว้ชัด) และ
 * `confirmFirmwareInstall` (#181) — test-connection/simulate-config เป็น
 * dry-run ไม่ persist จึงไม่ log */
const AUDIT_MODULE = 'device';

/** ผลลัพธ์ของ `confirmFirmwareInstall` — ตรงกับ `ConfirmFirmwareInstallResult`
 * ใน docs/api/openapi.yaml */
export interface ConfirmFirmwareInstallResult {
  deviceId: string;
  firmwareId: string;
  /** ISO 8601 — เวลาที่ backend บันทึกการยืนยัน (ไม่ใช่เวลาที่ช่างติดตั้งจริง
   * หน้างาน — endpoint นี้ไม่รู้เวลานั้น) */
  confirmedAt: string;
}

/** ผู้ที่กำลังเรียก endpoint — มาจาก JWT payload ({ sub, role }) เสมอ */
export interface ActingUser {
  id: string;
  role: string;
}

/** ค่าที่ `GET /devices/{deviceId}/status` คืนให้ต่อ Config/Firmware แยกกัน
 * (issue #245) — `unknown` = ไม่เคยอยู่ใน CampaignRolloutTarget ไหนเลย (ไม่ใช่
 * error เป็นค่าปกติที่ต้องรองรับ ตามที่ตอบ B ไว้) */
export type DevicePayloadStatus =
  'up_to_date' | 'pending' | 'failed' | 'unknown';

export interface DeviceStatusResult {
  deviceId: string;
  configStatus: DevicePayloadStatus;
  firmwareStatus: DevicePayloadStatus;
  /** placeholder เสมอเป็น `null` ตอนนี้ — รอผลคำถาม online/offline/check-in
   * แยกต่างหากกับ B (ดู comment เหนือ `getStatus()`) */
  lastCheckInMessage: string | null;
  /** คำขอ Firmware Override ที่ยังรอ Operation ตัดสินใจของเครื่องนี้ (ถ้ามี —
   * เครื่องหนึ่งมีได้ทีละ 1 รายการ ดู `overrideDeviceFirmware()`) **เพิ่มตาม
   * รีวิว B บน PR #257** — เดิม ST อ่านคำขอของตัวเองไม่ได้เลย
   * (`GET /device-firmware-overrides` เป็น Operation เท่านั้น) ทำให้ Mobile
   * โชว์ banner "รออนุมัติ" แบบที่ Config Override มี (`pendingOverride` ใน
   * `GET /devices/{deviceId}/config`) ไม่ได้ ต้องรอโดน 409 ก่อนถึงจะรู้ —
   * เกาะ endpoint นี้แทนที่จะเปิด endpoint ใหม่ เพราะ Mobile เรียกอยู่แล้ว
   * (mirror ตำแหน่งของ `pendingOverride` ฝั่ง Config แนวคิดเดียวกัน แค่คนละ
   * endpoint เพราะไม่มี "GET current firmware ของอุปกรณ์" แยกแบบ Config) —
   * ไม่ filter ด้วย `overriddenBy`/user id เพราะเป็นสถานะของ**อุปกรณ์**ไม่ใช่
   * ของผู้ใช้ (ไม่เข้าข่าย IDOR — Operation/ST/OT ที่อ่านอุปกรณ์เครื่องนี้ได้
   * อยู่แล้วตาม RBAC เห็นเหมือนกันหมด mirror `pendingOverride` ของ Config ที่
   * ก็ไม่ filter ด้วย user เช่นกัน) */
  pendingFirmwareOverride: DeviceFirmwareOverride | null;
}

/** rollout สถานะเหล่านี้ไม่เคยส่ง payload ไปอุปกรณ์จริง (ถูกปฏิเสธ/ยกเลิกก่อน
 * ได้ apply) — `CampaignRolloutTarget` ของรอบพวกนี้ไม่เคยถูกอัปเดตเลยตั้งแต่
 * สร้าง (ค้าง `pending` ตลอดไป เพราะ `reject()`/cancel ไม่แตะ target) ต้อง
 * กรองออกตอนดู "สถานะปัจจุบัน" ของอุปกรณ์ ไม่งั้นจะเห็น pending ผิดๆ */
const STATUS_IGNORED_ROLLOUT_STATUSES = ['rejected', 'cancelled'] as const;

function toDevicePayloadStatus(
  targetStatus: CampaignRolloutTargetStatus | undefined,
): DevicePayloadStatus {
  if (!targetStatus) return 'unknown';
  if (targetStatus === 'success') return 'up_to_date';
  if (targetStatus === 'failed') return 'failed';
  return 'pending';
}

/** ผลลัพธ์ของ `register()` (issue #157 PR 1) — `Device` ปกติ **ไม่มี**
 * `apiKeyHash` (ไม่มีทางหลุดออกมาอยู่แล้วเพราะ `PrismaService` ตั้ง
 * `omit` default ไว้ — แต่ประกาศ type แยกให้ชัดเจนอีกชั้น mirror
 * `UserSummary`/`ManagedUser` ที่ user.service.ts ตัด `passwordHash`) บวก
 * `apiKey` ค่าจริง (ไม่ hash) ที่โชว์ได้**ครั้งเดียว**ตอนลงทะเบียนเท่านั้น —
 * ไม่ persist ที่ไหนอีก ไม่มีทาง GET กลับมาดูซ้ำได้ */
export type RegisterDeviceResult = Omit<Device, 'apiKeyHash'> & {
  apiKey: string;
};

@Injectable()
export class DeviceService {
  private readonly logger = new Logger(DeviceService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(DEVICE_CONNECTION_TESTER)
    private readonly connectionTester: DeviceConnectionTester,
    @Inject(CONFIG_APPLIER)
    private readonly configApplier: ConfigApplier,
    @Inject(DEVICE_SIMULATOR)
    private readonly deviceSimulator: DeviceSimulator,
    private readonly campaignRolloutService: CampaignRolloutService,
    private readonly configDefinitionService: ConfigDefinitionService,
    private readonly notificationService: NotificationService,
    private readonly deviceModelService: DeviceModelService,
  ) {}

  /**
   * Device Search (Sprint 2 #11) — คืนรายการอุปกรณ์ทั้งหมด กรองตาม query
   * (ทุกตัว optional) เรียงตาม `deviceId` · ทุก Role อ่านได้ (RBAC_Matrix.md
   * §2 แถว "Device Search / Device Detail" = R ทุก Role · resource `devices`
   * action `Read` ที่ seed ให้ทุก role อยู่แล้ว)
   *
   * ยังไม่มี paging — จำนวน Device ใน MVP น้อย + UI ทำ filter/search ฝั่ง
   * client (UI standard ../planning/01_GPS_Build_Reference.md §3) · ออกแบบให้
   * เพิ่ม cursor paging ทีหลังได้ถ้าข้อมูลโต
   *
   * เพิ่ม `customer` แบบย่อเข้ามาด้วย (docs/12 เฟส B) ให้ Device Search แสดง/
   * กรองตามลูกค้าได้ · **filter `customerId` ที่ backend เพิ่มแล้ว (issue #204)**
   * — Mobile ใช้ดึง "รายการอุปกรณ์ของบริษัทที่เลือก" มา group ตาม deviceModel
   * เอง (เดิมมีแค่แสดงผลฝั่ง client อย่างเดียว)
   */
  findAll(query: QueryDeviceDto): Promise<DeviceWithCustomer[]> {
    const { search, deviceModel, protocol, status, customerId } = query;

    const where: Prisma.DeviceWhereInput = {
      deviceModel: deviceModel || undefined,
      protocol: protocol || undefined,
      status: status || undefined,
      customerId: customerId || undefined,
    };
    if (search) {
      where.OR = [
        { deviceId: { contains: search, mode: 'insensitive' } },
        { simNumber: { contains: search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.device.findMany({
      where,
      orderBy: { deviceId: 'asc' },
      include: { customer: { select: { id: true, companyName: true } } },
    });
  }

  /**
   * ค้นด้วย `Device.deviceId` (เลขเครื่องจริงที่ช่างกรอก/สแกน) **ไม่ใช่**
   * `Device.id` (surrogate UUID ภายในของ Prisma) — ตกลงกับ paveekornkwork-dev
   * บน PR #52: endpoint ฝั่งช่างหน้างานอ้างด้วยเลขเครื่องจริงเสมอ · ใช้ทั้ง
   * `GET /devices/{deviceId}` (Device Detail) และ endpoint ช่างหน้างาน (ที่ไม่
   * ได้ใช้ `customer` เลย แต่ join ทิ้งไว้เฉยๆ ไม่คุ้มแยก query ใหม่ ข้อมูล
   * น้อยมากใน MVP)
   */
  async findByDeviceId(deviceId: string): Promise<DeviceWithCustomer> {
    const device = await this.prisma.device.findUnique({
      where: { deviceId },
      include: { customer: { select: { id: true, companyName: true } } },
    });
    if (!device) {
      throw new NotFoundException(`ไม่พบ Device deviceId ${deviceId}`);
    }
    return device;
  }

  /**
   * `GET /devices/{deviceId}/status` (issue #245) — เวอร์ชันย่อ มีแค่
   * `configStatus`/`firmwareStatus` คำนวณจาก `CampaignRolloutTarget` ล่าสุด
   * ของอุปกรณ์นี้แยกตาม `payloadType` — ไม่ต้องมี schema/migration ใหม่เลย
   *
   * **ไม่มี online/offline หรือ lastCheckIn เวลาจริง** — ระบบไม่มี concept
   * "อุปกรณ์ check-in บอกว่ายังออนไลน์อยู่" เลยสักจุด (ไม่ใช่แค่ยังไม่
   * implement แต่ยังไม่เคยถูกออกแบบมาก่อน แม้แต่ #157 ครบ 3 PR ก็ไม่มี เพราะ
   * pull config/firmware + report ผล apply คนละเรื่องกับ "ping บอกว่ายังอยู่")
   * — เปิดเป็นคำถามแยกต่างหากกับ B ไว้แล้ว ไม่บล็อกเวอร์ชันย่อนี้
   * `lastCheckInMessage` จึงเป็น `null` เสมอตอนนี้ (placeholder รอผลคำถามนั้น)
   *
   * เลือก `CampaignRolloutTarget` ที่ `updatedAt` ล่าสุดของ deviceId นี้ ข้าม
   * เฉพาะ rollout ที่ `payloadType` ตรงกัน — กรอง rollout สถานะ `rejected`/
   * `cancelled` ออกเสมอ (targets ของรอบที่ไม่เคยส่ง payload จริง ไม่ควรนับเป็น
   * สถานะปัจจุบันของอุปกรณ์ — `reject()`/ไม่มีการอัปเดต target เลยตอน cancel
   * เก่า ปล่อย row ค้างเป็น `pending` ตลอดไป ถ้าไม่กรองจะเห็นเป็น "pending"
   * ผิดๆ ทั้งที่ไม่มีอะไรถูกส่งไปจริง)
   *
   * `pendingFirmwareOverride` (เพิ่มตามรีวิว B บน PR #257) — mirror
   * `pendingOverride` ของ `getCurrentConfig()` เกาะ endpoint นี้แทนที่จะเปิด
   * endpoint ใหม่ เพราะ Mobile เรียก `GET .../status` อยู่แล้ว (B ยืนยันแล้วว่า
   * สะดวกกว่า) ไม่ filter ด้วย `overriddenBy` เพราะเป็นสถานะของอุปกรณ์ ไม่ใช่
   * ของผู้ใช้คนที่ขอ — ไม่เข้าข่าย IDOR (Operation/ST/OT ที่อ่านอุปกรณ์เครื่องนี้
   * ได้ตาม RBAC อยู่แล้วเห็นเหมือนกันหมด)
   */
  async getStatus(deviceId: string): Promise<DeviceStatusResult> {
    const device = await this.findByDeviceId(deviceId); // 404 ถ้าไม่พบ

    const [configTarget, firmwareTarget, pendingFirmwareOverride] =
      await Promise.all([
        this.prisma.campaignRolloutTarget.findFirst({
          where: {
            deviceId: device.deviceId,
            rollout: {
              payloadType: 'Config',
              status: { notIn: [...STATUS_IGNORED_ROLLOUT_STATUSES] },
            },
          },
          orderBy: { updatedAt: 'desc' },
        }),
        this.prisma.campaignRolloutTarget.findFirst({
          where: {
            deviceId: device.deviceId,
            rollout: {
              payloadType: 'Firmware',
              status: { notIn: [...STATUS_IGNORED_ROLLOUT_STATUSES] },
            },
          },
          orderBy: { updatedAt: 'desc' },
        }),
        this.prisma.deviceFirmwareOverride.findFirst({
          where: { deviceId: device.deviceId, status: 'pending' },
        }),
      ]);

    return {
      deviceId: device.deviceId,
      configStatus: toDevicePayloadStatus(configTarget?.status),
      firmwareStatus: toDevicePayloadStatus(firmwareTarget?.status),
      lastCheckInMessage: null,
      pendingFirmwareOverride,
    };
  }

  /**
   * `POST /devices` (issue #157 PR 1, docs/14_Device_Sync_Proposal.md §3.2) —
   * ลงทะเบียนอุปกรณ์ใหม่เข้าระบบ **endpoint ฝั่ง staff** (Admin/SuperAdmin
   * เท่านั้น ดู `device.controller.ts`) ไม่ใช่ endpoint ที่อุปกรณ์เรียกเอง —
   * อุปกรณ์ยังไม่มี API key จนกว่าการลงทะเบียนนี้จะสำเร็จ (ใช้ key นี้กับ
   * `DeviceApiKeyGuard` บน endpoint pull ของ PR 2/3 แทน)
   *
   * `deviceModel` คำนวณเองจาก `model.name` เสมอ ไม่รับจาก client ตรงๆ (issue
   * #209 ข้อ 5) · `protocol` ต้องอยู่ใน `model.supportedProtocols` (mirror
   * `ConfigService.validateDeviceModelProtocol` — issue #209 ข้อ 4)
   *
   * API key: random 32 byte ผ่าน `crypto.randomBytes` (ไม่ใช่ UUID — ไม่มี
   * ทางเดาได้จาก timestamp) hash ด้วย bcrypt เหมือน `User.passwordHash` คืน
   * ค่าจริง (`apiKey`) ใน response **ครั้งเดียว** เท่านั้น ไม่ log/persist ที่
   * ไหนอีกเลย (ดู `RegisterDeviceResult`)
   */
  async register(
    dto: RegisterDeviceDto,
    actor: ActingUser,
  ): Promise<RegisterDeviceResult> {
    const model = await this.deviceModelService.findOne(dto.modelId); // 404 ถ้าไม่พบ

    if (!model.supportedProtocols.includes(dto.protocol)) {
      throw new BadRequestException(
        `รุ่น "${model.name}" ไม่รองรับ protocol "${dto.protocol}" (รองรับ: ${model.supportedProtocols.join(', ')})`,
      );
    }

    // #246 review B — customerId รูปแบบ UUID ถูกแต่ไม่มีอยู่จริง เดิมปล่อยให้
    // Prisma โยน P2003 (FK violation) ตอน create ซึ่งไม่ได้ catch ไว้ กลายเป็น
    // 500 แทนที่จะเป็น error ที่สื่อความหมาย — เช็คก่อนเหมือน modelId ด้านบน
    if (dto.customerId) {
      const customer = await this.prisma.customer.findUnique({
        where: { id: dto.customerId },
      });
      if (!customer) {
        throw new NotFoundException(`ไม่พบ Customer id ${dto.customerId}`);
      }
    }

    const apiKey = randomBytes(32).toString('hex');
    const apiKeyHash = await bcrypt.hash(apiKey, 10);

    let device: Omit<Device, 'apiKeyHash'>;
    try {
      // apiKeyHash ไม่ถูกคืนกลับมาเอง — `PrismaService` ตั้ง omit default ไว้
      // (ดู prisma.service.ts) ไม่ต้อง override ในนี้ เพราะมี `apiKey` ตัวจริง
      // อยู่ในมือแล้วจากข้างบน ไม่ต้องอ่านค่า hash กลับมาอีกรอบ
      device = await this.prisma.device.create({
        data: {
          deviceId: dto.deviceId,
          simNumber: dto.simNumber,
          deviceModel: model.name,
          protocol: dto.protocol,
          hardwareRevisionCode: dto.hardwareRevisionCode,
          customerId: dto.customerId,
          modelId: model.id,
          apiKeyHash,
        },
      });
    } catch (err) {
      if (
        err instanceof PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          `มี Device deviceId "${dto.deviceId}" อยู่แล้ว`,
        );
      }
      throw err;
    }

    const metadata: AuditLogMetadata = { deviceId: device.deviceId };
    await this.prisma.auditLog.create({
      data: {
        userId: actor.id,
        auditModule: AUDIT_MODULE,
        action: 'register',
        metadata: metadata as Prisma.InputJsonValue,
      },
    });

    return { ...device, apiKey };
  }

  /**
   * `POST /devices/{deviceId}/rotate-key` (issue #157 — แยกเป็น PR เดี่ยว
   * ตามคำขอ B บนรีวิว PR #246/PR 1 เดิม หลังพบว่า `register()` รองรับแค่
   * เครื่องใหม่ สร้างเครื่องซ้ำไม่ได้ เครื่องเก่าที่มีอยู่ก่อนฟีเจอร์นี้เลย
   * ไม่มีทางได้ key เลย) ใช้ได้ 2 กรณี:
   *   1. ออก key ครั้งแรกให้เครื่องเก่าที่ลงทะเบียนไว้ก่อนฟีเจอร์นี้ (`apiKeyHash`
   *      เดิมเป็น `null`) — ทำให้ migrate ไปใช้ flow ใหม่ได้ทีละเครื่องตามจังหวะ
   *      จริง ไม่ต้องรอ migrate ครบทุกเครื่องมาพร้อมกัน (ดู comment เหนือ
   *      `ConfigService.enqueueConfigSync` — เช็ค `apiKeyHash` ตัดสินใจว่ายัง
   *      ต้องเขียนเข้า Legacy System อยู่ไหม)
   *   2. หมุนเวียน key เดิมถ้าสงสัยว่ารั่ว — overwrite ของเก่าทิ้งไปเลย ใช้
   *      ต่อไม่ได้ทันที ไม่มี grace period
   *
   * **การแจกจ่าย key ใหม่ให้กล่องจริงที่ติดตั้งอยู่แล้ว** (ระบบนี้เป็น PULL
   * model ล้วนๆ ไม่มีช่องทาง push อะไรเข้าไปหากล่องได้เลย) **เป็นขอบเขตของ
   * พี่เลี้ยง** เหมือนที่ตกลงกันไว้เรื่อง distribution ใน
   * docs/14_Device_Sync_Proposal.md §3.2 — endpoint นี้แค่รับประกันว่า "มี key
   * ที่ถูกต้องรออยู่ให้ไปติดตั้ง" เท่านั้น
   */
  async rotateKey(
    deviceId: string,
    actor: ActingUser,
  ): Promise<RegisterDeviceResult> {
    const existing = await this.prisma.device.findUnique({
      where: { deviceId },
    });
    if (!existing) {
      throw new NotFoundException(`ไม่พบ Device deviceId ${deviceId}`);
    }

    const apiKey = randomBytes(32).toString('hex');
    const apiKeyHash = await bcrypt.hash(apiKey, 10);

    let device: Omit<Device, 'apiKeyHash'>;
    try {
      device = await this.prisma.device.update({
        where: { deviceId },
        data: { apiKeyHash },
      });
    } catch (err) {
      // race: เครื่องถูกลบไปพอดีระหว่าง findUnique กับ update นี้ (rare) —
      // mirror DeviceModelService.update()
      if (
        err instanceof PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        throw new NotFoundException(`ไม่พบ Device deviceId ${deviceId}`);
      }
      throw err;
    }

    const metadata: AuditLogMetadata = { deviceId: device.deviceId };
    await this.prisma.auditLog.create({
      data: {
        userId: actor.id,
        auditModule: AUDIT_MODULE,
        action: 'rotate-key',
        metadata: metadata as Prisma.InputJsonValue,
      },
    });

    return { ...device, apiKey };
  }

  /**
   * ทดสอบการเชื่อมต่อ/สัญญาณของอุปกรณ์ที่ติดตั้งจริง — **ไม่แตะ status ของ
   * Device** คืนแค่ผลทดสอบ ณ ขณะนั้น
   *
   * รับ `deviceId` จาก path เท่านั้น (ไม่มี request body) — ดึง
   * `deviceModel`/`protocol` จาก record ใน DB เสมอ เพื่อไม่ให้ client ส่งค่า
   * ปลอมมา (แนวเดียวกับ `ConfigService.simulate`)
   */
  async testConnection(deviceId: string): Promise<DeviceConnectionTestResult> {
    const device = await this.findByDeviceId(deviceId);

    if (device.status !== TESTABLE_DEVICE_STATUS) {
      throw new ConflictException(
        `Device สถานะปัจจุบัน (${device.status}) ยังทดสอบสัญญาณไม่ได้ — ต้องเป็น ${TESTABLE_DEVICE_STATUS} (ติดตั้งจริงแล้ว) เท่านั้น`,
      );
    }

    return this.connectionTester.testConnection({
      deviceId: device.deviceId,
      deviceModel: device.deviceModel,
      protocol: device.protocol,
    });
  }

  /**
   * ใส่ Config ที่อนุมัติแล้วให้อุปกรณ์ที่ติดตั้งจริง (ช่างหน้างาน ST/OT ผ่าน
   * Mobile — เลือกจาก Task ที่กำลังทำ) — **ไม่ persist / ไม่แตะ state ใดๆ**
   * (fire-and-forget) กล่องจะรับค่าเมื่อเปิดเครื่องครั้งถัดไป (Build Reference
   * §4.2) ยืนยัน scope นี้กับ kittiphong (B) 2026-09 — ถ้าต้องเก็บประวัติ
   * "Config ล่าสุดของกล่อง" ค่อยเปิด scope ใหม่ (ต้องเพิ่ม model/field)
   *
   * เงื่อนไข (ตรงกับ 4xx ใน docs/api/openapi.yaml `applyConfigToDevice`):
   * - ไม่พบ Device / Config → 404
   * - Device ยังไม่ `installed` → 409
   * - Config ยังไม่ `approved`/`synced` → 409
   * - Config คนละ deviceModel/protocol กับ Device → 409
   */
  async applyConfig(
    deviceId: string,
    configId: string,
    actor: ActingUser,
  ): Promise<ConfigApplyResult> {
    const device = await this.findByDeviceId(deviceId);

    if (device.status !== TESTABLE_DEVICE_STATUS) {
      throw new ConflictException(
        `Device สถานะปัจจุบัน (${device.status}) ยังใส่ Config ไม่ได้ — ต้องเป็น ${TESTABLE_DEVICE_STATUS} (ติดตั้งจริงแล้ว) เท่านั้น`,
      );
    }

    const config = await this.prisma.config.findUnique({
      where: { id: configId },
    });
    // soft-deleted Config (docs/11 Part A) ถือว่า "ไม่พบ" เช่นกัน — mirror
    // `ConfigService.findOne()`/`getBaseConfigForDevice()` (issue #226: เดิม
    // เช็คแค่ `!config` เฉยๆ ทำให้ Config ที่ถูกลบไปแล้วยังเอาไปใส่เข้าอุปกรณ์ได้)
    if (!config || config.deletedAt !== null) {
      throw new NotFoundException(`ไม่พบ Config id ${configId}`);
    }
    if (!APPLICABLE_CONFIG_STATUSES.includes(config.status)) {
      throw new ConflictException(
        `Config สถานะปัจจุบัน (${config.status}) ยังใส่เข้าอุปกรณ์ไม่ได้ — ต้องผ่านการอนุมัติ (${APPLICABLE_CONFIG_STATUSES.join('/')}) ก่อน`,
      );
    }
    if (
      config.deviceModel !== device.deviceModel ||
      config.protocol !== device.protocol
    ) {
      throw new ConflictException(
        `Config นี้เป็นของ ${config.deviceModel}/${config.protocol} ไม่ตรงกับอุปกรณ์ ${device.deviceModel}/${device.protocol}`,
      );
    }

    // Per-device Config Override (issue #223/#226) — ใช้ค่าที่ ST override
    // แล้วผ่านอนุมัติจริง ไม่ใช่ base Config เดิมเฉยๆ
    const { fields } = await mergeApprovedOverride(
      this.prisma,
      device.deviceId,
      config.id,
      config.fields,
    );
    const result = await this.configApplier.applyConfig({
      deviceId: device.deviceId,
      deviceModel: device.deviceModel,
      protocol: device.protocol,
      fields,
    });

    // AuditLog (#27, CLAUDE.md Audit Pattern — "นำ Config ไปใช้") — log ทุกครั้ง
    // ที่ช่างกดใส่ Config เข้าอุปกรณ์ ไม่ว่าผล `applied` จะ true/false เพราะเป็น
    // การกระทำจริงที่ต้องมีร่องรอย compliance (endpoint นี้เอง fire-and-forget
    // ไม่ persist อะไรใน DB ของเรา — AuditLog แถวนี้จึงเป็นร่องรอยเดียวที่มี)
    //
    // metadata (issue #205, feedback พี่เลี้ยง) — deviceId/configId/fieldNames
    // ให้ระบุได้ว่า "ใส่ Config ไหนเข้าอุปกรณ์เครื่องไหน มี field อะไรบ้าง"
    // ตั้งใจเก็บแค่**ชื่อ**ของ field ไม่ใช่ค่าจริง (ดู comment เหนือ
    // AuditLog.metadata ใน schema.prisma — กัน field ที่มีค่าอ่อนไหว เช่น
    // COMMAND_PASSWORD/SOS_NUMBER_1 รั่วผ่าน GET /audit-logs)
    //
    // **never throws** (แก้ตาม review comment ของ B บน PR #146) — ตอนนี้กล่อง
    // ได้รับคำสั่ง apply ไปแล้วจริง (fire-and-forget) audit ล้มเหลวไม่ควรทำให้
    // client เห็น 500 ทั้งที่ผล `result` ข้างบนสำเร็จจริง
    try {
      const metadata: AuditLogMetadata = {
        deviceId: device.deviceId,
        configId: config.id,
        fieldNames: Object.keys(fields),
      };
      await this.prisma.auditLog.create({
        data: {
          userId: actor.id,
          auditModule: AUDIT_MODULE,
          action: 'apply-config',
          metadata: metadata as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.warn(
        `เขียน AuditLog ไม่สำเร็จ (module ${AUDIT_MODULE}, action apply-config, user ${actor.id}): ${(err as Error).message}`,
      );
    }

    // Campaign Monitor (#22, แก้ไข 2026-09-24) — รายงานผลให้ Rollout ที่ active
    // อยู่ (ถ้ามี) รู้ว่าเครื่องนี้สำเร็จ/ล้มเหลว — never-throw อยู่แล้วใน
    // ตัว recordTargetResult เอง (ดู comment ที่นั่น)
    await this.campaignRolloutService.recordTargetResult(
      device.deviceId,
      { configId: config.id },
      result.applied,
      result.details.join(' · '),
    );

    return result;
  }

  /**
   * "Confirm Firmware Install" (issue #181) — ช่างหน้างาน (ST/OT) ยืนยันเองว่า
   * ติดตั้ง Firmware เข้าอุปกรณ์เครื่องนี้เสร็จจริงแล้ว **ไม่ใช่คำสั่งส่งอะไร
   * ไปอุปกรณ์เลย** ต่างจาก `applyConfig` ที่ยังมี mock fire-and-forget อยู่
   * เบื้องหลัง — endpoint นี้เป็นแค่การบันทึก "มีการยืนยันเกิดขึ้น" (attestation)
   * เท่านั้น ไม่มี mock ฝั่ง push firmware ให้ fire-and-forget ด้วยซ้ำ
   *
   * **Deviation จาก GPS_Config_Firmware_Center_Design.pdf §10.2-10.3 โดยตั้งใจ**
   * — PDF ออกแบบ Workflow Firmware เป็น state machine อัตโนมัติเต็มรูปแบบ
   * (Pending→Pre-checking→Downloading→Verifying→Installing→Rebooting→Health
   * Checking→Success/Rollback) ที่ backend สื่อสารกับอุปกรณ์เองทุกขั้นตอน —
   * ทำไม่ได้เลยเพราะระบบนี้เป็น PULL model (อุปกรณ์ดึงข้อมูลเองตอนบูต backend
   * ไม่เคยคุยกับอุปกรณ์ตรงๆ) endpoint นี้จึงเป็น placeholder ระดับที่ทำได้ใน
   * ขอบเขตฝึกงานเท่านั้น (มติ A/B ในเธรด issue #181) — **ไม่คำนวณ**
   * `Firmware.deviceUpdateStatus` จริง (ยังคงเป็น `unknown` ต่อไป) รอออกแบบ
   * แยกเป็นงานถัดไปตามมติข้อ 3
   *
   * เงื่อนไข 4xx (mirror `applyConfig`):
   * - ไม่พบ Device / Firmware → 404
   * - Device ยังไม่ `installed` → 409
   * - Firmware ยังไม่ `stored` (upload) หรือยังไม่ `approved` (คุณภาพ) → 409
   * - Firmware ไม่รองรับ `device.deviceModel` (`deviceModelCompatibility`) → 409
   *
   * **ไม่ wrap try/catch เหมือน `applyConfig`** — ที่นั่น AuditLog เป็นแค่
   * ร่องรอยของการกระทำจริงที่สำเร็จไปแล้ว (fire-and-forget) แต่ที่นี่การเขียน
   * AuditLog **คือ** การกระทำทั้งหมด ไม่มีอย่างอื่นเกิดขึ้นเลยนอกจากแถวนี้ —
   * ถ้าเขียนไม่สำเร็จต้อง throw 500 ให้ช่างรู้ว่าต้องกดยืนยันใหม่ ไม่ใช่คืน
   * 200 ทั้งที่ไม่มีอะไรถูกบันทึกจริง
   */
  /** เช็ค 3 เงื่อนไขที่ Firmware ต้องผ่านก่อนใช้กับอุปกรณ์ได้ (upload/approval
   * status + compatibility) — ใช้ร่วมกันโดย `confirmFirmwareInstall()` (เช็ค
   * ตอนติดตั้งจริง) และ `overrideDeviceFirmware()` (เช็คตอนส่งคำขอ override —
   * ไม่มีประโยชน์ที่จะให้ขอ override เป็น firmware ที่ยังติดตั้งไม่ได้อยู่ดี)
   * extract ออกมาเพื่อไม่ให้เขียนเงื่อนไขเดียวกันซ้ำ 2 จุด (mirror
   * `mergeApprovedOverride` ที่ extract ออกมาด้วยเหตุผลเดียวกัน) */
  private assertFirmwareInstallable(firmware: Firmware, device: Device): void {
    if (firmware.uploadStatus !== SIMULATABLE_FIRMWARE_STATUS) {
      throw new ConflictException(
        `Firmware สถานะอัปโหลดปัจจุบัน (${firmware.uploadStatus}) ยังยืนยันติดตั้งไม่ได้ — ต้องเป็น "${SIMULATABLE_FIRMWARE_STATUS}" (จัดเก็บสำเร็จแล้ว) เท่านั้น`,
      );
    }
    if (
      firmware.approvalStatus !== CAMPAIGN_ELIGIBLE_FIRMWARE_APPROVAL_STATUS
    ) {
      throw new ConflictException(
        `Firmware สถานะอนุมัติคุณภาพปัจจุบัน (${firmware.approvalStatus}) ยังยืนยันติดตั้งไม่ได้ — ต้องเป็น "${CAMPAIGN_ELIGIBLE_FIRMWARE_APPROVAL_STATUS}" (QAEngineer อนุมัติคุณภาพแล้ว) เท่านั้น`,
      );
    }
    if (!firmware.deviceModelCompatibility.includes(device.deviceModel)) {
      throw new ConflictException(
        `Firmware นี้ไม่รองรับรุ่นอุปกรณ์ ${device.deviceModel} (รองรับ: ${firmware.deviceModelCompatibility.join(', ')})`,
      );
    }
  }

  /** สถานะ Campaign Rollout ที่นับเป็น "แผนที่ Campaign ตั้งใจจริง" สำหรับ
   * `findActiveFirmwareAssignment()` — แก้ตามรีวิว B บน PR #257 ข้อ 4: เดิมเช็ค
   * แค่ `active` เฉยๆ ไม่ครอบ `approved` (Operation อนุมัติแผนแล้วแค่ยังไม่กด
   * ปล่อย — เจตนาชัดเจนแล้วว่าจะใช้ firmware ตัวนี้) และ `paused` (Auto Pause
   * เพราะ failure rate เกิน threshold — เป็นการพักชั่วคราว ไม่ใช่ Operation
   * ยกเลิกแผน) ทั้งสองสถานะนี้ยังถือเป็นแผนที่ต้องเคารพเหมือน `active` —
   * **ไม่รวม** `pending_approval` (ยังไม่ผ่านอนุมัติ ไม่ใช่แผนที่ยืนยันแล้ว) และ
   * `rejected`/`cancelled`/`completed` (จบไปแล้วหรือไม่เคยถูกอนุมัติ) */
  private static readonly RELEVANT_FIRMWARE_ASSIGNMENT_ROLLOUT_STATUSES: readonly CampaignRolloutStatus[] =
    ['active', 'approved', 'paused'];

  /** หา Campaign Rollout (Firmware) ที่ยังเป็น "แผนที่ Campaign ตั้งใจจริง" อยู่
   * ตอนนี้ (ดู `RELEVANT_FIRMWARE_ASSIGNMENT_ROLLOUT_STATUSES`) ที่กำหนดอุปกรณ์
   * เครื่องนี้ไว้ — ใช้เป็นเกณฑ์ตัดสินว่า `confirmFirmwareInstall()` ต้องขอ
   * Firmware Override ก่อนไหม (ดู comment เหนือ `confirmFirmwareInstall()`) —
   * **จงใจไม่กรองด้วย `CampaignRolloutTarget.status` เลย** (ต่างจาก
   * `getStatus()` ด้านบนที่กรอง) เพราะที่นี่สนใจแค่ "Campaign ตั้งใจให้เครื่องนี้
   * ได้ firmware ตัวไหน" ไม่สนใจว่าผลรอบก่อนจะ pending/success/failed —
   * ยืนยัน firmware ตัวเดิมซ้ำ (เช่น retry หลัง fail) ไม่ควรนับเป็น override เลย
   *
   * **ข้อจำกัดที่รู้อยู่แล้ว ไม่ได้แก้รอบนี้:** ถ้าอุปกรณ์เครื่องเดียวอยู่ 2 กลุ่ม
   * (Campaign) พร้อมกันและทั้งคู่มี Firmware Rollout ที่เกี่ยวข้องขัดกันเอง จะได้
   * assignment แค่ตัวแรกที่เจอ (ไม่ได้ตรวจ/เตือน conflict ระหว่าง 2 Campaign) —
   * ไม่ใช่ use case ที่ตั้งใจรองรับใน MVP นี้ */
  private async findActiveFirmwareAssignment(
    deviceId: string,
  ): Promise<{ firmwareId: string } | null> {
    const target = await this.prisma.campaignRolloutTarget.findFirst({
      where: {
        deviceId,
        rollout: {
          payloadType: 'Firmware',
          status: {
            in: [
              ...DeviceService.RELEVANT_FIRMWARE_ASSIGNMENT_ROLLOUT_STATUSES,
            ],
          },
        },
      },
      include: { rollout: { select: { firmwareId: true } } },
    });
    return target?.rollout.firmwareId
      ? { firmwareId: target.rollout.firmwareId }
      : null;
  }

  async confirmFirmwareInstall(
    deviceId: string,
    dto: ConfirmFirmwareInstallDto,
    actor: ActingUser,
  ): Promise<ConfirmFirmwareInstallResult> {
    const device = await this.findByDeviceId(deviceId);

    if (device.status !== TESTABLE_DEVICE_STATUS) {
      throw new ConflictException(
        `Device สถานะปัจจุบัน (${device.status}) ยังยืนยันติดตั้ง Firmware ไม่ได้ — ต้องเป็น ${TESTABLE_DEVICE_STATUS} (ติดตั้งจริงแล้ว) เท่านั้น`,
      );
    }

    const firmware = await this.prisma.firmware.findUnique({
      where: { id: dto.firmwareId },
    });
    if (!firmware) {
      throw new NotFoundException(`ไม่พบ Firmware id ${dto.firmwareId}`);
    }
    this.assertFirmwareInstallable(firmware, device);

    // Firmware Override (Sprint 3 แถวที่ 24) — ถ้าอุปกรณ์มี Campaign Rollout
    // (Firmware) ที่ active กำหนด firmware ตัวอื่นไว้อยู่ ต้องมี
    // DeviceFirmwareOverride ที่ approved **และยังไม่เคยถูกใช้** (`consumedAt:
    // null`) ตรงกับ firmware ตัวนี้ก่อนถึงจะ confirm ได้ — ถ้าไม่มี assignment
    // เลย (ติดตั้งเดี่ยวๆ ไม่ผ่าน Campaign) หรือ firmware ตรงกับ assignment
    // อยู่แล้ว ผ่านปกติไม่ต้องขอ override (ดู comment เหนือ
    // `findActiveFirmwareAssignment()` สำหรับเหตุผลเต็มๆ)
    //
    // **single-use (แก้ตามรีวิว B บน PR #257 ข้อ 1):** เดิม override ที่
    // approved แล้วไม่เคย "ใช้แล้วหมด" เลย ทำให้ใช้ข้ามแผน Campaign ใหม่ได้ไม่
    // รู้จบ — mark `consumedAt` ในทรานแซกชันเดียวกับการเขียน AuditLog ด้านล่าง
    // (`updateMany` guard ด้วย `consumedAt: null` เดิม กัน race สองคำขอ confirm
    // พร้อมกันใช้ override เดียวกันซ้ำ — ปิด TOCTOU ที่ B ชี้ไว้ไปในตัว) —
    // ติดตั้ง firmware เดิมซ้ำอีกครั้ง (เช่น reset เครื่อง) ต้องขอ override ใหม่
    const assignment = await this.findActiveFirmwareAssignment(device.deviceId);
    let overrideToConsumeId: string | null = null;
    if (assignment && assignment.firmwareId !== firmware.id) {
      const approvedOverride =
        await this.prisma.deviceFirmwareOverride.findFirst({
          where: {
            deviceId: device.deviceId,
            firmwareId: firmware.id,
            status: 'approved',
            consumedAt: null,
          },
        });
      if (!approvedOverride) {
        throw new ConflictException(
          `Firmware นี้ไม่ตรงกับแผนที่ Campaign กำหนดไว้ (${assignment.firmwareId}) — ต้องขอ Firmware Override ก่อน (หรือ override เดิมถูกใช้ไปแล้ว)`,
        );
      }
      overrideToConsumeId = approvedOverride.id;
    }

    const confirmedAt = new Date();
    const metadata: AuditLogMetadata = {
      deviceId: device.deviceId,
      firmwareId: firmware.id,
      firmwareVersion: firmware.version,
    };
    await this.prisma.$transaction(async (tx) => {
      if (overrideToConsumeId) {
        const result = await tx.deviceFirmwareOverride.updateMany({
          where: {
            id: overrideToConsumeId,
            status: 'approved',
            consumedAt: null,
          },
          data: { consumedAt: confirmedAt },
        });
        if (result.count === 0) {
          throw new ConflictException(
            'คำขอ Override นี้ถูกใช้ไปแล้วโดยการยืนยันติดตั้งอื่นที่เกิดขึ้นพร้อมกัน — กรุณาขอ Firmware Override ใหม่',
          );
        }
      }
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          auditModule: AUDIT_MODULE,
          action: 'confirm-firmware-install',
          metadata: metadata as Prisma.InputJsonValue,
        },
      });
    });

    // Campaign Monitor (#22, แก้ไข 2026-09-24) — ช่างยืนยันติดตั้งสำเร็จ = success
    // เสมอ (endpoint นี้เป็นแค่ attestation ไม่มีทาง fail อยู่แล้ว — ดู comment
    // หัวเมธอดนี้) never-throw อยู่แล้วในตัว recordTargetResult เอง จึงไม่กระทบ
    // ความหมาย "audit เขียนไม่สำเร็จต้อง throw 500" ข้างบน (เกิดขึ้นก่อนหน้านี้
    // ไปแล้ว)
    await this.campaignRolloutService.recordTargetResult(
      device.deviceId,
      { firmwareId: firmware.id },
      true,
      `ยืนยันติดตั้ง Firmware ${firmware.version} สำเร็จ (confirm-firmware-install)`,
    );

    // Dual Partition (mock, Incident & Rollback #28, แก้ไข 2026-09-24) —
    // เขียน Firmware ที่เพิ่งยืนยันลงพาร์ทิชันที่ **ไม่ active** แล้วสลับไปหา
    // (จำลอง "ดาวน์โหลด+ตรวจสอบที่พาร์ทิชันสำรองก่อน แล้วค่อยสลับ") ทำแบบ
    // เดียวกันทั้งติดตั้งปกติและ Rollback (ฝั่งกล่องไม่รู้ความต่าง — ยืนยันว่า
    // "Firmware X รันอยู่ตอนนี้" ก็พอ) — ทำให้พาร์ทิชันที่ไม่ active เก็บ
    // Firmware ตัวก่อนหน้าไว้เสมอ พร้อมใช้ตอน Rollback ครั้งถัดไป · ไม่ผ่าน
    // `FirmwareRollbackExecutor` (อยู่คนละโมดูล กัน circular dependency กับ
    // campaign — ดู comment เหนือ `firmware-rollback-executor.ts`) แค่บันทึก
    // สิ่งที่ attestation ยืนยันไปแล้วเฉยๆ ไม่มีทาง fail ต่างจาก Rollback ที่
    // ต้องเช็คว่าของเก่ายังอยู่ไหม
    try {
      const nextPartition = device.activePartition === 'A' ? 'B' : 'A';
      await this.prisma.device.update({
        where: { deviceId: device.deviceId },
        data: {
          activePartition: nextPartition,
          ...(nextPartition === 'A'
            ? { partitionAFirmwareId: firmware.id }
            : { partitionBFirmwareId: firmware.id }),
        },
      });
    } catch (err) {
      this.logger.warn(
        `อัปเดต Dual Partition ไม่สำเร็จ (deviceId ${device.deviceId}): ${(err as Error).message}`,
      );
    }

    return {
      deviceId: device.deviceId,
      firmwareId: firmware.id,
      confirmedAt: confirmedAt.toISOString(),
    };
  }

  /**
   * เช็คว่า Config ที่อนุมัติแล้ว "พร้อมอัพโหลดเข้าอุปกรณ์เครื่องนี้" ไหม —
   * dry-run ก่อน `applyConfig` จริง สำหรับช่างหน้างาน (ST/OT ผ่าน Mobile)
   * **ไม่ persist / ไม่แตะ state ใดๆ** ทั้ง Device และ Config
   *
   * รวม 3 ส่วนเป็นผลเดียว:
   * 1. `configCheck` — ตัว Config เองพร้อมไหม (reuse `DeviceSimulator` ตัวเดียว
   *    กับ `POST /config/{id}/simulate`)
   * 2. `compatibilityCheck` — deviceModel/protocol ของ Config ตรงกับอุปกรณ์ไหม
   * 3. `connectionCheck` — สัญญาณกล่องเครื่องนั้น (reuse `DeviceConnectionTester`
   *    ตัวเดียวกับ `POST /devices/{id}/test-connection`)
   *
   * เงื่อนไข 4xx (mirror `applyConfig` เฉพาะส่วนที่เช็คไม่ได้เลย):
   * - ไม่พบ Device / Config → 404
   * - Device ยังไม่ `installed` → 409
   * - Config ยังไม่ `approved`/`synced` → 409
   *
   * **ต่างจาก `applyConfig`:** deviceModel/protocol mismatch **ไม่ใช่ 409** —
   * endpoint นี้เป็น readiness check จึง report เป็น `compatibilityCheck.passed:
   * false` ใน 200 ให้ช่างเห็นว่าอะไรไม่ตรง (ดู PR description — รอ B ยืนยัน)
   */
  async simulateConfig(
    deviceId: string,
    configId: string,
  ): Promise<DeviceSimulateConfigResult> {
    const device = await this.findByDeviceId(deviceId);

    if (device.status !== TESTABLE_DEVICE_STATUS) {
      throw new ConflictException(
        `Device สถานะปัจจุบัน (${device.status}) ยังเช็คความพร้อมไม่ได้ — ต้องเป็น ${TESTABLE_DEVICE_STATUS} (ติดตั้งจริงแล้ว) เท่านั้น`,
      );
    }

    const config = await this.prisma.config.findUnique({
      where: { id: configId },
    });
    // soft-deleted Config ถือว่า "ไม่พบ" เช่นกัน — mirror `applyConfig()`/
    // `getBaseConfigForDevice()` (issue #226)
    if (!config || config.deletedAt !== null) {
      throw new NotFoundException(`ไม่พบ Config id ${configId}`);
    }
    if (!APPLICABLE_CONFIG_STATUSES.includes(config.status)) {
      throw new ConflictException(
        `Config สถานะปัจจุบัน (${config.status}) ยังเช็คความพร้อมเพื่ออัพโหลดหน้างานไม่ได้ — ต้องผ่านการอนุมัติ (${APPLICABLE_CONFIG_STATUSES.join('/')}) ก่อน`,
      );
    }

    const compatible =
      config.deviceModel === device.deviceModel &&
      config.protocol === device.protocol;
    const compatibilityCheck: CompatibilityCheckResult = compatible
      ? {
          passed: true,
          details: [
            `Config (${config.deviceModel}/${config.protocol}) ตรงกับอุปกรณ์ ${device.deviceId}`,
          ],
        }
      : {
          passed: false,
          details: [
            `Config นี้เป็นของ ${config.deviceModel}/${config.protocol} ไม่ตรงกับอุปกรณ์ ${device.deviceModel}/${device.protocol}`,
          ],
        };

    // Per-device Config Override (issue #223/#226) — dry-run readiness check
    // ต้องตรวจค่าที่ override แล้ว ไม่ใช่ base Config เดิม
    const { fields } = await mergeApprovedOverride(
      this.prisma,
      device.deviceId,
      config.id,
      config.fields,
    );

    // configCheck + connectionCheck รันเสมอ แม้ compatibilityCheck ไม่ผ่าน —
    // ช่างจะได้เห็นภาพรวมครบในครั้งเดียว (configCheck ตรวจตัว Config เอง,
    // connectionCheck ตรวจสัญญาณกล่อง ทั้งคู่ไม่ขึ้นกับผล compat)
    const [configCheck, connectionCheck] = await Promise.all([
      this.deviceSimulator.simulateConfig({
        deviceModel: config.deviceModel,
        protocol: config.protocol,
        fields,
      }),
      this.connectionTester.testConnection({
        deviceId: device.deviceId,
        deviceModel: device.deviceModel,
        protocol: device.protocol,
      }),
    ]);

    return {
      passed:
        configCheck.passed &&
        compatibilityCheck.passed &&
        connectionCheck.passed,
      configCheck,
      compatibilityCheck,
      connectionCheck,
    };
  }

  /**
   * Config ปัจจุบันของอุปกรณ์ — Config Override Phase 2 (Mobile, issue #211)
   * ต้องรู้ค่านี้ก่อนเปิดหน้า Override ให้ ST แก้ค่าราย field ได้ **ไม่มี FK
   * ตรงจาก Device ไปหา Config เลย** (เหมือนที่ comment เหนือ
   * `GET /devices/:deviceId/status` อธิบายไว้) — derive จาก `Task.configId`
   * ของ Task ล่าสุด (`updatedAt` มากสุด) ที่ `status: 'completed'` และผูกกับ
   * อุปกรณ์เครื่องนี้แทน (Task ประเภทติดตั้ง/เปลี่ยน Config ผูก `configId` ไว้
   * ตั้งแต่สร้าง Task — ดู comment เหนือ `Task.configId` ใน schema.prisma)
   *
   * `Task.deviceId` เทียบตรงกับ `Device.deviceId` (เลขเครื่องจริง) ไม่ใช่
   * `Device.id` — ตรงกับ convention ที่ยืนยันไว้ใน `create-campaign.dto.ts`
   * ว่า `Task.deviceId` เก็บเป็นเลขเครื่องจริงเสมอ (mirror ทุก endpoint อื่นที่
   * อ้างอุปกรณ์) ต่างจาก mobile client ที่ต้อง normalize สอง format เพราะมี
   * seed/migration data เก่าที่หลุด convention นี้ไป — backend ฝั่งนี้ยึดตาม
   * convention ปัจจุบันตรงๆ ไม่ normalize ย้อนกลับให้
   *
   * **ข้อจำกัดของ "Task ล่าสุด" (comment A บน PR #222):** ใช้ `updatedAt`
   * (ไม่ใช่ `completedAt` — ยังไม่มี field นี้ใน schema) ซึ่งขยับทุกครั้งที่มี
   * การ `PATCH` ใดๆ กับ Task นั้น ไม่ใช่แค่ตอนเปลี่ยนเป็น `completed` — ถ้า Task
   * ที่ completed ไปแล้วถูกแก้ field อื่น (เช่น `description`) ทีหลัง จะกลาย
   * เป็น "ล่าสุด" แทน Task ที่ติดตั้งจริงทีหลังกว่าได้ ยอมรับ trade-off นี้ไปก่อน
   * จนกว่าจะมี `completedAt` แยก
   */
  private async getBaseConfigForDevice(deviceId: string): Promise<Config> {
    const task = await this.prisma.task.findFirst({
      where: { deviceId, status: 'completed', configId: { not: null } },
      orderBy: { updatedAt: 'desc' },
    });
    const config = task?.configId
      ? await this.prisma.config.findUnique({ where: { id: task.configId } })
      : null;
    // soft-deleted Config (docs/11 Part A) ถือว่า "ไม่พบ" เช่นกัน — mirror
    // `ConfigService.findOne()` เป๊ะๆ (comment A บน PR #222: ไม่งั้น endpoint
    // นี้จะคืน 200 ให้ Config ที่ถูกลบไปแล้ว แล้วไปเจอ 404 ตอน overrideConfig แทน)
    if (!config || config.deletedAt !== null) {
      throw new NotFoundException(
        'อุปกรณ์นี้ยังไม่มี Config ที่ยืนยันติดตั้งแล้ว',
      );
    }
    return config;
  }

  async getCurrentConfig(deviceId: string): Promise<ConfigWithDeviceOverride> {
    await this.findByDeviceId(deviceId);
    const baseConfig = await this.getBaseConfigForDevice(deviceId);

    // Per-device Config Override (issue #223, มติ 2026-09-24) — merge เฉพาะ
    // แถว status: approved ของ Config **ตัวเดียวกับ base** เท่านั้น (bug fix
    // — comment A บน PR #225: เดิมกรองแค่ deviceId ไม่กรอง configId ถ้า
    // เครื่องนี้ถูก Confirm Install เป็น Config ใหม่ทีหลัง override ที่ทำไว้
    // กับ Config เก่าจะยังถูก merge ทับ Config ใหม่อยู่ — ถ้า Config ใหม่เป็น
    // คนละ deviceModel/protocol ก็จะได้ field ที่ไม่ผ่าน validate ของรุ่นใหม่
    // ติดมาด้วย) แถวล่าสุด (`versionNumber` มากสุด) เก็บสถานะ override สะสม
    // อยู่แล้ว (ดู `overrideDeviceConfig()`) จึง merge แถวเดียวนี้พอ ไม่ต้อง
    // ไล่รวมทุก version ย้อนหลังเอง — pending/rejected ไม่มีผลกับค่าที่คืนกลับ
    // เลย (ต้องผ่าน Operation อนุมัติก่อนถึงมีผล)
    //
    // `pendingOverride` กรองด้วย `configId: baseConfig.id` เช่นเดียวกับ
    // `latestApproved` (bug fix — comment A บน PR #234): เดิมกรองแค่ deviceId
    // เฉยๆ ถ้าเครื่องมีคำขอ pending เก่าที่ผูกกับ configId ที่ไม่ใช่ปัจจุบัน
    // อีกแล้ว (Config เปลี่ยนไปเพราะมี Confirm Install ใหม่ทับระหว่างที่คำขอ
    // เก่ายังรออยู่) Mobile จะขึ้น banner "มีคำขอรออนุมัติ" ทั้งที่คำขอนั้น
    // approve ไม่ได้แล้ว (ดู `approveDeviceConfigOverride()` ที่เช็ค configId
    // staleness) ทำให้ ST เข้าใจผิดว่าต้องรอ ทั้งที่ส่งคำขอใหม่กับ Config
    // ปัจจุบันได้เลย — คำขอเก่ายังอยู่ในคิว `GET /device-config-overrides` ให้
    // Operation reject ทิ้งได้ตามเดิม ไม่ได้หายไปไหน
    //
    // **เครื่องหนึ่งมี pending พร้อมกันได้มากกว่า 1 รายการในทางทฤษฎี ถ้าต่าง
    // configId กัน** (`overrideDeviceConfig()` scope เช็ค existing-pending
    // ด้วย configId ปัจจุบัน, issue #226 ข้อ 3) — `orderBy versionNumber desc`
    // ร่วมกับ filter configId นี้ทำให้ได้แถว pending ล่าสุดของ Config ปัจจุบัน
    // เท่านั้นเสมอ
    const [{ fields, approvedOverride }, pendingOverride] = await Promise.all([
      mergeApprovedOverride(
        this.prisma,
        deviceId,
        baseConfig.id,
        baseConfig.fields,
      ),
      this.prisma.deviceConfigOverride.findFirst({
        where: { deviceId, configId: baseConfig.id, status: 'pending' },
        orderBy: { versionNumber: 'desc' },
      }),
    ]);

    if (!approvedOverride) {
      return { ...baseConfig, hasDeviceOverride: false, pendingOverride };
    }

    return {
      ...baseConfig,
      fields: fields as Prisma.JsonValue,
      hasDeviceOverride: true,
      pendingOverride,
    };
  }

  /**
   * Per-device Config Override (issue #223) — ST **ส่งคำขอ** แก้ค่าบาง field
   * ของ Config ปัจจุบันของ**อุปกรณ์เครื่องนี้เครื่องเดียว** ไม่กระทบอุปกรณ์อื่น
   * ที่ใช้ Config เดียวกัน (ต่างจาก `POST /config/{configId}/override` เดิม,
   * issue #185, ที่แก้ `Config.fields` ทั้งชุด — ดู comment เหนือ
   * `model DeviceConfigOverride` ใน schema.prisma อธิบายที่มา/เหตุผลเต็มๆ)
   * `POST /config/{configId}/override` เดิมจะถูก A deprecate แยก PR หลัง PR
   * #225 merge (มติบันทึกใน issue #223)
   *
   * **มติ 2026-09-24 (request changes บน PR #225 โดย A):** สร้างแถวสถานะ
   * `pending` เท่านั้น — **ไม่มีผลกับ `getCurrentConfig()` ทันที** ต้องรอ
   * Operation อนุมัติผ่าน `approveDeviceConfigOverride()` ก่อน (Separation of
   * Duty เดิม) แล้วช่างต้องกด `apply-config` เข้าเครื่องเองอีกครั้ง —
   * `applyConfig()`/`simulateConfig()` merge ค่า override ที่ approved แล้ว
   * จริงตั้งแต่แก้ไข issue #226 (เดิมยังไม่ทำใน PR #225 นี้)
   *
   * base Config มาจาก `getBaseConfigForDevice()` เดียวกับ `getCurrentConfig()`
   * เป๊ะ — ไม่พบ (อุปกรณ์ยังไม่เคย Confirm Install หรือ Config ถูกลบไปแล้ว) →
   * 404 ข้อความเดียวกัน
   *
   * **เครื่องหนึ่งมีคำขอ `pending` พร้อมกันได้แค่ 1 รายการ ต่อ configId
   * เดียวกัน** (เสนอโดย A — กันการจัดการคำขอซ้อนกัน) → 409 ถ้ามีอยู่แล้ว
   * เช็คในทรานแซกชันเดียวกับ create เสมอ (ไม่เช็คแยกนอก transaction) กัน ST
   * 2 คนส่งพร้อมกันผ่านทั้งคู่ — **scope ด้วย configId ปัจจุบันด้วย (แก้ไข
   * 2026-09-25, issue #226 ข้อ 3):** เดิมเช็คแค่ deviceId เฉยๆ ทำให้คำขอเก่าที่
   * ตายไปแล้ว (Config ของเครื่องเปลี่ยนไปแล้วตั้งแต่ส่งคำขอ — approve ไม่ได้
   * อีกต่อไป) ยังบล็อกคำขอใหม่ไม่ให้ส่งได้จนกว่า Operation จะ reject ทิ้งก่อน
   *
   * **`fields` ที่เขียนลง DB เป็นสถานะ override สะสม ไม่ใช่แค่ `dto.fields`
   * ดิบๆ** — merge `dto.fields` (partial ที่ ST ส่งมารอบนี้) ทับ fields ของแถว
   * **`approved`** ล่าสุดของ Config เดียวกัน (ถ้ามี) ก่อนเขียนแถวใหม่ mirror
   * `ConfigOverrideService.override()` เดิมที่ merge ทับ `Config.fields` เต็ม
   * ก้อนก่อนสร้าง `ConfigVersion` ใหม่ทุกครั้ง — **เหตุผลที่ทำแบบนี้แทนที่จะ
   * เก็บแค่ delta ของรอบนี้ดิบๆ**: `getCurrentConfig()` merge แค่แถว approved
   * ล่าสุดแถวเดียวทับ base (ไม่ไล่รวมทุก version) ถ้าเก็บแค่ delta ดิบๆ การ
   * override field ใหม่ในรอบถัดไปจะ "ลบ" ผล override ของ field อื่นจากรอบก่อน
   * หน้าไปเงียบๆ โดยไม่ตั้งใจ — **กรอง `configId: baseConfig.id` ด้วยเสมอ**
   * (bug fix เดียวกับ `getCurrentConfig()` — comment A บน PR #225: ไม่งั้น
   * field ที่เคย override ไว้กับ Config เก่า (ก่อน Confirm Install ใหม่) จะติด
   * มากับแถวใหม่ที่อ้าง Config คนละตัว)
   *
   * **`versionNumber` อ่านในทรานแซกชันเดียวกับ `create` เสมอ** (แก้ race
   * condition ที่ A ชี้ไว้บน PR #225: เดิมอ่านนอก transaction ทำให้ ST 2 คน
   * ส่งพร้อมกันกับเครื่องเดียวกันอาจได้ `versionNumber` ซ้ำ ชน
   * `@@unique([deviceId, versionNumber])` แล้วได้ Prisma P2002 → 500 แทนที่จะ
   * เป็น error ที่สื่อความหมาย — mirror `ConfigOverrideService` ที่ `count`
   * ในทรานแซกชันเดียวกับ `create` เช่นกัน) นับจาก**ทุกสถานะ** ไม่ใช่แค่
   * approved กัน versionNumber ชนกับแถวที่เคยถูก reject ไปแล้ว · เพิ่ม
   * catch P2002 → 409 เป็น backstop เผื่อหลุดผ่านมาได้จริงภายใต้
   * concurrent load สูงมากๆ (isolation level ปกติของ Postgres ไม่ใช่
   * SERIALIZABLE ก็ยังมี race ทางทฤษฎีเหลืออยู่เล็กน้อย)
   *
   * validate เฉพาะ `dto.fields` ที่ส่งมารอบนี้ (ไม่ validate ซ้ำ field เดิมจาก
   * version ก่อนหน้าที่ผ่านการ validate ไปแล้วตอนนั้น) reuse
   * `ConfigDefinitionService.validateOverridableFields()` ตัวเดียวกับ
   * `config-override` เดิมเป๊ะๆ ไม่เขียนตรรกะซ้ำ
   */
  async overrideDeviceConfig(
    deviceId: string,
    dto: DeviceConfigOverrideDto,
    actor: ActingUser,
  ): Promise<DeviceConfigOverride> {
    await this.findByDeviceId(deviceId);
    const baseConfig = await this.getBaseConfigForDevice(deviceId);

    await this.configDefinitionService.validateOverridableFields(
      baseConfig.deviceModel,
      baseConfig.protocol,
      dto.fields,
    );

    try {
      const override = await this.prisma.$transaction(async (tx) => {
        // scope ด้วย configId ปัจจุบันของอุปกรณ์ด้วย (มติ 2026-09-25, issue
        // #226 ข้อ 3) — เดิมเช็คแค่ deviceId เฉยๆ ถ้าเครื่องถูก Confirm
        // Install เป็น Config ใหม่ทับระหว่างที่คำขอเก่ายังรอ Operation
        // ตัดสินใจอยู่ (คำขอนั้น approve ไม่ได้แล้วเพราะ configId ไม่ตรงกับ
        // baseConfig ปัจจุบัน — ดู `approveDeviceConfigOverride()`) คำขอเก่า
        // ที่ตายไปแล้วในทางปฏิบัตินี้จะยังนับเป็น "pending 1 รายการ" บล็อก ST
        // ส่งคำขอใหม่กับ Config ใหม่ไม่ได้ จนกว่า Operation จะกด reject ทิ้ง
        // ก่อน — แก้โดยกรอง configId ปัจจุบันด้วย ปล่อยให้คำขอเก่า configId
        // อื่นค้างเป็นประวัติเฉยๆ ไม่บล็อกคำขอใหม่ (Operation ยังเห็นและ
        // reject ได้ตามปกติผ่าน `GET /device-config-overrides?status=pending`)
        const existingPending = await tx.deviceConfigOverride.findFirst({
          where: { deviceId, configId: baseConfig.id, status: 'pending' },
        });
        if (existingPending) {
          throw new ConflictException(
            'อุปกรณ์นี้มีคำขอ override ที่รอ Operation อนุมัติอยู่แล้ว — รอผลก่อนส่งคำขอใหม่',
          );
        }

        const previousApproved = await tx.deviceConfigOverride.findFirst({
          where: { deviceId, configId: baseConfig.id, status: 'approved' },
          orderBy: { versionNumber: 'desc' },
        });
        const accumulatedFields = {
          ...((previousApproved?.fields as Record<string, unknown>) ?? {}),
          ...dto.fields,
        };

        const latestVersion = await tx.deviceConfigOverride.findFirst({
          where: { deviceId },
          orderBy: { versionNumber: 'desc' },
        });

        const override = await tx.deviceConfigOverride.create({
          data: {
            deviceId,
            configId: baseConfig.id,
            versionNumber: (latestVersion?.versionNumber ?? 0) + 1,
            fields: accumulatedFields as Prisma.InputJsonValue,
            reason: dto.reason,
            overriddenBy: actor.id,
            status: 'pending',
          },
        });

        // Audit Log บังคับทุกครั้งแบบไม่มีข้อยกเว้น (RBAC_Matrix.md กฎข้อ 3)
        // mirror `ConfigOverrideService.override()` — เขียนในทรานแซกชันเดียวกับ
        // การเปลี่ยนข้อมูลจริง ไม่ใช่ never-throw
        const metadata: AuditLogMetadata = {
          deviceId,
          configId: baseConfig.id,
          fieldNames: Object.keys(dto.fields),
        };
        await tx.auditLog.create({
          data: {
            userId: actor.id,
            auditModule: AUDIT_MODULE,
            action: 'device-config-override-request',
            metadata: metadata as Prisma.InputJsonValue,
          },
        });

        return override;
      });

      // แจ้ง Operation ว่ามีคำขอ pending ใหม่ (issue #226) — never-throw,
      // เรียกหลังทรานแซกชันสำเร็จแล้วเท่านั้น ไม่ใช่ core contract ของ
      // endpoint นี้ (ดู `notifyOperationOfPendingOverride()`)
      await this.notifyOperationOfPendingOverride(override);

      return override;
    } catch (err) {
      if (
        err instanceof PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'ส่งคำขอ override ไม่สำเร็จเพราะมีคำขออื่นเข้ามาพร้อมกัน — กรุณาลองใหม่อีกครั้ง',
        );
      }
      throw err;
    }
  }

  /** หาแถว `DeviceConfigOverride` ที่ยัง `pending` — ใช้ร่วมกันโดย
   * `approveDeviceConfigOverride()`/`rejectDeviceConfigOverride()` — ไม่พบ →
   * 404, ตัดสินใจไปแล้ว (approved/rejected) → 409 กันตัดสินใจซ้ำ */
  private async getPendingOverrideOrThrow(
    id: string,
  ): Promise<DeviceConfigOverride> {
    const existing = await this.prisma.deviceConfigOverride.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`ไม่พบคำขอ override id ${id}`);
    }
    if (existing.status !== 'pending') {
      throw new ConflictException(
        `คำขอนี้ถูกตัดสินใจไปแล้ว (สถานะปัจจุบัน: ${existing.status})`,
      );
    }
    return existing;
  }

  /** แจ้ง Operation ทุกคนที่ active ว่ามีคำขอ override ใหม่รอตัดสินใจ (issue
   * #226) — mirror pattern เดียวกับ `ConfigDeletionService.notifySuperAdmins()`
   * **never-throw** — เป็นแค่ side-effect ติดตาม ไม่ใช่ core contract ของ
   * `overrideDeviceConfig()` เอง (ผู้ใช้ต้องเห็นว่าส่งคำขอสำเร็จแม้แจ้งเตือน
   * ล้มเหลว) */
  private async notifyOperationOfPendingOverride(
    override: DeviceConfigOverride,
  ): Promise<void> {
    try {
      const operations = await this.prisma.user.findMany({
        where: { role: { code: 'Operation' }, isActive: true },
        select: { id: true },
      });
      for (const operation of operations) {
        await this.notificationService.send({
          userId: operation.id,
          type: 'config_override_pending',
          payload: {
            overrideId: override.id,
            deviceId: override.deviceId,
            configId: override.configId,
          },
        });
      }
    } catch (err) {
      this.logger.warn(
        `แจ้งเตือน config_override_pending ไม่สำเร็จ (override ${override.id}): ${(err as Error).message}`,
      );
    }
  }

  /** แจ้ง ST ผู้ส่งคำขอ (`overriddenBy`) ว่า Operation ตัดสินใจแล้ว
   * (approve/reject) — issue #226 · **never-throw** เดียวกับด้านบน */
  private async notifyRequesterOfDecision(
    override: DeviceConfigOverride,
    outcome: 'approved' | 'rejected',
  ): Promise<void> {
    try {
      await this.notificationService.send({
        userId: override.overriddenBy,
        type:
          outcome === 'approved'
            ? 'config_override_approved'
            : 'config_override_rejected',
        payload: {
          overrideId: override.id,
          deviceId: override.deviceId,
          configId: override.configId,
          ...(outcome === 'rejected'
            ? { rejectReason: override.rejectReason }
            : {}),
        },
      });
    } catch (err) {
      this.logger.warn(
        `แจ้งเตือน config_override_${outcome} ไม่สำเร็จ (override ${override.id}): ${(err as Error).message}`,
      );
    }
  }

  /**
   * Operation อนุมัติคำขอ override (issue #223, มติ 2026-09-24) — เปลี่ยน
   * สถานะเป็น `approved` เท่านั้น **ไม่ apply เข้าอุปกรณ์ให้อัตโนมัติ** ช่าง
   * ต้องกด `apply-config` เข้าเครื่องเองอีกครั้งหลังจากนี้ (`applyConfig()`
   * merge ค่า override ที่ approved แล้วจริงตั้งแต่แก้ไข issue #226)
   * resource `device-config-override` action `Approve` — Operation เท่านั้น
   *
   * **เช็ค `configId` ยังตรงกับ Config ปัจจุบันของอุปกรณ์ไหม (comment A รอบ 2
   * บน PR #225):** ถ้าเครื่องถูก Confirm Install เป็น Config ใหม่ทับระหว่างที่
   * คำขอนี้รออนุมัติอยู่ `getCurrentConfig()` จะกรองด้วย configId ปัจจุบันอยู่
   * แล้วอนุมัติคำขอเก่าไปก็ไม่มีผลอะไรเลย (Operation จะเข้าใจผิดว่ามีผล) — กัน
   * ด้วย 409 ก่อนเปลี่ยนสถานะ
   *
   * **race condition (comment A รอบ 2):** เดิมอ่านสถานะนอก transaction แล้ว
   * `update()` แบบไม่เช็คซ้ำ — Operation 2 คนกดพร้อมกัน (หรือคนหนึ่ง approve
   * อีกคน reject) จะผ่านทั้งคู่ได้ แก้ด้วย `updateMany({ where: { id, status:
   * 'pending' } })` ในทรานแซกชันเดียวกัน (mirror IDOR pattern ใน CLAUDE.md)
   * `count === 0` แปลว่ามีคนอื่นตัดสินใจคำขอนี้ไปแล้วระหว่างที่เรารออยู่ → 409
   * — `getPendingOverrideOrThrow()` ยังคงไว้เป็น fast-path ให้ error message
   * ชัดเจน (404 ไม่พบ / 409 ตัดสินใจไปแล้วตอนเรียก) ส่วน `updateMany` เป็น
   * backstop กันช่องว่างระหว่าง fast-path กับตอน commit จริง
   */
  async approveDeviceConfigOverride(
    id: string,
    actor: ActingUser,
  ): Promise<DeviceConfigOverride> {
    const existing = await this.getPendingOverrideOrThrow(id);

    const baseConfig = await this.getBaseConfigForDevice(existing.deviceId);
    if (baseConfig.id !== existing.configId) {
      throw new ConflictException(
        'Config ของอุปกรณ์นี้เปลี่ยนไปแล้วตั้งแต่ส่งคำขอ (มี Confirm Install ใหม่ทับ) — อนุมัติคำขอนี้ไม่มีผลอะไรแล้ว',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.deviceConfigOverride.updateMany({
        where: { id, status: 'pending' },
        data: {
          status: 'approved',
          decidedBy: actor.id,
          decidedAt: new Date(),
        },
      });
      if (result.count === 0) {
        throw new ConflictException(
          'คำขอนี้ถูกตัดสินใจไปแล้ว (มีคำขออนุมัติ/ปฏิเสธอื่นเข้ามาพร้อมกัน) — กรุณาโหลดข้อมูลใหม่',
        );
      }
      const row = await tx.deviceConfigOverride.findUniqueOrThrow({
        where: { id },
      });
      const metadata: AuditLogMetadata = {
        deviceId: existing.deviceId,
        configId: existing.configId,
      };
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          auditModule: AUDIT_MODULE,
          action: 'device-config-override-approve',
          metadata: metadata as Prisma.InputJsonValue,
        },
      });
      return row;
    });

    // แจ้ง ST ผู้ส่งคำขอว่า Operation อนุมัติแล้ว (issue #226) — never-throw
    await this.notifyRequesterOfDecision(updated, 'approved');

    return updated;
  }

  /** Operation ปฏิเสธคำขอ override — `rejectReason` ไม่บังคับ (Operation
   * อาจไม่ระบุก็ได้) resource เดียวกับ approve (action `Approve`) mirror
   * `config-deletion` (`rejectConfigDeletionRequest` ใช้ action `Approve`
   * เดียวกับ approve — "สิทธิ์ตัดสินใจ" ไม่ได้แยกตามผลตัดสินใจ)
   *
   * **race condition (comment A รอบ 2 บน PR #225):** เดียวกับ
   * `approveDeviceConfigOverride()` — ใช้ `updateMany` ในทรานแซกชันแทน
   * `update()` เปล่าๆ กันคนละคนกดตัดสินใจคำขอเดียวกันพร้อมกัน — **ไม่เช็ค
   * configId staleness เหมือน approve** เพราะ reject คำขอที่ configId เก่าไป
   * แล้วไม่มีผลเสียอะไร (แค่ทำเครื่องหมายว่าปฏิเสธ ไม่ได้ apply อะไรเข้าระบบ)
   */
  async rejectDeviceConfigOverride(
    id: string,
    dto: RejectDeviceConfigOverrideDto,
    actor: ActingUser,
  ): Promise<DeviceConfigOverride> {
    const existing = await this.getPendingOverrideOrThrow(id);

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.deviceConfigOverride.updateMany({
        where: { id, status: 'pending' },
        data: {
          status: 'rejected',
          decidedBy: actor.id,
          decidedAt: new Date(),
          rejectReason: dto.rejectReason ?? null,
        },
      });
      if (result.count === 0) {
        throw new ConflictException(
          'คำขอนี้ถูกตัดสินใจไปแล้ว (มีคำขออนุมัติ/ปฏิเสธอื่นเข้ามาพร้อมกัน) — กรุณาโหลดข้อมูลใหม่',
        );
      }
      const row = await tx.deviceConfigOverride.findUniqueOrThrow({
        where: { id },
      });
      const metadata: AuditLogMetadata = {
        deviceId: existing.deviceId,
        configId: existing.configId,
      };
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          auditModule: AUDIT_MODULE,
          action: 'device-config-override-reject',
          metadata: metadata as Prisma.InputJsonValue,
        },
      });
      return row;
    });

    // แจ้ง ST ผู้ส่งคำขอว่า Operation ปฏิเสธแล้ว (issue #226) — never-throw
    await this.notifyRequesterOfDecision(updated, 'rejected');

    return updated;
  }

  /** Operation ดูรายการคำขอ override ทั้งหมด — filter ตาม `status` (optional,
   * ไม่ส่ง = ทุกสถานะ) เรียงคำขอใหม่ขึ้นก่อน (`overriddenAt` desc) ให้ดูคิว
   * `pending` ได้ง่าย */
  listDeviceConfigOverrides(
    status?: DeviceConfigOverrideStatus,
  ): Promise<DeviceConfigOverride[]> {
    return this.prisma.deviceConfigOverride.findMany({
      where: status ? { status } : undefined,
      orderBy: { overriddenAt: 'desc' },
    });
  }

  /**
   * ST ขอให้อุปกรณ์เครื่องนี้ติดตั้ง `dto.firmwareId` ได้ แม้จะไม่ตรงกับ
   * Campaign Rollout (Firmware) ที่ `active` กำหนดไว้ (Sprint 3 แถวที่ 24) —
   * mirror `overrideDeviceConfig()` เกือบทั้งหมด ต่างกันที่ไม่มี `fields`/
   * `configId` ให้ merge/denormalize เพราะ Firmware เป็นเวอร์ชันเดียวทั้งก้อน
   * ไม่ใช่ key-value (ดู comment เหนือ `model DeviceFirmwareOverride` ใน
   * schema.prisma) สร้างแถวสถานะ `pending` เท่านั้น — **ไม่มีผลทันที** ต้องรอ
   * Operation อนุมัติผ่าน `approveDeviceFirmwareOverride()` ก่อน (Separation
   * of Duty เดิม) ถึงจะใช้ `confirmFirmwareInstall()` กับ firmware นี้ได้จริง
   *
   * เช็ค firmware ด้วยเงื่อนไขเดียวกับ `confirmFirmwareInstall()`
   * (`assertFirmwareInstallable()`) — ไม่มีประโยชน์ที่จะอนุมัติ override เป็น
   * firmware ที่ยังติดตั้งไม่ได้อยู่ดี
   *
   * **เครื่องหนึ่งมีคำขอ `pending` พร้อมกันได้แค่ 1 รายการ** (mirror
   * `overrideDeviceConfig()`) scope แค่ `deviceId` พอ ไม่ต้อง scope ซ้อนด้วย
   * `firmwareId` เหมือน Config Override ที่ scope ด้วย `configId` เพิ่ม
   * เพราะ Config มี "configId เปลี่ยนแล้วทำให้คำขอเก่า stale" ได้ (base Config
   * เปลี่ยนได้จาก Confirm Install ใหม่) แต่ Firmware Override ไม่มี "base"
   * ให้เปลี่ยนแบบนั้นเลย — คำขอ pending ที่มีอยู่ไม่มีทาง stale ไปเอง
   *
   * `versionNumber` คำนวณในทรานแซกชันเดียวกับ `create` เสมอ (race-safe, mirror
   * `overrideDeviceConfig()`) นับจากทุกสถานะกัน versionNumber ชนกับแถวที่เคย
   * ถูก reject ไปแล้ว + catch P2002 → 409 เป็น backstop
   */
  async overrideDeviceFirmware(
    deviceId: string,
    dto: DeviceFirmwareOverrideDto,
    actor: ActingUser,
  ): Promise<DeviceFirmwareOverride> {
    const device = await this.findByDeviceId(deviceId);

    const firmware = await this.prisma.firmware.findUnique({
      where: { id: dto.firmwareId },
    });
    if (!firmware) {
      throw new NotFoundException(`ไม่พบ Firmware id ${dto.firmwareId}`);
    }
    this.assertFirmwareInstallable(firmware, device);

    try {
      const override = await this.prisma.$transaction(async (tx) => {
        const existingPending = await tx.deviceFirmwareOverride.findFirst({
          where: { deviceId: device.deviceId, status: 'pending' },
        });
        if (existingPending) {
          throw new ConflictException(
            'อุปกรณ์นี้มีคำขอ override ที่รอ Operation อนุมัติอยู่แล้ว — รอผลก่อนส่งคำขอใหม่',
          );
        }

        const latestVersion = await tx.deviceFirmwareOverride.findFirst({
          where: { deviceId: device.deviceId },
          orderBy: { versionNumber: 'desc' },
        });

        const override = await tx.deviceFirmwareOverride.create({
          data: {
            deviceId: device.deviceId,
            firmwareId: firmware.id,
            versionNumber: (latestVersion?.versionNumber ?? 0) + 1,
            reason: dto.reason,
            overriddenBy: actor.id,
            status: 'pending',
          },
        });

        const metadata: AuditLogMetadata = {
          deviceId: device.deviceId,
          firmwareId: firmware.id,
          firmwareVersion: firmware.version,
        };
        await tx.auditLog.create({
          data: {
            userId: actor.id,
            auditModule: AUDIT_MODULE,
            action: 'device-firmware-override-request',
            metadata: metadata as Prisma.InputJsonValue,
          },
        });

        return override;
      });

      await this.notifyOperationOfPendingFirmwareOverride(override);

      return override;
    } catch (err) {
      if (
        err instanceof PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'ส่งคำขอ override ไม่สำเร็จเพราะมีคำขออื่นเข้ามาพร้อมกัน — กรุณาลองใหม่อีกครั้ง',
        );
      }
      throw err;
    }
  }

  /** หาแถว `DeviceFirmwareOverride` ที่ยัง `pending` — ใช้ร่วมกันโดย
   * `approveDeviceFirmwareOverride()`/`rejectDeviceFirmwareOverride()` — ไม่พบ
   * → 404, ตัดสินใจไปแล้ว (approved/rejected) → 409 กันตัดสินใจซ้ำ mirror
   * `getPendingOverrideOrThrow()` ของ Config Override ทุกประการ */
  private async getPendingFirmwareOverrideOrThrow(
    id: string,
  ): Promise<DeviceFirmwareOverride> {
    const existing = await this.prisma.deviceFirmwareOverride.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`ไม่พบคำขอ override id ${id}`);
    }
    if (existing.status !== 'pending') {
      throw new ConflictException(
        `คำขอนี้ถูกตัดสินใจไปแล้ว (สถานะปัจจุบัน: ${existing.status})`,
      );
    }
    return existing;
  }

  /** แจ้ง Operation ทุกคนที่ active ว่ามีคำขอ Firmware Override ใหม่รอตัดสินใจ
   * — mirror `notifyOperationOfPendingOverride()` ของ Config Override
   * ทุกประการ **never-throw** เป็นแค่ side-effect ติดตาม ไม่ใช่ core contract
   * ของ `overrideDeviceFirmware()` เอง */
  private async notifyOperationOfPendingFirmwareOverride(
    override: DeviceFirmwareOverride,
  ): Promise<void> {
    try {
      const operations = await this.prisma.user.findMany({
        where: { role: { code: 'Operation' }, isActive: true },
        select: { id: true },
      });
      for (const operation of operations) {
        await this.notificationService.send({
          userId: operation.id,
          type: 'firmware_override_pending',
          payload: {
            overrideId: override.id,
            deviceId: override.deviceId,
            firmwareId: override.firmwareId,
          },
        });
      }
    } catch (err) {
      this.logger.warn(
        `แจ้งเตือน firmware_override_pending ไม่สำเร็จ (override ${override.id}): ${(err as Error).message}`,
      );
    }
  }

  /** แจ้ง ST ผู้ส่งคำขอ (`overriddenBy`) ว่า Operation ตัดสินใจแล้ว
   * (approve/reject) — mirror `notifyRequesterOfDecision()` ของ Config
   * Override ทุกประการ **never-throw** เดียวกัน */
  private async notifyRequesterOfFirmwareOverrideDecision(
    override: DeviceFirmwareOverride,
    outcome: 'approved' | 'rejected',
  ): Promise<void> {
    try {
      await this.notificationService.send({
        userId: override.overriddenBy,
        type:
          outcome === 'approved'
            ? 'firmware_override_approved'
            : 'firmware_override_rejected',
        payload: {
          overrideId: override.id,
          deviceId: override.deviceId,
          firmwareId: override.firmwareId,
          ...(outcome === 'rejected'
            ? { rejectReason: override.rejectReason }
            : {}),
        },
      });
    } catch (err) {
      this.logger.warn(
        `แจ้งเตือน firmware_override_${outcome} ไม่สำเร็จ (override ${override.id}): ${(err as Error).message}`,
      );
    }
  }

  /**
   * Operation อนุมัติคำขอ Firmware Override — เปลี่ยนสถานะเป็น `approved`
   * เท่านั้น **ไม่ apply เข้าอุปกรณ์ให้อัตโนมัติ** ปลดล็อกแค่สิทธิ์ให้
   * `confirmFirmwareInstall()` ยอมรับ firmware นี้กับอุปกรณ์เครื่องนี้ได้ (ดู
   * comment เหนือ `confirmFirmwareInstall()`) resource
   * `device-firmware-override` action `Approve` — Operation เท่านั้น
   *
   * **ไม่มีการเช็ค staleness เหมือน `approveDeviceConfigOverride()`** —
   * Config Override ต้องเช็คว่า `configId` ยังตรงกับ Config ปัจจุบันไหม เพราะ
   * base Config เปลี่ยนได้เองจาก Confirm Install ใหม่ แต่ Firmware Override
   * ไม่มี "base" ให้เปลี่ยนแบบนั้น — `firmwareId` ที่ ST เลือกตอนขอยังเป็นค่า
   * เดิมเสมอจนกว่าจะถูกตัดสินใจ ไม่มีอะไรทำให้คำขอนี้ล้าสมัยไปเอง
   *
   * race condition: ใช้ `updateMany({ where: { id, status: 'pending' } })`
   * ในทรานแซกชันเดียวกัน mirror `approveDeviceConfigOverride()` ทุกประการ
   * กัน Operation 2 คนตัดสินใจคำขอเดียวกันพร้อมกัน
   */
  async approveDeviceFirmwareOverride(
    id: string,
    actor: ActingUser,
  ): Promise<DeviceFirmwareOverride> {
    const existing = await this.getPendingFirmwareOverrideOrThrow(id);

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.deviceFirmwareOverride.updateMany({
        where: { id, status: 'pending' },
        data: {
          status: 'approved',
          decidedBy: actor.id,
          decidedAt: new Date(),
        },
      });
      if (result.count === 0) {
        throw new ConflictException(
          'คำขอนี้ถูกตัดสินใจไปแล้ว (มีคำขออนุมัติ/ปฏิเสธอื่นเข้ามาพร้อมกัน) — กรุณาโหลดข้อมูลใหม่',
        );
      }
      const row = await tx.deviceFirmwareOverride.findUniqueOrThrow({
        where: { id },
      });
      const metadata: AuditLogMetadata = {
        deviceId: existing.deviceId,
        firmwareId: existing.firmwareId,
      };
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          auditModule: AUDIT_MODULE,
          action: 'device-firmware-override-approve',
          metadata: metadata as Prisma.InputJsonValue,
        },
      });
      return row;
    });

    await this.notifyRequesterOfFirmwareOverrideDecision(updated, 'approved');

    return updated;
  }

  /** Operation ปฏิเสธคำขอ Firmware Override — `rejectReason` ไม่บังคับ
   * resource เดียวกับ approve (action `Approve`) mirror
   * `rejectDeviceConfigOverride()` ทุกประการ — ไม่เช็ค staleness (เหตุผล
   * เดียวกับ approve ด้านบน: ไม่มี "base" ให้ล้าสมัย) */
  async rejectDeviceFirmwareOverride(
    id: string,
    dto: RejectDeviceFirmwareOverrideDto,
    actor: ActingUser,
  ): Promise<DeviceFirmwareOverride> {
    const existing = await this.getPendingFirmwareOverrideOrThrow(id);

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.deviceFirmwareOverride.updateMany({
        where: { id, status: 'pending' },
        data: {
          status: 'rejected',
          decidedBy: actor.id,
          decidedAt: new Date(),
          rejectReason: dto.rejectReason ?? null,
        },
      });
      if (result.count === 0) {
        throw new ConflictException(
          'คำขอนี้ถูกตัดสินใจไปแล้ว (มีคำขออนุมัติ/ปฏิเสธอื่นเข้ามาพร้อมกัน) — กรุณาโหลดข้อมูลใหม่',
        );
      }
      const row = await tx.deviceFirmwareOverride.findUniqueOrThrow({
        where: { id },
      });
      const metadata: AuditLogMetadata = {
        deviceId: existing.deviceId,
        firmwareId: existing.firmwareId,
      };
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          auditModule: AUDIT_MODULE,
          action: 'device-firmware-override-reject',
          metadata: metadata as Prisma.InputJsonValue,
        },
      });
      return row;
    });

    await this.notifyRequesterOfFirmwareOverrideDecision(updated, 'rejected');

    return updated;
  }

  /** Operation ดูรายการคำขอ Firmware Override ทั้งหมด — filter ตาม `status`
   * (optional, ไม่ส่ง = ทุกสถานะ) เรียงคำขอใหม่ขึ้นก่อน mirror
   * `listDeviceConfigOverrides()` ทุกประการ */
  listDeviceFirmwareOverrides(
    status?: DeviceFirmwareOverrideStatus,
  ): Promise<DeviceFirmwareOverride[]> {
    return this.prisma.deviceFirmwareOverride.findMany({
      where: status ? { status } : undefined,
      orderBy: { overriddenAt: 'desc' },
    });
  }
}
