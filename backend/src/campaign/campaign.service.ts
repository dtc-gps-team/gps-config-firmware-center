import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Campaign, CampaignPayloadType } from '@prisma/client';
import { APPLICABLE_CONFIG_STATUSES } from '../device/config-applier';
import { NotificationService } from '../notification/notification.service';
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

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
   * Campaign Wizard (#21) — สร้าง Campaign + CampaignTarget ต่ออุปกรณ์ +
   * Task ต่ออุปกรณ์ (ขั้น "มอบหมายผู้รับผิดชอบหน้างาน") ใน `$transaction`
   * เดียว ไม่มี queue เพราะเป็นแค่เขียน DB ของเราเอง (ตกลงกับ kittiphong แล้ว
   * — ดู RBAC_Matrix.md changelog แก้ครั้งที่ 26)
   *
   * v1 = "ส่งพร้อมกันหมด" ล้วน — ไม่มี draft/rollout strategy เลย ตอน submit
   * ก็ active ทันที (สร้าง Task ให้ครบทุกเป้าหมายรวดเดียว) ต่างจาก Config ที่มี
   * ขั้นตอนอนุมัติแยก — `CampaignStatus` ไม่มี approval workflow ของตัวเอง
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
    await this.assertAssigneesExist(dto.targets);

    const { campaign, tasks } = await this.prisma.$transaction(async (tx) => {
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

      const createdTasks = await tx.task.createManyAndReturn({
        data: dto.targets.map((target) => ({
          title: `แคมเปญ "${dto.name}" — ติดตั้ง Config "${config.name}"`,
          description: `อุปกรณ์ ${target.deviceId}`,
          assignedTo: target.assignedTo,
          deviceId: target.deviceId,
          configId: dto.configId,
          campaignId: createdCampaign.id,
        })),
      });

      return { campaign: createdCampaign, tasks: createdTasks };
    });

    // AuditLog (CLAUDE.md Audit Pattern) — never-throw เหมือนโมดูล config/device
    await this.logAudit('create', actor.id);
    // แจ้งเตือนผู้รับผิดชอบแต่ละเครื่อง — never-throw (mirror
    // TaskService.notifyTaskAssigned) push ล้มเหลวต้องไม่ทำให้แคมเปญที่สร้าง
    // สำเร็จแล้วดูเหมือนล้มเหลวไปด้วย
    await this.notifyAssignees(tasks);

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

  /**
   * ตรวจว่าผู้รับผิดชอบทุกคนมีอยู่จริง+active — `Task.assignedTo` มี FK ไป
   * `User.id` จริง (ต่างจาก `CampaignTarget.deviceId` ที่หลวม) ถ้าไม่เช็คก่อน
   * `createManyAndReturn` จะโยน FK violation ดิบๆ ที่แปลเป็น error message
   * ให้ผู้ใช้เข้าใจยาก — เช็คล่วงหน้าแล้วคืน 400 ที่อ่านง่ายกว่าแทน
   */
  private async assertAssigneesExist(
    targets: { assignedTo: string }[],
  ): Promise<void> {
    const assigneeIds = [...new Set(targets.map((t) => t.assignedTo))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: assigneeIds } },
    });
    const activeUserIds = new Set(
      users.filter((u) => u.isActive).map((u) => u.id),
    );
    const missing = assigneeIds.filter((id) => !activeUserIds.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(
        `ผู้รับผิดชอบต่อไปนี้ไม่พบหรือถูกปิดใช้งาน: ${missing.join(', ')}`,
      );
    }
  }

  private async notifyAssignees(
    tasks: { id: string; title: string; assignedTo: string }[],
  ): Promise<void> {
    for (const task of tasks) {
      try {
        await this.notificationService.send({
          userId: task.assignedTo,
          type: 'task_assigned',
          payload: { taskId: task.id, title: task.title },
        });
      } catch (err) {
        this.logger.warn(
          `แจ้งเตือน task_assigned ไม่สำเร็จ (campaign task ${task.id}, user ${task.assignedTo}): ${(err as Error).message}`,
        );
      }
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
