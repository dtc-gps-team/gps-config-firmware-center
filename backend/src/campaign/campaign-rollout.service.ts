import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CampaignPayloadType,
  CampaignRollout,
  CampaignRolloutTarget,
  Device,
} from '@prisma/client';
import {
  APPROVABLE_CAMPAIGN_ROLLOUT_STATUS,
  OPEN_CAMPAIGN_ROLLOUT_STATUSES,
} from './campaign-rollout-status';
import { APPLICABLE_CONFIG_STATUSES } from '../device/config-applier';
import {
  CAMPAIGN_ELIGIBLE_FIRMWARE_APPROVAL_STATUS,
  SIMULATABLE_FIRMWARE_STATUS,
} from '../firmware/firmware-status';
import { PrismaService } from '../prisma/prisma.service';
import { ActingUser } from './campaign.service';
import { CreateCampaignRolloutDto } from './dto/create-campaign-rollout.dto';

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

  constructor(private readonly prisma: PrismaService) {}

  findAll(campaignId: string): Promise<CampaignRollout[]> {
    return this.prisma.campaignRollout.findMany({
      where: { campaignId },
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
          status: 'active',
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

        await tx.campaignRollout.update({
          where: { id: rollout.id },
          data: {
            successCount,
            failureCount,
            status: pendingCount === 0 ? 'completed' : rollout.status,
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
