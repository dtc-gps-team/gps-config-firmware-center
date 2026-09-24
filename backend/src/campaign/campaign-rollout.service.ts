import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CampaignPayloadType,
  CampaignRollout,
  CampaignRolloutStatus,
  CampaignRolloutTarget,
  Device,
} from '@prisma/client';
import {
  APPROVABLE_CAMPAIGN_ROLLOUT_STATUS,
  AUTO_PAUSE_FAILURE_RATE_THRESHOLD,
  OPEN_CAMPAIGN_ROLLOUT_STATUSES,
  RESUMABLE_CAMPAIGN_ROLLOUT_STATUS,
  ROLLBACKABLE_CAMPAIGN_ROLLOUT_STATUSES,
} from './campaign-rollout-status';
import { APPLICABLE_CONFIG_STATUSES } from '../device/config-applier';
import {
  CAMPAIGN_ELIGIBLE_FIRMWARE_APPROVAL_STATUS,
  SIMULATABLE_FIRMWARE_STATUS,
} from '../firmware/firmware-status';
import { PrismaService } from '../prisma/prisma.service';
import { ActingUser } from './campaign.service';
import { CreateCampaignRolloutDto } from './dto/create-campaign-rollout.dto';
import { CreateCampaignRollbackDto } from './dto/create-campaign-rollback.dto';
import {
  FIRMWARE_ROLLBACK_EXECUTOR,
  type FirmwareRollbackExecutor,
} from './firmware-rollback-executor';

const AUDIT_MODULE = 'campaign';

/** สำเนาของ `TESTABLE_DEVICE_STATUS` ใน device.service.ts (ไม่ได้ export จากที่
 * นั่น) — อุปกรณ์ที่ยัง `registered` หรือ `decommissioned` แล้ว ไม่ควรเป็น
 * เป้าหมายของ rollout ต่อให้ยังอยู่ในกลุ่มก็ตาม (สถานะอาจเปลี่ยนไปหลังเข้า
 * กลุ่มแล้ว — เช็คซ้ำตรงนี้อีกที ไม่เชื่อว่าตอนเข้ากลุ่มยัง `installed` แปลว่า
 * ตอน push ก็ยังต้อง `installed` เหมือนเดิม) */
const TARGETABLE_DEVICE_STATUS = 'installed';

type PayloadResult =
  | { configId: string; firmwareId: null }
  | { configId: null; firmwareId: string };

/**
 * CampaignRolloutService — จัดการ "1 รอบ push Config/Firmware เข้ากลุ่ม"
 * (`CampaignRollout`) แยกจาก `CampaignService` ที่ดูแลแค่ตัวกลุ่ม (แก้ไข
 * 2026-09-24 — ดู comment เหนือ `model CampaignRollout` ใน schema.prisma)
 *
 * เนื้อหา validate payload/compatibility ส่วนใหญ่ mirror `CampaignService`
 * เวอร์ชันก่อนแก้ไข 2026-09-24 ทุกประการ ต่างแค่แหล่งที่มาของ target ที่นี่
 * ดึงจากสมาชิกกลุ่ม (`CampaignTarget`) ลบด้วย `excludeDeviceIds` แทนที่จะรับ
 * เป็น input ตรงๆ
 */
@Injectable()
export class CampaignRolloutService {
  private readonly logger = new Logger(CampaignRolloutService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FIRMWARE_ROLLBACK_EXECUTOR)
    private readonly firmwareRollbackExecutor: FirmwareRollbackExecutor,
  ) {}

  findAll(campaignId: string): Promise<CampaignRollout[]> {
    return this.prisma.campaignRollout.findMany({
      where: { campaignId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * `GET /campaigns/rollouts` — ข้าม Campaign ทุกกลุ่ม (แก้ไข 2026-09-24 —
   * Approval Center รวม Campaign Rollout เข้าไปด้วย ตามที่ mockup เดิมตั้งใจ
   * ไว้ตั้งแต่แรกแต่ Firmware/Campaign เคยถูกเลื่อนไว้ก่อน) — `status` ไม่ระบุ
   * = คืนทุกสถานะ ใช้ `?status=pending_approval` กรองเฉพาะที่รออนุมัติ mirror
   * `ConfigService.findAll({ status })`
   */
  findAllAcrossCampaigns(
    status?: CampaignRolloutStatus,
  ): Promise<CampaignRollout[]> {
    return this.prisma.campaignRollout.findMany({
      where: { status },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string): Promise<CampaignRollout> {
    const rollout = await this.prisma.campaignRollout.findUnique({
      where: { id },
    });
    if (!rollout) {
      throw new NotFoundException(`ไม่พบ Campaign Rollout id ${id}`);
    }
    return rollout;
  }

  findTargets(rolloutId: string): Promise<CampaignRolloutTarget[]> {
    return this.prisma.campaignRolloutTarget.findMany({
      where: { rolloutId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * `POST /campaigns/{campaignId}/rollouts` — สร้าง Rollout ใหม่ (Sprint 3
   * #21/#22) **กลุ่มหนึ่งรัน rollout ได้ทีละรอบเท่านั้น** (มติ 2026-09-24) —
   * 409 ถ้ายังมีรอบที่ `pending_approval`/`active` ค้างอยู่ สร้างแล้วเป็น
   * `pending_approval` เสมอ ต้องรอ Operation อีกคนอนุมัติก่อนถึงจะ `active`
   * (Campaign Approval, แก้ครั้งที่ 39)
   */
  async create(
    campaignId: string,
    dto: CreateCampaignRolloutDto,
    actor: ActingUser,
  ): Promise<CampaignRollout> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });
    if (!campaign) {
      throw new NotFoundException(`ไม่พบ Campaign id ${campaignId}`);
    }

    const openRollout = await this.prisma.campaignRollout.findFirst({
      where: {
        campaignId,
        status: { in: [...OPEN_CAMPAIGN_ROLLOUT_STATUSES] },
      },
    });
    if (openRollout) {
      throw new ConflictException(
        `กลุ่มนี้มี Rollout ที่ยังไม่จบอยู่แล้ว (${openRollout.status}) — ต้องรอให้จบก่อน (completed/rejected/cancelled) ถึงจะเริ่มรอบใหม่ได้`,
      );
    }

    const groupTargets = await this.prisma.campaignTarget.findMany({
      where: { campaignId },
    });
    const excludeSet = new Set(dto.excludeDeviceIds ?? []);
    const unknownExcludes = [...excludeSet].filter(
      (deviceId) => !groupTargets.some((t) => t.deviceId === deviceId),
    );
    if (unknownExcludes.length > 0) {
      throw new BadRequestException(
        `excludeDeviceIds มีเครื่องที่ไม่ได้อยู่ในกลุ่มนี้: ${unknownExcludes.join(', ')}`,
      );
    }

    const rolloutDeviceIds = groupTargets
      .map((t) => t.deviceId)
      .filter((deviceId) => !excludeSet.has(deviceId));
    if (rolloutDeviceIds.length === 0) {
      throw new BadRequestException(
        'ไม่มีอุปกรณ์เหลือสำหรับ Rollout นี้ (เอาออกหมดทุกเครื่อง หรือกลุ่มนี้ยังไม่มีสมาชิก)',
      );
    }
    const targetRefs = rolloutDeviceIds.map((deviceId) => ({ deviceId }));

    const { configId, firmwareId } =
      dto.payloadType === CampaignPayloadType.Config
        ? await this.validateConfigPayload(dto, targetRefs)
        : await this.validateFirmwarePayload(dto, targetRefs);

    const rollout = await this.prisma.$transaction(async (tx) => {
      const createdRollout = await tx.campaignRollout.create({
        data: {
          campaignId,
          payloadType: dto.payloadType,
          configId,
          firmwareId,
          status: 'pending_approval',
          targetCount: rolloutDeviceIds.length,
          createdBy: actor.id,
        },
      });

      await tx.campaignRolloutTarget.createMany({
        data: rolloutDeviceIds.map((deviceId) => ({
          rolloutId: createdRollout.id,
          deviceId,
        })),
      });

      return createdRollout;
    });

    await this.logAudit('create', actor.id);
    return rollout;
  }

  /**
   * `POST /campaigns/{campaignId}/rollouts/{id}/approve` — Operation อนุมัติ
   * Rollout ที่รอตัดสินใจอยู่ (`pending_approval` เท่านั้น — 409 ถ้าไม่ใช่
   * mirror `FirmwareService.approve`) เปลี่ยนเป็น `active` บันทึก
   * `approvedBy`/`approvedAt`
   *
   * **Separation of Duty:** Rollout สร้างโดย Operation เอง — ต้องเช็คว่าผู้กด
   * อนุมัติไม่ใช่ผู้สร้างคนเดียวกัน (403) ไม่งั้น Operation คนเดียว
   * สร้าง+อนุมัติเองได้ ขัดหลัก SoD ที่ CLAUDE.md ระบุไว้
   */
  async approve(id: string, actor: ActingUser): Promise<CampaignRollout> {
    const rollout = await this.findOne(id);
    this.assertDecidable(rollout, actor);

    const updated = await this.prisma.campaignRollout.update({
      where: { id },
      data: { status: 'active', approvedBy: actor.id, approvedAt: new Date() },
    });

    await this.logAudit('approve', actor.id);

    // Firmware Rollback ผ่าน Dual Partition (mock) — เร็วกว่า Config Rollback
    // โดยตั้งใจ (แก้ไข 2026-09-24, Incident & Rollback #28): ของเก่ายังอยู่
    // บนอีกพาร์ทิชันอยู่แล้ว แค่สลับกลับ ไม่ต้องรอช่างไปกดที่เครื่องผ่าน
    // Mobile เหมือน Config Rollback (ที่ยังต้องผ่าน apply-config ปกติทุก
    // ประการ) — ทำ**หลัง**อัปเดต status เป็น active แล้วเท่านั้น (ไม่ทำใน
    // transaction เดียวกับด้านบน เพราะเป็นงานที่ "อาจ fail บางเครื่อง" ต่างจาก
    // การอนุมัติเองที่ทำสำเร็จแน่นอน)
    if (updated.isRollback && updated.payloadType === 'Firmware') {
      return this.executeFirmwarePartitionRollback(updated);
    }

    return updated;
  }

  /**
   * `POST /campaigns/{campaignId}/rollouts/{id}/reject` — mirror `approve()`
   * แต่เปลี่ยนเป็น `rejected` แทน ไม่ตั้ง `approvedBy`/`approvedAt` (ไม่มีใคร
   * "อนุมัติ" การ reject) — rollout รอบนี้จบเป็นประวัติ เปิดรอบใหม่ผ่าน
   * `POST /campaigns/{campaignId}/rollouts` อีกครั้งได้ทันที (ไม่มี `draft`/
   * PATCH แก้ rollout เดิม)
   */
  async reject(id: string, actor: ActingUser): Promise<CampaignRollout> {
    const rollout = await this.findOne(id);
    this.assertDecidable(rollout, actor);

    const updated = await this.prisma.campaignRollout.update({
      where: { id },
      data: { status: 'rejected' },
    });

    await this.logAudit('reject', actor.id);
    return updated;
  }

  /**
   * `POST /campaigns/{campaignId}/rollouts/{id}/resume` — Operation ปลด Auto
   * Pause (Incident & Rollback #28) กลับไป `active` ต่อ — ต้องเป็น `paused`
   * เท่านั้น (409 ถ้าไม่ใช่) **ไม่เช็ค Separation of Duty** ต่างจาก
   * approve/reject โดยตั้งใจ — resume ไม่ใช่การ "ตัดสินใจอนุมัติ" งานใหม่
   * แค่บอกว่า "ดูแล้ว ให้ไปต่อ" ผู้สร้าง rollout เองก็ทำได้
   */
  async resume(id: string, actor: ActingUser): Promise<CampaignRollout> {
    const rollout = await this.findOne(id);
    if (rollout.status !== RESUMABLE_CAMPAIGN_ROLLOUT_STATUS) {
      throw new ConflictException(
        `สถานะ Rollout ปัจจุบัน (${rollout.status}) ไม่ใช่ ${RESUMABLE_CAMPAIGN_ROLLOUT_STATUS} จึง resume ไม่ได้`,
      );
    }

    const updated = await this.prisma.campaignRollout.update({
      where: { id },
      data: { status: 'active' },
    });

    await this.logAudit('resume', actor.id);
    return updated;
  }

  /**
   * `POST /campaigns/{campaignId}/rollouts/{id}/rollback` — สร้าง Rollout
   * ใหม่ที่ payload เป็นของ "รอบก่อนหน้าที่สำเร็จ" ของกลุ่มเดียวกัน (Incident
   * & Rollback #28 — mirror `POST /api/campaigns/{id}/rollback` ของ
   * GPS_Config_Firmware_Center_Design.pdf §15.1 แต่ implement เป็น "สร้าง
   * CampaignRollout รอบใหม่" แทนที่จะทำ state machine แยก — รีไซเคิล flow
   * approve/reject/CampaignRolloutTarget/recordTargetResult เดิมทั้งหมด)
   *
   * target = เฉพาะเครื่องที่ `CampaignRolloutTarget.status = success` ของรอบ
   * ที่มีปัญหา (เครื่องที่ `failed`/`pending` ไม่เคยได้รับ payload เสียจริง
   * ไม่ต้อง rollback) — เอาบางเครื่องออกได้ผ่าน `excludeDeviceIds` เหมือน
   * `create()`
   *
   * **ไม่เช็ค "มีรอบเปิดอยู่ไหม" เหมือน `create()`** เพราะ rollback คือวิธี
   * แก้ปัญหารอบที่ค้างอยู่นี้เอง ไม่ใช่การเริ่มงานใหม่ (ดู comment เหนือ
   * `OPEN_CAMPAIGN_ROLLOUT_STATUSES`) — เช็คแค่ว่า rollout เป้าหมายอยู่ใน
   * สถานะที่เคยส่ง payload ไปแล้วจริง (`ROLLBACKABLE_CAMPAIGN_ROLLOUT_STATUSES`)
   */
  async rollback(
    campaignId: string,
    rolloutId: string,
    dto: CreateCampaignRollbackDto,
    actor: ActingUser,
  ): Promise<CampaignRollout> {
    const badRollout = await this.findOne(rolloutId);
    if (badRollout.campaignId !== campaignId) {
      throw new NotFoundException(
        `ไม่พบ Campaign Rollout id ${rolloutId} ในกลุ่มนี้`,
      );
    }
    if (!ROLLBACKABLE_CAMPAIGN_ROLLOUT_STATUSES.includes(badRollout.status)) {
      throw new ConflictException(
        `สถานะ Rollout ปัจจุบัน (${badRollout.status}) ยังไม่เคยส่ง payload ไปอุปกรณ์เลย ไม่มีอะไรให้ rollback`,
      );
    }

    // ต้อง `completed` เท่านั้น (ไม่ใช่แค่ createdAt ก่อนหน้า) เพราะกลุ่มหนึ่ง
    // รัน rollout ได้ทีละรอบ — รอบก่อนหน้าที่ `rejected`/`cancelled` ไม่เคยส่ง
    // อะไรจริง ไม่ใช่เป้าหมาย rollback ที่ถูกต้อง · payloadType ต้องตรงกัน
    // เท่านั้น (Config rollback กลับไป Config เดิม, Firmware กลับไป Firmware
    // เดิม ห้ามข้ามชนิด)
    const previousRollout = await this.prisma.campaignRollout.findFirst({
      where: {
        campaignId,
        id: { not: rolloutId },
        createdAt: { lt: badRollout.createdAt },
        status: 'completed',
        payloadType: badRollout.payloadType,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!previousRollout) {
      throw new BadRequestException(
        'ไม่มี Rollout รอบก่อนหน้าที่สำเร็จให้ย้อนกลับไป (นี่คือรอบแรกของ payload ประเภทนี้ในกลุ่มนี้)',
      );
    }

    const affectedTargets = await this.prisma.campaignRolloutTarget.findMany({
      where: { rolloutId, status: 'success' },
    });
    const excludeSet = new Set(dto.excludeDeviceIds ?? []);
    const unknownExcludes = [...excludeSet].filter(
      (deviceId) => !affectedTargets.some((t) => t.deviceId === deviceId),
    );
    if (unknownExcludes.length > 0) {
      throw new BadRequestException(
        `excludeDeviceIds มีเครื่องที่ไม่ได้อยู่ในรายการที่ได้รับ payload ของรอบนี้: ${unknownExcludes.join(', ')}`,
      );
    }

    const rollbackDeviceIds = affectedTargets
      .map((t) => t.deviceId)
      .filter((deviceId) => !excludeSet.has(deviceId));
    if (rollbackDeviceIds.length === 0) {
      throw new BadRequestException(
        'ไม่มีอุปกรณ์เหลือให้ rollback (ไม่มีเครื่องไหนได้รับ payload ของรอบนี้สำเร็จ หรือเอาออกหมดแล้ว)',
      );
    }

    const rollback = await this.prisma.$transaction(async (tx) => {
      const created = await tx.campaignRollout.create({
        data: {
          campaignId,
          payloadType: previousRollout.payloadType,
          configId: previousRollout.configId,
          firmwareId: previousRollout.firmwareId,
          status: 'pending_approval',
          targetCount: rollbackDeviceIds.length,
          createdBy: actor.id,
          isRollback: true,
          rollbackOfId: rolloutId,
        },
      });

      await tx.campaignRolloutTarget.createMany({
        data: rollbackDeviceIds.map((deviceId) => ({
          rolloutId: created.id,
          deviceId,
        })),
      });

      return created;
    });

    await this.logAudit('rollback', actor.id);
    return rollback;
  }

  /**
   * Firmware Rollback ผ่าน Dual Partition (mock, แก้ไข 2026-09-24) — เรียก
   * จาก `approve()` ทันทีที่รอบเป็น `active` (ไม่ต้องรอช่างไปกดที่เครื่อง
   * เหมือน Config เพราะของเก่ายังอยู่บนอีกพาร์ทิชันอยู่แล้ว) วน
   * `CampaignRolloutTarget` ที่ยัง `pending` ทุกอัน สั่ง
   * `FirmwareRollbackExecutor.switchPartition()` ทีละเครื่อง แล้วปิด Rollout
   * เป็น `completed` เสมอ (ไม่มีอะไรค้าง `pending` ต่อ — ต่างจาก Config ที่
   * รอ `recordTargetResult()` จาก field จริง)
   */
  private async executeFirmwarePartitionRollback(
    rollout: CampaignRollout,
  ): Promise<CampaignRollout> {
    if (!rollout.firmwareId) return rollout; // defensive — ไม่ควรเกิดขึ้นจริง

    const targets = await this.prisma.campaignRolloutTarget.findMany({
      where: { rolloutId: rollout.id, status: 'pending' },
    });
    const devices = await this.loadTargetDevices(
      targets.map((t) => ({ deviceId: t.deviceId })),
    );

    for (const target of targets) {
      const device = devices.get(target.deviceId);
      if (!device) {
        await this.prisma.campaignRolloutTarget.update({
          where: { id: target.id },
          data: {
            status: 'failed',
            resultDetail: `ไม่พบ Device deviceId ${target.deviceId}`,
          },
        });
        continue;
      }

      const inactivePartition = device.activePartition === 'A' ? 'B' : 'A';
      const inactivePartitionFirmwareId =
        inactivePartition === 'A'
          ? device.partitionAFirmwareId
          : device.partitionBFirmwareId;

      const result = await this.firmwareRollbackExecutor.switchPartition({
        deviceId: device.deviceId,
        activePartition: device.activePartition,
        inactivePartitionFirmwareId,
        targetFirmwareId: rollout.firmwareId,
      });

      await this.prisma.campaignRolloutTarget.update({
        where: { id: target.id },
        data: {
          status: result.switched ? 'success' : 'failed',
          resultDetail: result.details.join(' · '),
        },
      });
      if (result.switched) {
        await this.prisma.device.update({
          where: { deviceId: device.deviceId },
          data: { activePartition: inactivePartition },
        });
      }
    }

    const [successCount, failureCount] = await Promise.all([
      this.prisma.campaignRolloutTarget.count({
        where: { rolloutId: rollout.id, status: 'success' },
      }),
      this.prisma.campaignRolloutTarget.count({
        where: { rolloutId: rollout.id, status: 'failed' },
      }),
    ]);

    return this.prisma.campaignRollout.update({
      where: { id: rollout.id },
      data: { successCount, failureCount, status: 'completed' },
    });
  }

  private assertDecidable(rollout: CampaignRollout, actor: ActingUser): void {
    if (rollout.status !== APPROVABLE_CAMPAIGN_ROLLOUT_STATUS) {
      throw new ConflictException(
        `สถานะ Rollout ปัจจุบัน (${rollout.status}) ไม่ใช่ ${APPROVABLE_CAMPAIGN_ROLLOUT_STATUS} จึงตัดสินใจไม่ได้`,
      );
    }
    if (rollout.createdBy === actor.id) {
      throw new ForbiddenException(
        'ผู้สร้าง Rollout อนุมัติ/ปฏิเสธ Rollout ของตัวเองไม่ได้ (Separation of Duty)',
      );
    }
  }

  /**
   * Hook จาก `DeviceService.applyConfig()`/`confirmFirmwareInstall()`
   * (Campaign Monitor #22, แก้ไข 2026-09-24) — หา `CampaignRolloutTarget` ที่
   * ยัง `pending` ของ Rollout ที่ `active` อยู่ ที่ตรงกับ deviceId+payload นี้
   * แล้วอัปเดตผล + คำนวณ `successCount`/`failureCount` ใหม่ ถ้าครบทุกเครื่อง
   * แล้วให้ปิด Rollout เป็น `completed`
   *
   * **never-throw** — เป็นแค่ side-effect ติดตามผล ไม่ใช่ core contract ของ
   * apply-config/confirm-firmware-install เอง (mirror pattern `logAudit` ใน
   * ไฟล์นี้/`device.service.ts`) ถ้าไม่เจอ target ที่ match (เช่น apply
   * นอกแคมเปญ) ก็แค่ไม่ทำอะไรเลย ไม่ error
   */
  async recordTargetResult(
    deviceId: string,
    payload: { configId: string } | { firmwareId: string },
    success: boolean,
    detail: string,
  ): Promise<void> {
    try {
      const rollout = await this.prisma.campaignRollout.findFirst({
        where: {
          // รวม `paused` ด้วย (แก้ไข 2026-09-24, Auto Pause #28) — เครื่องที่
          // ช่างกำลังทำอยู่ตอน auto-pause เพิ่งเกิดยังต้องบันทึกผลได้ ไม่งั้น
          // ผลของเครื่องนั้นหายไปเฉยๆ ทั้งที่ช่างทำจริงไปแล้ว
          status: { in: ['active', 'paused'] },
          ...('configId' in payload
            ? { configId: payload.configId }
            : { firmwareId: payload.firmwareId }),
        },
      });
      if (!rollout) return;

      const target = await this.prisma.campaignRolloutTarget.findFirst({
        where: { rolloutId: rollout.id, deviceId, status: 'pending' },
      });
      if (!target) return;

      await this.prisma.$transaction(async (tx) => {
        await tx.campaignRolloutTarget.update({
          where: { id: target.id },
          data: {
            status: success ? 'success' : 'failed',
            resultDetail: detail,
          },
        });

        const [successCount, failureCount, pendingCount] = await Promise.all([
          tx.campaignRolloutTarget.count({
            where: { rolloutId: rollout.id, status: 'success' },
          }),
          tx.campaignRolloutTarget.count({
            where: { rolloutId: rollout.id, status: 'failed' },
          }),
          tx.campaignRolloutTarget.count({
            where: { rolloutId: rollout.id, status: 'pending' },
          }),
        ]);

        // Auto Pause (Incident & Rollback #28, มติ 2026-09-24 — mirror
        // GPS_Config_Firmware_Center_Design.pdf §11.2/หลักการข้อ 22: "ต้อง
        // Auto Pause เมื่อ Failure เกิน Threshold") — เช็คแค่ตอนยัง `active`
        // เท่านั้น (ถ้า `paused` อยู่แล้วไม่ต้องเช็คซ้ำ, `completed` ชนะเสมอ
        // เมื่อ pending หมดไม่ว่า failure rate เท่าไหร่ — ดูค่าผ่าน
        // successCount/failureCount ได้อยู่แล้วตอนจบ ไม่มีประโยชน์ต้อง pause
        // งานที่จบไปแล้ว)
        const failureRate =
          rollout.targetCount > 0 ? failureCount / rollout.targetCount : 0;
        const shouldAutoPause =
          rollout.status === 'active' &&
          pendingCount > 0 &&
          failureRate > AUTO_PAUSE_FAILURE_RATE_THRESHOLD;

        await tx.campaignRollout.update({
          where: { id: rollout.id },
          data: {
            successCount,
            failureCount,
            status:
              pendingCount === 0
                ? 'completed'
                : shouldAutoPause
                  ? 'paused'
                  : rollout.status,
          },
        });
      });
    } catch (err) {
      this.logger.warn(
        `บันทึกผล Campaign Rollout ไม่สำเร็จ (deviceId ${deviceId}): ${(err as Error).message}`,
      );
    }
  }

  /**
   * payloadType=Config — validate ครบแล้วคืน `{ configId, firmwareId: null }`
   * ให้ `create()` เขียนลง DB ตรงๆ (defensive ตาม `ValidateIf` บน DTO)
   */
  private async validateConfigPayload(
    dto: CreateCampaignRolloutDto,
    targets: { deviceId: string }[],
  ): Promise<PayloadResult> {
    if (!dto.configId) {
      throw new BadRequestException('payloadType "Config" ต้องระบุ configId');
    }

    const config = await this.prisma.config.findUnique({
      where: { id: dto.configId },
    });
    if (!config) {
      throw new NotFoundException(`ไม่พบ Config id ${dto.configId}`);
    }
    if (!APPLICABLE_CONFIG_STATUSES.includes(config.status)) {
      throw new ConflictException(
        `Config สถานะปัจจุบัน (${config.status}) ยังใช้สร้าง Rollout ไม่ได้ — ต้องผ่านการอนุมัติ (${APPLICABLE_CONFIG_STATUSES.join('/')}) ก่อน`,
      );
    }

    const devices = await this.loadTargetDevices(targets);
    const problems = this.collectUnavailableDeviceProblems(targets, devices);
    for (const target of targets) {
      const device = devices.get(target.deviceId);
      if (!device) continue; // ปัญหานี้ถูกเก็บไว้แล้วใน problems
      if (
        device.deviceModel !== config.deviceModel ||
        device.protocol !== config.protocol
      ) {
        problems.push(
          `Device ${target.deviceId} (${device.deviceModel}/${device.protocol}) ไม่ตรงกับ Config (${config.deviceModel}/${config.protocol})`,
        );
      }
    }
    if (problems.length > 0) {
      throw new ConflictException(problems.join(' · '));
    }

    return { configId: dto.configId, firmwareId: null };
  }

  /**
   * payloadType=Firmware — validate ครบแล้วคืน `{ configId: null,
   * firmwareId }` ให้ `create()` เขียนลง DB ตรงๆ — เกณฑ์ความเข้ากันได้ต่าง
   * จาก Config: เทียบแค่ `deviceModel` อยู่ใน `deviceModelCompatibility`
   * หรือไม่ (Firmware ไม่มี field protocol ให้เทียบ)
   */
  private async validateFirmwarePayload(
    dto: CreateCampaignRolloutDto,
    targets: { deviceId: string }[],
  ): Promise<PayloadResult> {
    if (!dto.firmwareId) {
      throw new BadRequestException(
        'payloadType "Firmware" ต้องระบุ firmwareId',
      );
    }

    const firmware = await this.prisma.firmware.findUnique({
      where: { id: dto.firmwareId },
    });
    if (!firmware) {
      throw new NotFoundException(`ไม่พบ Firmware id ${dto.firmwareId}`);
    }
    if (firmware.uploadStatus !== SIMULATABLE_FIRMWARE_STATUS) {
      throw new ConflictException(
        `Firmware สถานะอัปโหลดปัจจุบัน (${firmware.uploadStatus}) ยังใช้สร้าง Rollout ไม่ได้ — ต้องเป็น "${SIMULATABLE_FIRMWARE_STATUS}" (จัดเก็บสำเร็จแล้ว) เท่านั้น`,
      );
    }
    if (
      firmware.approvalStatus !== CAMPAIGN_ELIGIBLE_FIRMWARE_APPROVAL_STATUS
    ) {
      throw new ConflictException(
        `Firmware สถานะอนุมัติคุณภาพปัจจุบัน (${firmware.approvalStatus}) ยังใช้สร้าง Rollout ไม่ได้ — ต้องเป็น "${CAMPAIGN_ELIGIBLE_FIRMWARE_APPROVAL_STATUS}" (QAEngineer อนุมัติคุณภาพแล้ว) เท่านั้น`,
      );
    }

    const devices = await this.loadTargetDevices(targets);
    const problems = this.collectUnavailableDeviceProblems(targets, devices);
    for (const target of targets) {
      const device = devices.get(target.deviceId);
      if (!device) continue; // ปัญหานี้ถูกเก็บไว้แล้วใน problems
      if (!firmware.deviceModelCompatibility.includes(device.deviceModel)) {
        problems.push(
          `Device ${target.deviceId} (${device.deviceModel}) ไม่อยู่ในรายการรุ่นที่ Firmware นี้รองรับ (${firmware.deviceModelCompatibility.join(', ')})`,
        );
      }
    }
    if (problems.length > 0) {
      throw new ConflictException(problems.join(' · '));
    }

    return { configId: null, firmwareId: dto.firmwareId };
  }

  private async loadTargetDevices(
    targets: { deviceId: string }[],
  ): Promise<Map<string, Device>> {
    const devices = await this.prisma.device.findMany({
      where: { deviceId: { in: targets.map((t) => t.deviceId) } },
    });
    return new Map(devices.map((d) => [d.deviceId, d]));
  }

  private collectUnavailableDeviceProblems(
    targets: { deviceId: string }[],
    deviceByDeviceId: Map<string, Device>,
  ): string[] {
    const problems: string[] = [];
    for (const target of targets) {
      const device = deviceByDeviceId.get(target.deviceId);
      if (!device) {
        problems.push(`ไม่พบ Device deviceId ${target.deviceId}`);
        continue;
      }
      if (device.status !== TARGETABLE_DEVICE_STATUS) {
        problems.push(
          `Device ${target.deviceId} สถานะปัจจุบัน (${device.status}) ยังไม่พร้อมรับ Rollout — ต้องเป็น ${TARGETABLE_DEVICE_STATUS} (ติดตั้งจริงแล้ว) เท่านั้น`,
        );
      }
    }
    return problems;
  }

  private async logAudit(action: string, userId: string): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: { userId, auditModule: AUDIT_MODULE, action },
      });
    } catch (err) {
      this.logger.warn(
        `เขียน AuditLog ไม่สำเร็จ (module ${AUDIT_MODULE}, action ${action}, user ${userId}): ${(err as Error).message}`,
      );
    }
  }
}
