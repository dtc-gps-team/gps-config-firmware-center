import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Campaign, CampaignPayloadType } from '@prisma/client';
import { APPLICABLE_CONFIG_STATUSES } from '../device/config-applier';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { QueryCampaignDto } from './dto/query-campaign.dto';

/** ผู้ที่กำลังเรียก endpoint — มาจาก JWT payload ({ sub, role }) เสมอ (แต่ละ
 * module ประกาศ interface นี้เองซ้ำกัน ไม่ import ข้าม module — pattern เดียวกับ
 * config.service.ts / device.service.ts / task.service.ts) */
export interface ActingUser {
  id: string;
  role: string;
}

const AUDIT_MODULE = 'campaign';

/** สำเนาของ `TESTABLE_DEVICE_STATUS` ใน device.service.ts (ไม่ได้ export จากที่
 * นั่น) — อุปกรณ์ที่ยัง `registered` (ยังไม่ติดตั้ง) หรือ `decommissioned`
 * (ปลดระวางแล้ว) ไม่ควรเป็นเป้าหมายของแคมเปญ เพราะสุดท้ายจะไปติด 409 ตอนช่าง
 * กด apply-config หน้างานอยู่ดี — เช็คตั้งแต่สร้างแคมเปญดีกว่าปล่อยให้ไปพังทีหลัง */
const TARGETABLE_DEVICE_STATUS = 'installed';

@Injectable()
export class CampaignService {
  private readonly logger = new Logger(CampaignService.name);

  constructor(private readonly prisma: PrismaService) {}

  findAll(query: QueryCampaignDto): Promise<Campaign[]> {
    return this.prisma.campaign.findMany({
      where: { status: query.status },
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

  /**
   * Campaign Wizard (#21) — สร้าง Campaign + CampaignTarget ต่ออุปกรณ์ใน
   * `$transaction` เดียว ไม่มี queue เพราะเป็นแค่เขียน DB ของเราเอง
   *
   * v1 = "ส่งพร้อมกันหมด" ล้วน — ไม่มี draft/rollout strategy เลย ตอน submit
   * ก็ active ทันที ต่างจาก Config ที่มีขั้นตอนอนุมัติแยก — `CampaignStatus`
   * ไม่มี approval workflow ของตัวเอง
   *
   * **แก้ไข 2026-09-14:** เดิม step นี้สร้าง `Task` ต่ออุปกรณ์พร้อม
   * `assignedTo` ด้วย (มอบหมายผู้รับผิดชอบหน้างาน) — หัวหน้าแก้ scope ว่า
   * Campaign มีไว้ติดตาม/บำรุงรักษาอุปกรณ์เป็นกลุ่มเท่านั้น การมอบหมายงาน
   * ให้ช่างหน้างานเป็นหน้าที่ของระบบแยกที่บริษัทมีอยู่แล้ว ทำเองจะซ้อนทับ
   * ระบบ จึงตัดการสร้าง Task และการแจ้งเตือนผู้รับผิดชอบออกทั้งหมด เหลือแค่
   * Campaign + CampaignTarget (ดู RBAC_Matrix.md changelog)
   */
  async create(dto: CreateCampaignDto, actor: ActingUser): Promise<Campaign> {
    if (dto.payloadType !== CampaignPayloadType.Config) {
      throw new BadRequestException(
        'payloadType "Firmware" ยังไม่รองรับ — ยังไม่มี backend firmware module ให้สร้าง Firmware record เลย (รอ Sprint 3 #23)',
      );
    }
    // ValidateIf บน DTO ควรบังคับ configId มาแล้วตอน payloadType=Config แต่กัน
    // ไว้อีกชั้นเผื่อ validation หลุด (defensive, ไม่ควรเกิดขึ้นจริง)
    if (!dto.configId) {
      throw new BadRequestException('payloadType "Config" ต้องระบุ configId');
    }

    const deviceIds = dto.targets.map((t) => t.deviceId);
    const duplicateDeviceIds = this.findDuplicates(deviceIds);
    if (duplicateDeviceIds.length > 0) {
      throw new BadRequestException(
        `มี deviceId ซ้ำกันในรายการเป้าหมาย: ${duplicateDeviceIds.join(', ')}`,
      );
    }

    const config = await this.prisma.config.findUnique({
      where: { id: dto.configId },
    });
    if (!config) {
      throw new NotFoundException(`ไม่พบ Config id ${dto.configId}`);
    }
    if (!APPLICABLE_CONFIG_STATUSES.includes(config.status)) {
      throw new ConflictException(
        `Config สถานะปัจจุบัน (${config.status}) ยังใช้สร้างแคมเปญไม่ได้ — ต้องผ่านการอนุมัติ (${APPLICABLE_CONFIG_STATUSES.join('/')}) ก่อน`,
      );
    }

    await this.assertTargetsDeployable(dto.targets, config);

    const campaign = await this.prisma.$transaction(async (tx) => {
      const createdCampaign = await tx.campaign.create({
        data: {
          name: dto.name,
          description: dto.description,
          payloadType: CampaignPayloadType.Config,
          configId: dto.configId,
          firmwareId: null,
          status: 'active',
          targetCount: dto.targets.length,
          createdBy: actor.id,
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

    // AuditLog (CLAUDE.md Audit Pattern) — never-throw เหมือนโมดูล config/device
    await this.logAudit('create', actor.id);

    return campaign;
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

  /**
   * ตรวจว่าอุปกรณ์เป้าหมายทุกเครื่องพร้อมรับแคมเปญนี้ไหม — รวมปัญหาทั้งหมด
   * เป็น 409 เดียว (ไม่ throw ทีละเครื่อง) ให้ Operation เห็นภาพรวมครั้งเดียว
   * ตอนแก้รายการเป้าหมายในตัว wizard เอง (ต่างจาก `device.service.ts` ที่เช็ค
   * ทีละเครื่องเพราะเป็น endpoint ต่อเครื่องอยู่แล้ว):
   * - ไม่พบ Device สำหรับ deviceId นั้น
   * - Device ยังไม่ `installed`
   * - deviceModel/protocol ของ Device ไม่ตรงกับ Config
   */
  private async assertTargetsDeployable(
    targets: { deviceId: string }[],
    config: { deviceModel: string; protocol: string },
  ): Promise<void> {
    const devices = await this.prisma.device.findMany({
      where: { deviceId: { in: targets.map((t) => t.deviceId) } },
    });
    const deviceByDeviceId = new Map(devices.map((d) => [d.deviceId, d]));

    const problems: string[] = [];
    for (const target of targets) {
      const device = deviceByDeviceId.get(target.deviceId);
      if (!device) {
        problems.push(`ไม่พบ Device deviceId ${target.deviceId}`);
        continue;
      }
      if (device.status !== TARGETABLE_DEVICE_STATUS) {
        problems.push(
          `Device ${target.deviceId} สถานะปัจจุบัน (${device.status}) ยังไม่พร้อมรับแคมเปญ — ต้องเป็น ${TARGETABLE_DEVICE_STATUS} (ติดตั้งจริงแล้ว) เท่านั้น`,
        );
        continue;
      }
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
