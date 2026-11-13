import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Campaign, CampaignTarget, Device, Prisma } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import type { AuditLogMetadata } from '../audit/audit-log-metadata';
import { PrismaService } from '../prisma/prisma.service';
import { lockCampaign } from './campaign-lock';
import { OPEN_CAMPAIGN_ROLLOUT_STATUSES } from './campaign-rollout-status';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import {
  AddCampaignTargetsDto,
  UpdateCampaignDto,
} from './dto/update-campaign.dto';
import { FIELD_APPLY_SYSTEM_CAMPAIGN_NAME } from './field-apply-system-campaign';

/** ผู้ที่กำลังเรียก endpoint — มาจาก JWT payload ({ sub, role }) เสมอ (แต่ละ
 * module ประกาศ interface นี้เองซ้ำกัน ไม่ import ข้าม module — pattern เดียวกับ
 * config.service.ts / device.service.ts / task.service.ts) */
export interface ActingUser {
  id: string;
  role: string;
  /** มาจาก `req.ip` ที่ controller แนบมาด้วย (docs §13.3 Audit Log ระบุ IP
   * Address เป็น field ที่ต้องเก็บ) — optional mirror `config.service.ts` */
  ipAddress?: string | null;
}

const AUDIT_MODULE = 'campaign';

/** อุปกรณ์ที่ยัง `registered` (ยังไม่ติดตั้ง) หรือ `decommissioned` (ปลดระวาง
 * แล้ว) ไม่ควรเข้ากลุ่มได้ — ต้อง `installed` เท่านั้น (mirror
 * `campaign-rollout.service.ts` ที่เช็คซ้ำอีกทีตอน push จริง เผื่อสถานะ
 * เปลี่ยนไปหลังเข้ากลุ่มแล้ว) */
const GROUPABLE_DEVICE_STATUS = 'installed';

/**
 * CampaignService — จัดการ "กลุ่มอุปกรณ์" (`Campaign`) เท่านั้น ไม่เกี่ยวกับ
 * การ push payload (ดู `CampaignRolloutService` แทน — แก้ไข 2026-09-24, ดู
 * comment เหนือ `model Campaign` ใน schema.prisma ว่าทำไมแยกสองเรื่องนี้)
 */
@Injectable()
export class CampaignService {
  private readonly logger = new Logger(CampaignService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** ซ่อน Campaign ระบบของคำขอส่ง Config จากหน้างาน (docs/25 §3.2/Q2) — ไม่ใช่
   * Campaign ที่ Operation จัดการเอง ไม่ควรโผล่ใน Campaign Monitor */
  findAll(): Promise<Campaign[]> {
    return this.prisma.campaign.findMany({
      where: { name: { not: FIELD_APPLY_SYSTEM_CAMPAIGN_NAME } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string): Promise<Campaign> {
    const campaign = await this.prisma.campaign.findUnique({ where: { id } });
    if (!campaign) {
      throw new NotFoundException(`ไม่พบ Campaign id ${id}`);
    }
    return campaign;
  }

  findTargets(campaignId: string): Promise<CampaignTarget[]> {
    return this.prisma.campaignTarget.findMany({
      where: { campaignId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * `POST /campaigns` — สร้างกลุ่มอุปกรณ์ + สมาชิกเริ่มต้น (`CampaignTarget[]`)
   * ใน `$transaction` เดียว · เพิ่ม/เอาสมาชิกออกทีหลังผ่าน `addTargets`/
   * `removeTarget` (เดิม MVP มติ 2026-09-24 ให้ fix ตอนสร้างเท่านั้น) — ไม่มี
   * payload/approval เกี่ยวข้องตรงนี้เลย (ย้ายไปอยู่ที่
   * `CampaignRolloutService.create()` แทน)
   */
  async create(dto: CreateCampaignDto, actor: ActingUser): Promise<Campaign> {
    this.assertNotReservedName(dto.name);
    const deviceIds = dto.targets.map((t) => t.deviceId);
    const duplicateDeviceIds = this.findDuplicates(deviceIds);
    if (duplicateDeviceIds.length > 0) {
      throw new BadRequestException(
        `มี deviceId ซ้ำกันในรายการเป้าหมาย: ${duplicateDeviceIds.join(', ')}`,
      );
    }

    const model = await this.prisma.deviceModel.findUnique({
      where: { id: dto.modelId },
      select: { id: true, name: true },
    });
    if (!model) {
      throw new BadRequestException(
        `ไม่พบโมเดล id ${dto.modelId} ในทะเบียนโมเดลอุปกรณ์`,
      );
    }

    const devices = await this.loadTargetDevices(dto.targets);
    const problems = this.collectUnavailableDeviceProblems(
      dto.targets,
      devices,
    );
    if (problems.length > 0) {
      throw new ConflictException(problems.join(' · '));
    }
    this.assertSameModel(dto.targets, devices, model);

    // Field Incident Report (issue #236) — ตรวจก่อนว่า incident ที่อ้างถึง
    // มีจริง + อยู่ในสถานะที่เพิ่งถูก promote (investigating) เท่านั้น
    // ป้องกันผูก sourceIncidentId มั่วกับ incident ที่ยังไม่ผ่าน decide เลย
    // หรือ auto-detect เดิม (ไม่มี flow promote) · `@unique` บน
    // `Campaign.sourceIncidentId` เป็น backstop กัน race (เช็คตรงนี้ผ่านแล้ว
    // แต่มีอีกคำขอมาผูก incident เดิมพร้อมกัน) → P2002 ด้านล่าง
    if (dto.sourceIncidentId) {
      const incident = await this.prisma.incident.findUnique({
        where: { id: dto.sourceIncidentId },
      });
      if (!incident) {
        throw new NotFoundException(
          `ไม่พบ Incident id ${dto.sourceIncidentId}`,
        );
      }
      if (incident.status !== 'investigating') {
        throw new ConflictException(
          `Incident นี้ยังไม่ได้ถูก promote เป็น Campaign (สถานะปัจจุบัน: ${incident.status})`,
        );
      }
    }

    let campaign: Campaign;
    try {
      campaign = await this.prisma.$transaction(async (tx) => {
        const createdCampaign = await tx.campaign.create({
          data: {
            name: dto.name,
            description: dto.description,
            createdBy: actor.id,
            sourceIncidentId: dto.sourceIncidentId,
            autoRetry: dto.autoRetry,
            modelId: model.id,
          },
        });

        await tx.campaignTarget.createMany({
          data: dto.targets.map((target) => ({
            campaignId: createdCampaign.id,
            deviceId: target.deviceId,
          })),
        });

        return createdCampaign;
      });
    } catch (err) {
      if (
        err instanceof PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          `Incident id ${dto.sourceIncidentId} ถูก promote เป็น Campaign อื่นไปแล้วโดยคำขอที่เกิดขึ้นพร้อมกัน`,
        );
      }
      throw err;
    }

    // AuditLog (CLAUDE.md Audit Pattern) — never-throw เหมือนโมดูล config/device
    await this.logAudit('create', actor);

    return campaign;
  }

  /**
   * `PATCH /campaigns/{id}` — แก้ชื่อ/คำอธิบายกลุ่ม ทำได้ทุกเมื่อ (ไม่กระทบ
   * Rollout ที่มีอยู่ เพราะ Rollout ผูกกับกลุ่มด้วย id ไม่ใช่ชื่อ)
   */
  async update(
    id: string,
    dto: UpdateCampaignDto,
    actor: ActingUser,
  ): Promise<Campaign> {
    if (
      dto.name === undefined &&
      dto.description === undefined &&
      dto.autoRetry === undefined
    ) {
      throw new BadRequestException(
        'ต้องส่ง name, description หรือ autoRetry อย่างน้อย 1 อย่าง',
      );
    }
    if (dto.name !== undefined) this.assertNotReservedName(dto.name);
    const existing = await this.getManageableOrThrow(id);

    const updated = await this.prisma.campaign.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        autoRetry: dto.autoRetry,
      },
    });

    await this.logAudit('update', actor, {
      campaignId: id,
      campaignName: updated.name,
    });
    this.logger.log(`แก้ Campaign ${id} (ชื่อเดิม "${existing.name}")`);
    return updated;
  }

  /**
   * `POST /campaigns/{id}/targets` — เพิ่มเครื่องเข้ากลุ่ม · ทำได้เฉพาะตอนไม่มี
   * Rollout ค้างอยู่ (409) เพราะ Rollout สร้างรายชื่อเครื่องของตัวเองไว้ตอนสร้าง
   * รอบนั้น การเปลี่ยนสมาชิกกลางทางจะทำให้รายชื่อกลุ่มกับรอบที่กำลังรันไม่ตรงกัน
   */
  async addTargets(
    id: string,
    dto: AddCampaignTargetsDto,
    actor: ActingUser,
  ): Promise<CampaignTarget[]> {
    const campaign = await this.getManageableOrThrow(id);

    const deviceIds = dto.targets.map((t) => t.deviceId);
    const duplicateDeviceIds = this.findDuplicates(deviceIds);
    if (duplicateDeviceIds.length > 0) {
      throw new BadRequestException(
        `มี deviceId ซ้ำกันในรายการเป้าหมาย: ${duplicateDeviceIds.join(', ')}`,
      );
    }

    const devices = await this.loadTargetDevices(dto.targets);
    const problems = this.collectUnavailableDeviceProblems(
      dto.targets,
      devices,
    );
    if (problems.length > 0) {
      throw new ConflictException(problems.join(' · '));
    }
    // กลุ่มเดิมก่อน 13 พ.ย. 2569 ที่ไม่มีรุ่น (หลายรุ่นปนกัน) เพิ่มเครื่องรุ่นไหนก็ได้เหมือนเดิม
    if (campaign.modelId) {
      const model = await this.prisma.deviceModel.findUnique({
        where: { id: campaign.modelId },
        select: { id: true, name: true },
      });
      if (model) this.assertSameModel(dto.targets, devices, model);
    }

    try {
      // ล็อกกลุ่มก่อน แล้วตรวจ Rollout ค้าง/สมาชิกซ้ำ/เขียน ใน transaction เดียว กันการ
      // สร้าง Rollout (ที่ snapshot รายชื่อเครื่อง) แทรกกลางระหว่างตรวจกับเขียน (review B #424)
      await this.prisma.$transaction(async (tx) => {
        await lockCampaign(tx, id, 'update');
        await this.assertNoOpenRollout(tx, id);

        const alreadyMembers = await tx.campaignTarget.findMany({
          where: { campaignId: id, deviceId: { in: deviceIds } },
          select: { deviceId: true },
        });
        if (alreadyMembers.length > 0) {
          throw new ConflictException(
            `เครื่องเหล่านี้อยู่ในกลุ่มแล้ว: ${alreadyMembers.map((m) => m.deviceId).join(', ')}`,
          );
        }

        await tx.campaignTarget.createMany({
          data: deviceIds.map((deviceId) => ({ campaignId: id, deviceId })),
        });
        await this.touchCampaign(tx, id);
      });
    } catch (err) {
      if (
        err instanceof PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'เครื่องบางตัวถูกเพิ่มเข้ากลุ่มไปแล้วโดยคำขอที่เกิดขึ้นพร้อมกัน',
        );
      }
      throw err;
    }

    await this.logAudit('add_targets', actor, {
      campaignId: id,
      campaignName: campaign.name,
      deviceIds,
    });
    return this.findTargets(id);
  }

  /**
   * `DELETE /campaigns/{id}/targets/{deviceId}` — เอาเครื่องออกจากกลุ่ม · เงื่อนไข
   * เดียวกับ `addTargets` และกลุ่มต้องเหลืออย่างน้อย 1 เครื่อง (กลุ่มเปล่าไม่มี
   * ความหมาย — ถ้าไม่ใช้กลุ่มแล้วให้ลบกลุ่ม)
   */
  async removeTarget(
    id: string,
    deviceId: string,
    actor: ActingUser,
  ): Promise<void> {
    const campaign = await this.getManageableOrThrow(id);

    await this.prisma.$transaction(async (tx) => {
      await lockCampaign(tx, id, 'update');
      await this.assertNoOpenRollout(tx, id);

      const target = await tx.campaignTarget.findUnique({
        where: { campaignId_deviceId: { campaignId: id, deviceId } },
      });
      if (!target) {
        throw new NotFoundException(`เครื่อง ${deviceId} ไม่ได้อยู่ในกลุ่มนี้`);
      }
      const memberCount = await tx.campaignTarget.count({
        where: { campaignId: id },
      });
      if (memberCount <= 1) {
        throw new ConflictException(
          'กลุ่มต้องเหลืออย่างน้อย 1 เครื่อง — ถ้าไม่ใช้กลุ่มนี้แล้วให้ลบกลุ่มแทน',
        );
      }

      await tx.campaignTarget.delete({ where: { id: target.id } });
      await this.touchCampaign(tx, id);
    });

    await this.logAudit('remove_target', actor, {
      campaignId: id,
      campaignName: campaign.name,
      deviceIds: [deviceId],
    });
  }

  /**
   * `DELETE /campaigns/{id}` — ลบกลุ่มพร้อมสมาชิกและประวัติ Rollout ของกลุ่ม
   * (cascade ใน schema) · ลบไม่ได้ขณะมี Rollout ค้าง (409) เพราะระบบยังต้องใช้
   * รายการนั้นอยู่ · ผลต่อกล่อง: ไม่มี — Config/Firmware ที่ส่งไปแล้วอยู่บนกล่อง
   * เอง ที่หายไปคือประวัติ Rollout ของกลุ่มนี้ (รวมถึงตัวย้อนกลับ Rollback ของ
   * รอบเก่า) ชื่อกลุ่มที่ลบเก็บไว้ใน AuditLog metadata
   */
  async remove(id: string, actor: ActingUser): Promise<void> {
    const campaign = await this.getManageableOrThrow(id);

    // ล็อกกลุ่ม -> ตรวจ Rollout ค้างซ้ำหลังได้ล็อก -> ลบ ใน transaction เดียว ถ้ามีการ
    // สร้าง Rollout พร้อมกัน อีกฝั่งจะรอแล้วเห็นผลของอีกฝั่งเสมอ (ไม่ลบ cascade
    // Rollout ที่เพิ่งเริ่มทิ้ง) · review B บน #424
    await this.prisma.$transaction(async (tx) => {
      await lockCampaign(tx, id, 'update');
      await this.assertNoOpenRollout(tx, id);
      await tx.campaign.delete({ where: { id } });
    });

    await this.logAudit('delete', actor, {
      campaignId: id,
      campaignName: campaign.name,
    });
  }

  /** โหลดกลุ่มที่แก้/ลบได้ — Campaign ระบบของคำขอหน้างานแสดงเป็น 404 เหมือนไม่มี
   * (ซ่อนจาก Monitor อยู่แล้ว และห้ามแตะเด็ดขาด — ชื่อเขียนว่า "ห้ามลบ") */
  private async getManageableOrThrow(id: string): Promise<Campaign> {
    const campaign = await this.prisma.campaign.findUnique({ where: { id } });
    if (!campaign || campaign.name === FIELD_APPLY_SYSTEM_CAMPAIGN_NAME) {
      throw new NotFoundException(`ไม่พบ Campaign id ${id}`);
    }
    return campaign;
  }

  /** อัปเดตแถวกลุ่ม (updatedAt) เมื่อสมาชิกเปลี่ยน - ให้ transaction Serializable ของการสร้าง
   * Rollout ที่รอล็อกอยู่ตรวจพบ (serialization failure -> 409 ลองใหม่) แทนที่จะสร้างจากรายชื่อเก่า */
  private async touchCampaign(
    tx: Prisma.TransactionClient,
    campaignId: string,
  ): Promise<void> {
    await tx.campaign.update({
      where: { id: campaignId },
      data: { updatedAt: new Date() },
    });
  }

  /** ชื่อ Campaign ระบบของคำขอหน้างานสงวนไว้ ผู้ใช้ตั้ง/เปลี่ยนชื่อเป็นชื่อนี้ไม่ได้ -
   * ไม่งั้น `getOrCreateFieldApplySystemCampaign()` อาจหยิบ Campaign ของผู้ใช้ไปเป็น
   * Campaign ระบบ แล้วกลุ่มนั้นถูกซ่อนและแก้ไม่ได้ (review B บน #424) */
  private assertNotReservedName(name: string): void {
    if (name === FIELD_APPLY_SYSTEM_CAMPAIGN_NAME) {
      throw new BadRequestException(
        'ชื่อนี้สงวนไว้สำหรับ Campaign ระบบ ใช้ตั้งชื่อกลุ่มไม่ได้',
      );
    }
  }

  private async assertNoOpenRollout(
    db: Pick<Prisma.TransactionClient, 'campaignRollout'>,
    campaignId: string,
  ): Promise<void> {
    const open = await db.campaignRollout.count({
      where: {
        campaignId,
        status: { in: [...OPEN_CAMPAIGN_ROLLOUT_STATUSES] },
      },
    });
    if (open > 0) {
      throw new ConflictException(
        `กลุ่มนี้ยังมี Rollout ที่ไม่จบ ${open} รอบ — รอให้จบ หรือปฏิเสธ/ยกเลิกก่อน`,
      );
    }
  }

  private findDuplicates(values: string[]): string[] {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const value of values) {
      if (seen.has(value)) {
        duplicates.add(value);
      }
      seen.add(value);
    }
    return [...duplicates];
  }

  private async loadTargetDevices(
    targets: { deviceId: string }[],
  ): Promise<Map<string, Device>> {
    const devices = await this.prisma.device.findMany({
      where: { deviceId: { in: targets.map((t) => t.deviceId) } },
    });
    return new Map(devices.map((d) => [d.deviceId, d]));
  }

  /** ทุกเครื่องต้องเป็นรุ่นของกลุ่ม (Campaign ผูกได้รุ่นเดียว 13 พ.ย. 2569) — 400 พร้อมรายชื่อเครื่องที่ต่างรุ่น
   * (เรียกหลัง `collectUnavailableDeviceProblems` ผ่านแล้ว จึงเจอ Device ครบทุกตัว) */
  private assertSameModel(
    targets: { deviceId: string }[],
    deviceByDeviceId: Map<string, Device>,
    model: { id: string; name: string },
  ): void {
    const mismatched = targets
      .map((t) => deviceByDeviceId.get(t.deviceId))
      .filter((d): d is Device => !!d && d.modelId !== model.id);
    if (mismatched.length > 0) {
      throw new BadRequestException(
        `กลุ่มนี้รับเฉพาะโมเดล ${model.name} เครื่องต่อไปนี้เป็นโมเดลอื่น: ${mismatched
          .map((d) => `${d.deviceId} (${d.deviceModel})`)
          .join(', ')}`,
      );
    }
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
      if (device.status !== GROUPABLE_DEVICE_STATUS) {
        problems.push(
          `Device ${target.deviceId} สถานะปัจจุบัน (${device.status}) ยังเข้ากลุ่มไม่ได้ — ต้องเป็น ${GROUPABLE_DEVICE_STATUS} (ติดตั้งจริงแล้ว) เท่านั้น`,
        );
      }
    }
    return problems;
  }

  private async logAudit(
    action: string,
    actor: ActingUser,
    metadata?: AuditLogMetadata,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: actor.id,
          auditModule: AUDIT_MODULE,
          action,
          ipAddress: actor.ipAddress,
          ...(metadata ? { metadata: metadata as Prisma.InputJsonValue } : {}),
        },
      });
    } catch (err) {
      this.logger.warn(
        `เขียน AuditLog ไม่สำเร็จ (module ${AUDIT_MODULE}, action ${action}, user ${actor.id}): ${(err as Error).message}`,
      );
    }
  }
}
