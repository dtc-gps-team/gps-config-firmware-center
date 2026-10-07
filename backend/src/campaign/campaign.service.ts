import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Campaign, CampaignTarget, Device } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';

/** ผู้ที่กำลังเรียก endpoint — มาจาก JWT payload ({ sub, role }) เสมอ (แต่ละ
 * module ประกาศ interface นี้เองซ้ำกัน ไม่ import ข้าม module — pattern เดียวกับ
 * config.service.ts / device.service.ts / task.service.ts) */
export interface ActingUser {
  id: string;
  role: string;
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

  findAll(): Promise<Campaign[]> {
    return this.prisma.campaign.findMany({ orderBy: { createdAt: 'desc' } });
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
   * ใน `$transaction` เดียว **MVP (มติ 2026-09-24): สมาชิกกลุ่ม fix ตอนสร้าง
   * เท่านั้น** ยังไม่มี endpoint เพิ่ม/ลบทีหลัง — ไม่มี payload/approval
   * เกี่ยวข้องตรงนี้เลย (ย้ายไปอยู่ที่ `CampaignRolloutService.create()` แทน)
   */
  async create(dto: CreateCampaignDto, actor: ActingUser): Promise<Campaign> {
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
      if (device.status !== GROUPABLE_DEVICE_STATUS) {
        problems.push(
          `Device ${target.deviceId} สถานะปัจจุบัน (${device.status}) ยังเข้ากลุ่มไม่ได้ — ต้องเป็น ${GROUPABLE_DEVICE_STATUS} (ติดตั้งจริงแล้ว) เท่านั้น`,
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
