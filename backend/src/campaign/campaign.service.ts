import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Campaign, CampaignPayloadType, Device } from '@prisma/client';
import { APPROVABLE_CAMPAIGN_STATUS } from './campaign-status';
import { APPLICABLE_CONFIG_STATUSES } from '../device/config-applier';
import {
  CAMPAIGN_ELIGIBLE_FIRMWARE_APPROVAL_STATUS,
  SIMULATABLE_FIRMWARE_STATUS,
} from '../firmware/firmware-status';
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
   * v1 = "ส่งพร้อมกันหมด" ล้วน — ไม่มี draft/rollout strategy เลย
   *
   * **แก้ไข (แก้ครั้งที่ 39, Campaign Approval):** เดิม submit แล้ว `active`
   * ทันที — ปิด gap ที่ System Design PDF §9.1/§10.2/§19 ต้องการขั้นตอน
   * "ส่งอนุมัติ" ก่อนเข้าใช้งานจริง เปลี่ยนเป็น `pending_approval` แทน ต้องรอ
   * Operation อีกคน (ไม่ใช่ผู้สร้างเอง — ดู `approve()`/`reject()`) กดอนุมัติ
   * ก่อนถึงจะ `active`
   *
   * **แก้ไข 2026-09-14 (1):** เดิม step นี้สร้าง `Task` ต่ออุปกรณ์พร้อม
   * `assignedTo` ด้วย (มอบหมายผู้รับผิดชอบหน้างาน) — หัวหน้าแก้ scope ว่า
   * Campaign มีไว้ติดตาม/บำรุงรักษาอุปกรณ์เป็นกลุ่มเท่านั้น การมอบหมายงาน
   * ให้ช่างหน้างานเป็นหน้าที่ของระบบแยกที่บริษัทมีอยู่แล้ว ทำเองจะซ้อนทับ
   * ระบบ จึงตัดการสร้าง Task และการแจ้งเตือนผู้รับผิดชอบออกทั้งหมด เหลือแค่
   * Campaign + CampaignTarget (ดู RBAC_Matrix.md changelog)
   *
   * **แก้ไข 2026-09-14 (2):** เปิดรับ `payloadType: Firmware` แล้ว หลัง
   * Sprint 3 #23 (PR #151, backend `firmware` module) implement เสร็จ —
   * ตรวจสอบเหมือน Config ทุกประการ (payload ต้องพร้อมใช้งานจริง + อุปกรณ์
   * เป้าหมายต้องเข้ากันได้) ต่างกันแค่เกณฑ์ความเข้ากันได้: Config เทียบ
   * deviceModel+protocol ตรงเป๊ะ ส่วน Firmware เทียบแค่ deviceModel อยู่ใน
   * `deviceModelCompatibility` (ไม่มี field protocol ใน model Firmware เลย)
   */
  async create(dto: CreateCampaignDto, actor: ActingUser): Promise<Campaign> {
    const deviceIds = dto.targets.map((t) => t.deviceId);
    const duplicateDeviceIds = this.findDuplicates(deviceIds);
    if (duplicateDeviceIds.length > 0) {
      throw new BadRequestException(
        `มี deviceId ซ้ำกันในรายการเป้าหมาย: ${duplicateDeviceIds.join(', ')}`,
      );
    }

    const { configId, firmwareId } =
      dto.payloadType === CampaignPayloadType.Config
        ? await this.validateConfigPayload(dto)
        : await this.validateFirmwarePayload(dto);

    const campaign = await this.prisma.$transaction(async (tx) => {
      const createdCampaign = await tx.campaign.create({
        data: {
          name: dto.name,
          description: dto.description,
          payloadType: dto.payloadType,
          configId,
          firmwareId,
          status: 'pending_approval',
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

  /**
   * `POST /campaigns/{id}/approve` — Campaign Approval (แก้ครั้งที่ 39) —
   * Operation อนุมัติ Campaign ที่รอตัดสินใจอยู่ (`pending_approval` เท่านั้น
   * — 409 ถ้าไม่ใช่ mirror `FirmwareService.approve`) เปลี่ยนเป็น `active`
   * บันทึก `approvedBy`/`approvedAt`
   *
   * **Separation of Duty:** ต่างจาก Config (ConfigEngineer สร้าง / Operation
   * อนุมัติ คนละ role กันอยู่แล้วโดย RBAC) Campaign สร้างโดย Operation เอง —
   * ต้องเช็คที่นี่ว่าผู้กดอนุมัติไม่ใช่ผู้สร้างคนเดียวกัน (403) ไม่งั้น
   * Operation คนเดียวสร้าง+อนุมัติเองได้ ขัดหลัก SoD ที่ CLAUDE.md ระบุไว้
   */
  async approve(id: string, actor: ActingUser): Promise<Campaign> {
    const campaign = await this.findOne(id);
    this.assertDecidable(campaign, actor);

    const updated = await this.prisma.campaign.update({
      where: { id },
      data: { status: 'active', approvedBy: actor.id, approvedAt: new Date() },
    });

    await this.logAudit('approve', actor.id);
    return updated;
  }

  /**
   * `POST /campaigns/{id}/reject` — mirror `approve()` แต่เปลี่ยนเป็น
   * `rejected` แทน (แยกจาก `draft` โดยตั้งใจ — mirror `ConfigStatus.rejected`
   * ให้เห็นชัดว่าเคยถูกปฏิเสธมาก่อน) ไม่ตั้ง `approvedBy`/`approvedAt`
   * (คงเป็น null — ไม่มีใคร "อนุมัติ" การ reject) Operation แก้ไขแล้วส่ง
   * อนุมัติใหม่ได้ผ่าน `POST /campaigns` อีกครั้ง (ยังไม่มี endpoint แก้ไข
   * Campaign เดิม — รอ Campaign Monitor แถวที่ 22)
   */
  async reject(id: string, actor: ActingUser): Promise<Campaign> {
    const campaign = await this.findOne(id);
    this.assertDecidable(campaign, actor);

    const updated = await this.prisma.campaign.update({
      where: { id },
      data: { status: 'rejected' },
    });

    await this.logAudit('reject', actor.id);
    return updated;
  }

  private assertDecidable(campaign: Campaign, actor: ActingUser): void {
    if (campaign.status !== APPROVABLE_CAMPAIGN_STATUS) {
      throw new ConflictException(
        `สถานะ Campaign ปัจจุบัน (${campaign.status}) ไม่ใช่ ${APPROVABLE_CAMPAIGN_STATUS} จึงตัดสินใจไม่ได้`,
      );
    }
    if (campaign.createdBy === actor.id) {
      throw new ForbiddenException(
        'ผู้สร้าง Campaign อนุมัติ/ปฏิเสธ Campaign ของตัวเองไม่ได้ (Separation of Duty)',
      );
    }
  }

  /**
   * payloadType=Config — validate ครบแล้วคืน `{ configId, firmwareId: null }`
   * ให้ `create()` เขียนลง DB ตรงๆ (defensive ตาม `ValidateIf` บน DTO)
   */
  private async validateConfigPayload(
    dto: CreateCampaignDto,
  ): Promise<{ configId: string; firmwareId: null }> {
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
        `Config สถานะปัจจุบัน (${config.status}) ยังใช้สร้างแคมเปญไม่ได้ — ต้องผ่านการอนุมัติ (${APPLICABLE_CONFIG_STATUSES.join('/')}) ก่อน`,
      );
    }

    const devices = await this.loadTargetDevices(dto.targets);
    const problems = this.collectUnavailableDeviceProblems(
      dto.targets,
      devices,
    );
    for (const target of dto.targets) {
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
    dto: CreateCampaignDto,
  ): Promise<{ configId: null; firmwareId: string }> {
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
        `Firmware สถานะอัปโหลดปัจจุบัน (${firmware.uploadStatus}) ยังใช้สร้างแคมเปญไม่ได้ — ต้องเป็น "${SIMULATABLE_FIRMWARE_STATUS}" (จัดเก็บสำเร็จแล้ว) เท่านั้น`,
      );
    }
    // Firmware Approval Lifecycle (docs/13_Role_Redesign_Proposal.md §3.2) —
    // ต้องผ่านทั้ง uploadStatus (เช็คด้านบน) และ approvalStatus (QAEngineer
    // อนุมัติคุณภาพแล้ว) — คนละมิติกัน เช็คแยกกันคนละเงื่อนไข
    if (
      firmware.approvalStatus !== CAMPAIGN_ELIGIBLE_FIRMWARE_APPROVAL_STATUS
    ) {
      throw new ConflictException(
        `Firmware สถานะอนุมัติคุณภาพปัจจุบัน (${firmware.approvalStatus}) ยังใช้สร้างแคมเปญไม่ได้ — ต้องเป็น "${CAMPAIGN_ELIGIBLE_FIRMWARE_APPROVAL_STATUS}" (QAEngineer อนุมัติคุณภาพแล้ว) เท่านั้น`,
      );
    }

    const devices = await this.loadTargetDevices(dto.targets);
    const problems = this.collectUnavailableDeviceProblems(
      dto.targets,
      devices,
    );
    for (const target of dto.targets) {
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

  /**
   * เช็คส่วนที่ Config กับ Firmware ต้องการเหมือนกันทุกประการ — ไม่พบ Device
   * หรือ Device ยังไม่ `installed` — รวมทุกปัญหาเป็น 409 เดียว (ไม่ throw
   * ทีละเครื่อง) ให้ Operation เห็นภาพรวมครั้งเดียวตอนแก้รายการเป้าหมายในตัว
   * wizard เอง (ต่างจาก `device.service.ts` ที่เช็คทีละเครื่องเพราะเป็น
   * endpoint ต่อเครื่องอยู่แล้ว) — ส่วนเช็คความเข้ากันได้กับ payload (Config
   * deviceModel+protocol / Firmware deviceModelCompatibility) แยกไปทำต่อใน
   * `validateConfigPayload`/`validateFirmwarePayload` เพราะเกณฑ์ต่างกัน
   */
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
          `Device ${target.deviceId} สถานะปัจจุบัน (${device.status}) ยังไม่พร้อมรับแคมเปญ — ต้องเป็น ${TARGETABLE_DEVICE_STATUS} (ติดตั้งจริงแล้ว) เท่านั้น`,
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
