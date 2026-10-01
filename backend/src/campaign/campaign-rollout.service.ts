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
  Prisma,
} from '@prisma/client';
import {
  APPROVABLE_CAMPAIGN_ROLLOUT_STATUS,
  AUTO_PAUSE_FAILURE_RATE_THRESHOLD,
  OPEN_CAMPAIGN_ROLLOUT_STATUSES,
  RESUMABLE_CAMPAIGN_ROLLOUT_STATUS,
  ROLLBACKABLE_CAMPAIGN_ROLLOUT_STATUSES,
} from './campaign-rollout-status';
import type { AuditLogMetadata } from '../audit/audit-log-metadata';
import {
  APPLICABLE_CONFIG_STATUSES,
  CONFIG_APPLIER,
  type ConfigApplier,
} from '../device/config-applier';
import { mergeApprovedOverride } from '../device/config-override-merge';
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
    @Inject(CONFIG_APPLIER)
    private readonly configApplier: ConfigApplier,
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

    // เช็ค "มีรอบเปิดอยู่ไหม" + สร้าง rollout ต้องอยู่ใน transaction เดียวกัน
    // (แก้ตาม review B บน PR #224) — เดิมเช็คนอก transaction ทำให้ 2 requests
    // ที่ยิงพร้อมกัน (double-click/concurrent) ผ่านเช็คนี้ได้ทั้งคู่แล้วสร้าง
    // rollout ซ้อนกัน ขัด "กลุ่มหนึ่งรัน rollout ได้ทีละรอบ" — ใช้ Serializable
    // isolation ให้ Postgres detect ความขัดแย้งของ read-then-write นี้เอง (อีก
    // request จะได้ serialization error แทนที่จะเห็นทั้งคู่ผ่าน)
    const rollout = await this.prisma.$transaction(
      async (tx) => {
        const openRollout = await tx.campaignRollout.findFirst({
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
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

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

    // race condition (mirror DeviceConfigOverride approve/reject, PR #225):
    // เดิม findOne() เช็คสถานะนอก transaction แล้ว update({ where: { id } })
    // โดยไม่เช็ค status ซ้ำข้างใน — Operation 2 คนกด approve/reject พร้อมกัน
    // ผ่านได้ทั้งคู่ แก้ด้วย updateMany({ where: { id, status:
    // APPROVABLE_CAMPAIGN_ROLLOUT_STATUS } }) ใน $transaction เดียวกัน
    // count === 0 แปลว่ามีคนอื่นตัดสินใจไปแล้วระหว่างที่เรารออยู่ → 409
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.campaignRollout.updateMany({
        where: { id, status: APPROVABLE_CAMPAIGN_ROLLOUT_STATUS },
        data: {
          status: 'active',
          approvedBy: actor.id,
          approvedAt: new Date(),
          // เริ่มหน้าต่างคำนวณ Auto Pause ใหม่ (#235 review รอบ 3 ข้อ 1) — ดู
          // comment เหนือ field นี้ใน schema.prisma
          activeWindowStartedAt: new Date(),
        },
      });
      if (result.count === 0) {
        throw new ConflictException(
          'Rollout นี้ถูกตัดสินใจไปแล้ว (มีคำขออนุมัติ/ปฏิเสธอื่นเข้ามาพร้อมกัน) — กรุณาโหลดข้อมูลใหม่',
        );
      }
      return tx.campaignRollout.findUniqueOrThrow({ where: { id } });
    });

    await this.logAudit('approve', actor.id);

    // Auto-apply ทันทีตอน active (มติ 2026-09-29 — ระบบเป็น PULL model จริง
    // กล่องดึง Config/Firmware เองอัตโนมัติจาก data กลาง ไม่มีเหตุผลให้ต้องรอ
    // ช่างกดยืนยันที่เครื่องผ่าน Mobile เหมือนเดิม (นั่นเป็นแค่ placeholder
    // ที่คิดขึ้นเพื่อขอบเขตฝึกงาน — ดู comment เหนือ
    // `DeviceService.confirmFirmwareInstall()`) ทำ**หลัง**อัปเดต status เป็น
    // active แล้วเท่านั้น (ไม่ทำใน transaction เดียวกับด้านบน เพราะเป็นงานที่
    // "อาจ fail บางเครื่อง" ต่างจากการอนุมัติเองที่ทำสำเร็จแน่นอน) —
    // Firmware Rollback ยังคงเร็วกว่าปกติเหมือนเดิม (ของเก่ายังอยู่บนอีก
    // พาร์ทิชันอยู่แล้ว ใช้ `FirmwareRollbackExecutor` แทนการเขียน Firmware
    // ใหม่) ส่วน Config (ทั้งปกติและ Rollback) กับ Firmware ปกติ ใช้ loop
    // auto-apply ใหม่ร่วมกัน — ดู comment เหนือ `autoApplyConfig`/
    // `autoApplyFirmware` เรื่องการรักษา Auto Pause ให้ยังมีความหมายอยู่
    return this.dispatchAutoApply(updated, actor.id);
  }

  /**
   * เลือก auto-apply path ตาม payload — ใช้ร่วมกันโดย `approve()` (เริ่ม
   * apply ครั้งแรก) และ `resume()` (#235 review รอบ 2 — apply ต่อให้ target
   * ที่ยังค้าง `pending` หลัง Auto Pause ปลด เดิม `resume()` แค่เปลี่ยน status
   * เป็น `active` เฉยๆ ไม่เคยเรียก auto-apply ต่อเลย ทำให้เครื่องที่เหลือค้าง
   * `pending` ตลอดไปเพราะไม่มีช่างกด Mobile ยืนยันอีกต่อไปตั้งแต่เปลี่ยนมาเป็น
   * PULL model) — `isRollback && payloadType === 'Firmware'` แทบไม่เกิดขึ้น
   * จริงตอนเรียกจาก `resume()` เพราะ `executeFirmwarePartitionRollback()` ไม่
   * เคยพา Rollout ไป `paused` เลย (ไม่ผ่าน `recordTargetResult()`) แต่เช็คไว้
   * เพื่อความสมมาตรกับ `approve()` เผื่อกรณีข้อมูลผิดปกติ
   */
  private dispatchAutoApply(
    rollout: CampaignRollout,
    actorId: string,
  ): Promise<CampaignRollout> {
    if (rollout.isRollback && rollout.payloadType === 'Firmware') {
      return this.executeFirmwarePartitionRollback(rollout);
    }
    if (rollout.payloadType === 'Config') {
      return this.autoApplyConfig(rollout, actorId);
    }
    return this.autoApplyFirmware(rollout, actorId);
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

    // race condition — เดียวกับ approve() ด้านบน
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.campaignRollout.updateMany({
        where: { id, status: APPROVABLE_CAMPAIGN_ROLLOUT_STATUS },
        data: { status: 'rejected' },
      });
      if (result.count === 0) {
        throw new ConflictException(
          'Rollout นี้ถูกตัดสินใจไปแล้ว (มีคำขออนุมัติ/ปฏิเสธอื่นเข้ามาพร้อมกัน) — กรุณาโหลดข้อมูลใหม่',
        );
      }
      return tx.campaignRollout.findUniqueOrThrow({ where: { id } });
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
   *
   * **เรียก `dispatchAutoApply()` ต่อทันที (#235 review รอบ 2)** — เดิมแค่
   * เปลี่ยน status เป็น `active` เฉยๆ ไม่เคย apply target ที่ยัง `pending`
   * ต่อเลย กลายเป็นทางตัน (Auto Pause หยุดแล้ว resume ก็ไม่ได้ไปต่อจริง) ตั้งแต่
   * เปลี่ยนมาเป็น PULL model ที่ไม่มีช่างกด Mobile ยืนยันทีละเครื่องอีกต่อไป —
   * `dispatchAutoApply()`/`autoApplyConfig()`/`autoApplyFirmware()` query
   * target สถานะ `pending` สดจาก DB เองอยู่แล้ว (ไม่ผูกกับ target ชุดเดิมตอน
   * approve() ครั้งแรก) จึงหยิบเฉพาะเครื่องที่ยังไม่ถูกแตะมาทำต่อได้ถูกต้องเลย
   * โดยไม่ต้องเปลี่ยนโค้ดใน 2 ฟังก์ชันนั้นแม้แต่บรรทัดเดียว
   *
   * **#235 review รอบ 3:** เพิ่ม race-condition guard (ข้อ 2, mirror
   * approve()) และรีเซ็ต `activeWindowStartedAt` (ข้อ 1 — กัน resume แล้ว
   * pause ซ้ำทันทีหลังแตะแค่เครื่องเดียว เพราะ failure rate เดิมคำนวณสะสม
   * ตั้งแต่ต้น rollout ไม่เคยรีเซ็ต)
   */
  async resume(id: string, actor: ActingUser): Promise<CampaignRollout> {
    await this.findOne(id); // 404 ถ้าไม่พบ

    // race condition (#235 review รอบ 3 ข้อ 2 — mirror approve()/reject()):
    // เดิมเช็คสถานะนอก transaction แล้ว update({ where: { id } }) โดยไม่เช็ค
    // status ซ้ำข้างใน — กดปุ่ม resume ซ้ำ (เช่น double-click หรือ client
    // retry หลัง timeout) จะวน dispatchAutoApply() ซ้ำบน target ชุดเดียวกัน
    // ได้ (apply ซ้ำ + audit row ซ้ำ) แก้ด้วย updateMany({ where: { id,
    // status: RESUMABLE... } }) — count === 0 แปลว่ามีคำขออื่นทำสำเร็จไปแล้ว
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.campaignRollout.updateMany({
        where: { id, status: RESUMABLE_CAMPAIGN_ROLLOUT_STATUS },
        data: {
          status: 'active',
          // เริ่มหน้าต่างคำนวณ Auto Pause ใหม่ (#235 review รอบ 3 ข้อ 1) — ดู
          // comment เหนือ field นี้ใน schema.prisma — ไม่งั้น failure ที่เคย
          // ทำให้ pause รอบก่อนจะยังถูกนับรวมต่อ ทำให้ resume แล้ว apply ได้
          // แค่เครื่องเดียวก่อนโดน pause ซ้ำทันทีเกือบทุกครั้ง
          activeWindowStartedAt: new Date(),
        },
      });
      if (result.count === 0) {
        throw new ConflictException(
          `Rollout นี้ถูกตัดสินใจไปแล้ว (ไม่ใช่สถานะ ${RESUMABLE_CAMPAIGN_ROLLOUT_STATUS} อีกต่อไป) — กรุณาโหลดข้อมูลใหม่`,
        );
      }
      return tx.campaignRollout.findUniqueOrThrow({ where: { id } });
    });

    await this.logAudit('resume', actor.id);
    return this.dispatchAutoApply(updated, actor.id);
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
      // ปิดรอบเดิมที่ยังค้าง 'active'/'paused' ก่อนสร้างรอบ rollback ใหม่
      // (#238 review B รอบ 2 ข้อ 2) — เดิมไม่ cancel รอบเก่าเลย ทำให้: การ์ด
      // "Rollout หยุดชั่วคราว (Auto Pause)" ยังนับรอบนี้ต่อ, Campaign Monitor
      // โชว์ปุ่มแค่ของ `rollouts[0]` เลยบังรอบเก่าไว้, และกด Resume จากหน้า
      // Rollout Detail ของรอบเก่าได้ จะเกิด rollout `active` 2 รอบพร้อมกันใน
      // กลุ่มเดียว — `completed` ไม่ต้อง cancel เพราะจบแล้วจริง ไม่ค้างอะไร
      // ใช้ updateMany + เช็ค status เดิม (atomic, mirror approve()/resume())
      // กันแข่งกับ resume()/recordTargetResult() ที่อาจเปลี่ยนสถานะรอบเก่า
      // พร้อมกันพอดี
      if (badRollout.status === 'active' || badRollout.status === 'paused') {
        const cancelled = await tx.campaignRollout.updateMany({
          where: { id: rolloutId, status: badRollout.status },
          data: { status: 'cancelled' },
        });
        if (cancelled.count === 0) {
          throw new ConflictException(
            `Rollout นี้ถูกเปลี่ยนสถานะไปแล้วระหว่างทำรายการ (ไม่ใช่ ${badRollout.status} อีกต่อไป) — กรุณาโหลดข้อมูลใหม่`,
          );
        }
      }

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

  /**
   * Auto-apply Config ให้ทุกเครื่องเป้าหมายทันทีตอน Rollout เป็น `active`
   * (มติ 2026-09-29 — PULL model จริง ไม่มีเหตุผลให้ต้องรอช่างกดยืนยันที่
   * เครื่องผ่าน Mobile เหมือนเดิม) ใช้ทั้ง Rollout ปกติและ Config Rollback
   * ร่วมกัน (ไม่ต้องแยกเหมือน Firmware เพราะ Config ไม่มี fast-path แบบ Dual
   * Partition — Config เขียนทับตรงๆ ทุกครั้งไม่ว่าจะเป็นค่าใหม่หรือค่าเก่าที่
   * rollback กลับไป)
   *
   * **ยังคง Auto Pause ไว้ได้แม้ apply ทุกเครื่องในคำเรียกเดียว** — เช็ค
   * สถานะ rollout สดใหม่จาก DB ก่อนแตะเครื่องถัดไปทุกรอบ ถ้ารอบก่อนหน้าทำให้
   * status เปลี่ยนจาก `active` ไปแล้ว (เช่น `paused` จาก Auto Pause ที่
   * `recordTargetResult()` ทำให้) หยุด loop ทันที ไม่แตะเครื่องที่เหลือ —
   * เครื่องที่เหลือค้าง `pending` รอ `resume()`/`rollback()` ต่อ มิเรอร์วิธี
   * ทำงานของ Canary/Batch จริงที่ต้องหยุดก่อนกระทบเครื่องเพิ่ม ไม่ใช่ยิงทุก
   * เครื่องพร้อมกันจนไม่มีจังหวะให้ตรวจจับปัญหาเลย
   *
   * reuse `recordTargetResult()` ทำ update/count/Auto Pause/completed ให้
   * ทั้งหมด — ไม่เขียนตรรกะซ้ำ
   *
   * **Known limitation (#235 review รอบ 2, ข้อ 5 — ยังไม่แก้รอบนี้):** ทำงาน
   * ทั้งหมดในคำเรียก HTTP เดียว วนทีละเครื่องแบบ sequential + query
   * `campaignRollout.findUniqueOrThrow` ซ้ำทุกรอบ (N+1) กลุ่มอุปกรณ์ขนาดใหญ่
   * เสี่ยง timeout — ควรย้ายเป็น background job ในอนาคต (มี job runner ของ
   * `config-sync-writer` อยู่แล้วที่พอจะ reuse pattern ได้)
   */
  private async autoApplyConfig(
    rollout: CampaignRollout,
    actorId: string,
  ): Promise<CampaignRollout> {
    if (!rollout.configId) return rollout; // defensive — ไม่ควรเกิดขึ้นจริง
    const configId = rollout.configId;

    const config = await this.prisma.config.findUnique({
      where: { id: configId },
    });

    const targets = await this.prisma.campaignRolloutTarget.findMany({
      where: { rolloutId: rollout.id, status: 'pending' },
      orderBy: { createdAt: 'asc' },
    });

    // #235 review รอบ 3 ข้อ 3 + รอบ 4 ข้อ 4/5 — mirror เงื่อนไข 4xx ของ
    // `DeviceService.applyConfig()` ที่ auto-apply ข้ามไปเลย: `create()`
    // validate Config ไว้ตอนสร้าง Rollout ก็จริง แต่เวลาผ่านไปได้ (โดยเฉพาะ
    // รอ Operation resume หลัง Auto Pause) Config อาจถูก soft-delete หรือถอน
    // อนุมัติระหว่างนั้น หรือ (แทบไม่เกิดจริง) หายไปเลย — เช็คซ้ำสดๆ ตรงนี้ก่อน
    // apply จริง ถ้าไม่ผ่านให้ fail ทุกเครื่องที่ยัง pending พร้อมเหตุผลเดียวกัน
    // แทนที่จะเงียบๆ push ค่าที่ไม่ควร push ไปแล้ว หรือ (กรณี `!config` เดิม)
    // return เฉยๆ ปล่อย Rollout ค้าง active ไม่มีทางกู้คืน (ไม่ throw ออกจาก
    // request — mirror หลักการ "ไม่ปล่อยให้ loop ทำให้ Rollout ค้าง active"
    // ข้อ 3 เดิม) — log audit ด้วยทุกเครื่องที่ fail จากจุดนี้ (รอบ 4 ข้อ 5:
    // เดิมไม่มี audit row เลยสำหรับ branch นี้ ทั้งที่ outcome อื่นทุกแบบมี)
    const configStillValid =
      !!config &&
      config.deletedAt === null &&
      APPLICABLE_CONFIG_STATUSES.includes(config.status);
    if (!configStillValid) {
      const reason = !config
        ? `ไม่พบ Config id ${configId}`
        : `Config สถานะปัจจุบัน (${config.status}${config.deletedAt ? ', ถูกลบไปแล้ว' : ''}) ใช้งานไม่ได้อีกต่อไป`;
      for (const target of targets) {
        const claimed = await this.recordTargetResult(
          target.deviceId,
          { configId },
          false,
          reason,
          rollout.id,
        );
        if (claimed) {
          await this.logAudit('apply-config', actorId, {
            deviceId: target.deviceId,
            configId,
            fieldNames: [],
          });
        }
      }
      return this.prisma.campaignRollout.findUniqueOrThrow({
        where: { id: rollout.id },
      });
    }

    const devices = await this.loadTargetDevices(
      targets.map((t) => ({ deviceId: t.deviceId })),
    );

    for (const target of targets) {
      const current = await this.prisma.campaignRollout.findUniqueOrThrow({
        where: { id: rollout.id },
      });
      if (current.status !== 'active') break;

      const device = devices.get(target.deviceId);
      if (!device) {
        await this.recordTargetResult(
          target.deviceId,
          { configId: config.id },
          false,
          `ไม่พบ Device deviceId ${target.deviceId}`,
          rollout.id,
        );
        continue;
      }

      // #235 review รอบ 3 ข้อ 3 — เช็คต่อเครื่องเหมือน `DeviceService.applyConfig()`
      // (device.status ต้อง installed, deviceModel/protocol ต้องตรง Config)
      // เผื่อเครื่องถูก decommission หรือเปลี่ยนรุ่นไประหว่างรอ resume
      if (device.status !== TARGETABLE_DEVICE_STATUS) {
        await this.recordTargetResult(
          device.deviceId,
          { configId: config.id },
          false,
          `Device สถานะปัจจุบัน (${device.status}) ไม่ใช่ ${TARGETABLE_DEVICE_STATUS} อีกต่อไป`,
          rollout.id,
        );
        continue;
      }
      if (
        config.deviceModel !== device.deviceModel ||
        config.protocol !== device.protocol
      ) {
        await this.recordTargetResult(
          device.deviceId,
          { configId: config.id },
          false,
          `Config นี้เป็นของ ${config.deviceModel}/${config.protocol} ไม่ตรงกับอุปกรณ์ ${device.deviceModel}/${device.protocol}`,
          rollout.id,
        );
        continue;
      }

      // #235 review รอบ 2 ข้อ error กลางลูป — ครอบทั้งช่วง merge/apply/log
      // ด้วย try/catch กันไม่ให้ error ที่ยังไม่คาดคิดจาก ConfigApplier จริง
      // ในอนาคต (ตอนนี้ MockConfigApplier ไม่ throw แต่ interface เปิดไว้ให้
      // implementation จริงทำได้) โยนขึ้นไปจน request 500 กลางทาง ปล่อย
      // Rollout ค้าง `active` พร้อม target ที่เหลือเป็น `pending` ตลอดไป (ไม่มี
      // ทาง resume ต่อเพราะสถานะไม่ใช่ `paused`) — เครื่องที่ throw นับเป็น
      // failed แทน ได้ Auto Pause ต่อโดยธรรมชาติผ่าน `recordTargetResult()`
      // เหมือนกรณี applied:false ปกติ ส่วนเครื่องถัดไปยังทำต่อได้ (ไม่ throw
      // ซ้ำทั้งลูป)
      try {
        // merge per-device override ที่ approved แล้วทับ base ก่อนส่งเข้า
        // applier — ต้องทำ**ต่อเครื่อง**ในลูป ไม่ใช่คำนวณครั้งเดียวนอกลูปจาก
        // base config เฉยๆ ไม่งั้น Campaign จะเขียนทับค่าที่ Operation เพิ่ง
        // อนุมัติให้เครื่องนั้นไว้แบบเงียบๆ (#235 review comment ข้อ 1 — mirror
        // `DeviceService.applyConfig()` ทุกประการผ่าน `mergeApprovedOverride()`
        // ร่วมกัน)
        const { fields } = await mergeApprovedOverride(
          this.prisma,
          device.deviceId,
          config.id,
          config.fields,
        );

        // Known limitation (#235 review รอบ 5 ข้อ 2): claim target
        // (recordTargetResult) เกิดหลัง apply จริง (applyConfig) ไม่ใช่ก่อน
        // ถ้า approve() และ resume() ทำงานชนกันบน rollout เดียว ทั้งสอง loop
        // อาจเรียก apply ซ้ำบนอุปกรณ์เดียวกันก่อนที่ claim จะไปแพ้ที่หลัง
        // ตอนนี้ไม่กระทบเพราะ ConfigApplier ยังเป็น mock แต่ก่อนเปลี่ยนเป็น
        // implementation จริง (docker/production) ต้องย้าย claim ไปก่อน apply
        // เช่น เพิ่มสถานะกลาง 'applying' ให้ target ก่อนเรียก applier จริง
        const result = await this.configApplier.applyConfig({
          deviceId: device.deviceId,
          deviceModel: device.deviceModel,
          protocol: device.protocol,
          fields,
        });
        const claimed = await this.recordTargetResult(
          device.deviceId,
          { configId: config.id },
          result.applied,
          result.details.join(' · '),
          rollout.id,
        );

        // AuditLog รายเครื่อง (#235 review comment ข้อ 2 — CLAUDE.md Audit
        // Pattern: "นำ Config ไปใช้" ต้องลง log ทุกครั้ง) mirror
        // `DeviceService.applyConfig()` ทุกประการ (action/metadata shape
        // เดียวกัน) ต่างกันแค่ userId เป็นผู้ที่กด approve Rollout แทนที่จะเป็น
        // ผู้กด apply-config เอง — log ไม่ว่าผล applied จะ true/false เพื่อน
        // ให้เห็นร่องรอยครบทุกเครื่องที่ auto-apply แตะถึง — **เว้นแต่**
        // `claimed` เป็น false (#235 review รอบ 4 ข้อ 2 — target ถูกคำขออื่น
        // claim ไปก่อนแล้วจาก race, ไม่ควร log audit ซ้ำสำหรับเหตุการณ์ที่ไม่ได้
        // เกิดขึ้นจริงจากฝั่งเรา)
        if (claimed) {
          await this.logAudit('apply-config', actorId, {
            deviceId: device.deviceId,
            configId: config.id,
            fieldNames: Object.keys(fields),
          });
        }
      } catch (err) {
        const claimed = await this.recordTargetResult(
          device.deviceId,
          { configId: config.id },
          false,
          `auto-apply ล้มเหลว: ${(err as Error).message}`,
          rollout.id,
        );
        // #235 review รอบ 3 ข้อ 5 — เดิมถ้า throw กลางทางจะไม่มี audit row
        // `apply-config` เลย ทำให้ไม่มีบันทึกว่าเคยพยายาม apply เครื่องนี้
        // (ต่างจากเส้นทางสำเร็จ/ล้มเหลวแบบปกติที่ log เสมอ) — log ไว้แม้ throw
        // เหมือนกัน ไม่รู้ fieldNames จริงตอนนี้ (mergeApprovedOverride อาจ
        // throw ก่อนคำนวณ fields เสร็จ) ใส่ array ว่างไว้แทน — เว้นแต่ claimed
        // เป็น false เหมือนกัน (รอบ 4 ข้อ 2)
        if (claimed) {
          await this.logAudit('apply-config', actorId, {
            deviceId: device.deviceId,
            configId: config.id,
            fieldNames: [],
          });
        }
      }
    }

    return this.prisma.campaignRollout.findUniqueOrThrow({
      where: { id: rollout.id },
    });
  }

  /**
   * Auto-apply Firmware (ปกติ ไม่ใช่ Rollback) ให้ทุกเครื่องเป้าหมายทันทีตอน
   * `active` — เหตุผล/วิธีรักษา Auto Pause เดียวกับ `autoApplyConfig` (มติ
   * 2026-09-29: กล่องดึง Firmware เองจาก server กลางเหมือน Config ทุกประการ
   * ไม่ใช่แค่ Config) ทำ Dual Partition bookkeeping มิเรอร์
   * `DeviceService.confirmFirmwareInstall()` เป๊ะ (เขียน Firmware ใหม่ลง
   * พาร์ทิชันที่ไม่ active แล้วสลับ) — **ต่างจาก**
   * `executeFirmwarePartitionRollback()` ที่ใช้ `FirmwareRollbackExecutor`
   * (fast-path เพราะของเก่ายังอยู่บนพาร์ทิชันเดิมอยู่แล้ว) ตัวนี้เป็น
   * Firmware ใหม่ที่ไม่เคยอยู่บนพาร์ทิชันไหนมาก่อน จึงเขียนตรงๆ ไม่ผ่าน
   * executor · นับ target ว่า failed ถ้าเขียน Dual Partition bookkeeping ไม่
   * สำเร็จ (#235 review comment ข้อ 4 — เดิมรายงาน success เสมอแม้
   * bookkeeping ล้มเหลว หลบ Auto Pause ไปเงียบๆ)
   */
  private async autoApplyFirmware(
    rollout: CampaignRollout,
    actorId: string,
  ): Promise<CampaignRollout> {
    if (!rollout.firmwareId) return rollout; // defensive — ไม่ควรเกิดขึ้นจริง
    const firmwareId = rollout.firmwareId;

    const firmware = await this.prisma.firmware.findUnique({
      where: { id: firmwareId },
    });

    const targets = await this.prisma.campaignRolloutTarget.findMany({
      where: { rolloutId: rollout.id, status: 'pending' },
      orderBy: { createdAt: 'asc' },
    });

    // #235 review รอบ 3 ข้อ 4 + รอบ 4 ข้อ 4/5 — mirror เงื่อนไข 4xx ของ
    // `DeviceService.confirmFirmwareInstall()` ที่ auto-apply ข้ามไปเลย
    // (เหตุผลเดียวกับ autoApplyConfig ข้างบน — เวลาผ่านไปได้ระหว่างรอ resume
    // Firmware อาจถูกถอนอนุมัติคุณภาพ หรือ (แทบไม่เกิดจริง) หายไปเลย — log
    // audit ด้วยทุกเครื่องที่ fail จากจุดนี้เหมือน autoApplyConfig)
    const firmwareStillValid =
      !!firmware &&
      firmware.uploadStatus === SIMULATABLE_FIRMWARE_STATUS &&
      firmware.approvalStatus === CAMPAIGN_ELIGIBLE_FIRMWARE_APPROVAL_STATUS;
    if (!firmwareStillValid) {
      const reason = !firmware
        ? `ไม่พบ Firmware id ${firmwareId}`
        : `Firmware สถานะปัจจุบัน (upload: ${firmware.uploadStatus}, อนุมัติคุณภาพ: ${firmware.approvalStatus}) ใช้งานไม่ได้อีกต่อไป`;
      for (const target of targets) {
        const claimed = await this.recordTargetResult(
          target.deviceId,
          { firmwareId },
          false,
          reason,
          rollout.id,
        );
        if (claimed) {
          await this.logAudit('confirm-firmware-install', actorId, {
            deviceId: target.deviceId,
            firmwareId,
          });
        }
      }
      return this.prisma.campaignRollout.findUniqueOrThrow({
        where: { id: rollout.id },
      });
    }

    const devices = await this.loadTargetDevices(
      targets.map((t) => ({ deviceId: t.deviceId })),
    );

    for (const target of targets) {
      const current = await this.prisma.campaignRollout.findUniqueOrThrow({
        where: { id: rollout.id },
      });
      if (current.status !== 'active') break;

      const device = devices.get(target.deviceId);
      if (!device) {
        await this.recordTargetResult(
          target.deviceId,
          { firmwareId: firmware.id },
          false,
          `ไม่พบ Device deviceId ${target.deviceId}`,
          rollout.id,
        );
        continue;
      }

      // #235 review รอบ 3 ข้อ 4 — เช็คต่อเครื่องเหมือน
      // `DeviceService.confirmFirmwareInstall()` (device.status ต้อง
      // installed, รุ่นอุปกรณ์ต้องอยู่ใน deviceModelCompatibility)
      if (device.status !== TARGETABLE_DEVICE_STATUS) {
        await this.recordTargetResult(
          device.deviceId,
          { firmwareId: firmware.id },
          false,
          `Device สถานะปัจจุบัน (${device.status}) ไม่ใช่ ${TARGETABLE_DEVICE_STATUS} อีกต่อไป`,
          rollout.id,
        );
        continue;
      }
      if (!firmware.deviceModelCompatibility.includes(device.deviceModel)) {
        await this.recordTargetResult(
          device.deviceId,
          { firmwareId: firmware.id },
          false,
          `Firmware นี้ไม่รองรับรุ่นอุปกรณ์ ${device.deviceModel} (รองรับ: ${firmware.deviceModelCompatibility.join(', ')})`,
          rollout.id,
        );
        continue;
      }

      const nextPartition = device.activePartition === 'A' ? 'B' : 'A';
      // #235 review comment ข้อ 4 — เดิม catch แค่ log warn แล้วยังรายงาน
      // success เสมอทั้งที่ bookkeeping เขียนไม่สำเร็จจริง กลายเป็นหลบ Auto
      // Pause ไปเงียบๆ (เครื่องนับว่า apply สำเร็จทั้งที่ activePartition ยัง
      // เป็นค่าเดิม) เปลี่ยนให้ partition write ล้มเหลว = target นับ failed จริง
      // Known limitation (#235 review รอบ 5 ข้อ 2): claim target
      // (recordTargetResult) เกิดหลัง apply จริง (เขียน partition) ไม่ใช่ก่อน
      // ถ้า approve() และ resume() ทำงานชนกันบน rollout เดียว ทั้งสอง loop
      // อาจเขียน partition ซ้ำบนอุปกรณ์เดียวกันก่อนที่ claim จะไปแพ้ที่หลัง
      // ตอนนี้ไม่กระทบเพราะ Dual Partition ยังเป็น mock แต่ก่อนเปลี่ยนเป็น
      // implementation จริง (docker/production) ต้องย้าย claim ไปก่อน apply
      // เช่น เพิ่มสถานะกลาง 'applying' ให้ target ก่อนเรียก applier จริง
      let partitionWriteSucceeded = true;
      try {
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
        partitionWriteSucceeded = false;
        this.logger.warn(
          `อัปเดต Dual Partition ไม่สำเร็จ (deviceId ${device.deviceId}): ${(err as Error).message}`,
        );
      }

      const claimed = await this.recordTargetResult(
        device.deviceId,
        { firmwareId: firmware.id },
        partitionWriteSucceeded,
        partitionWriteSucceeded
          ? `ติดตั้ง Firmware ${firmware.version} สำเร็จ (auto, mock)`
          : `เขียน Dual Partition bookkeeping ไม่สำเร็จ — ไม่นับว่าติดตั้งสำเร็จ`,
        rollout.id,
      );

      // AuditLog รายเครื่อง (#235 review comment ข้อ 2) mirror
      // `DeviceService.confirmFirmwareInstall()` — log ไม่ว่า partition write
      // จะสำเร็จหรือไม่ เพื่อให้เห็นร่องรอยครบทุกเครื่องที่ auto-apply แตะถึง —
      // เว้นแต่ claimed เป็น false (#235 review รอบ 4 ข้อ 2 — race, target
      // ถูกคำขออื่นจัดการไปแล้ว)
      if (claimed) {
        await this.logAudit('confirm-firmware-install', actorId, {
          deviceId: device.deviceId,
          firmwareId: firmware.id,
          firmwareVersion: firmware.version,
        });
      }
    }

    return this.prisma.campaignRollout.findUniqueOrThrow({
      where: { id: rollout.id },
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
   * ยัง `pending` ของ Rollout ที่ `active`/`paused` อยู่ ที่ตรงกับ
   * deviceId+payload นี้ แล้วอัปเดตผล + คำนวณ `successCount`/`failureCount`
   * ใหม่ ถ้าครบทุกเครื่องแล้วให้ปิด Rollout เป็น `completed`
   *
   * **เริ่มคิวรีจาก `CampaignRolloutTarget` scope ด้วย deviceId ก่อนเสมอ**
   * (แก้ตาม review B บน PR #224) — เดิมหา `CampaignRollout` ก่อนด้วยแค่
   * `status: active` + configId/firmwareId เฉยๆ ถ้า Config/Firmware เดียวกัน
   * ถูก push เข้า 2 กลุ่มพร้อมกัน (active ทั้งคู่) `findFirst` จะได้ rollout
   * ใดรอบหนึ่งแบบไม่รับประกันว่าอุปกรณ์เครื่องนี้เป็นเป้าหมายของรอบนั้นจริง —
   * ถ้าสุ่มได้รอบที่ไม่มีอุปกรณ์นี้เป็นเป้าหมาย ผลจะหายเงียบๆ (ไม่เจอ target
   * เลยไม่ทำอะไร) ทั้งที่รอบที่ถูกต้องยังค้าง `pending` อยู่ — คิวรีนี้ scope
   * ด้วย deviceId ตั้งแต่ต้นผ่านความสัมพันธ์ `rollout` แทน รับประกันว่า
   * rollout ที่ได้ต้องมีอุปกรณ์เครื่องนี้เป็นเป้าหมายจริงเสมอ
   *
   * **`rolloutId` เป็น optional param เพิ่มใหม่ (#235 review รอบ 4 ข้อ 1)**
   * — `autoApplyConfig()`/`autoApplyFirmware()` รู้ `rollout.id` อยู่แล้วใน
   * ลูป ส่งเข้ามาตัดความกำกวมได้เลยว่าให้ match แค่ target ของ rollout นี้
   * เท่านั้น (ไม่ข้ามไปโดน rollout อื่นที่ device+config/firmware เดียวกัน
   * บังเอิญ pending พร้อมกันอยู่) ส่วน path เดิมจาก
   * `DeviceService.applyConfig()`/`confirmFirmwareInstall()` (Mobile) ไม่มี
   * `rolloutId` ให้ส่ง คง query แบบเดิมทุกประการ (ไม่ต้องแก้ contract ของ
   * endpoint ที่ Mobile เรียก) — เดิมตั้งใจไม่ทำแบบนี้เพราะกลัวต้องแก้
   * contract ทั้งคู่ แต่จริงๆ แค่ทำเป็น optional ก็พอโดยไม่กระทบ path เดิมเลย
   *
   * **รวม `paused` ด้วย** (แก้ไข 2026-09-24, Auto Pause #28) — เครื่องที่
   * ช่างกำลังทำอยู่ตอน auto-pause เพิ่งเกิดยังต้องบันทึกผลได้ ไม่งั้นผลของ
   * เครื่องนั้นหายไปเฉยๆ ทั้งที่ช่างทำจริงไปแล้ว
   *
   * **claim target แบบ atomic ผ่าน `updateMany` (#235 review รอบ 4 ข้อ 2)**
   * — เดิม `update()` เปล่าๆ ไม่เช็คเงื่อนไขตอนเขียน ถ้ามี 2 คำขอมา match
   * target เดียวกันพร้อมกัน (เช่น approve() loop เดิมยังไม่ทันเช็คสถานะรอบ
   * ถัดไป ขณะที่ resume() เริ่ม loop ใหม่ทับ) ทั้งคู่จะ "เจอ" target เป็น
   * `pending` แล้วอัปเดตซ้ำทั้งคู่ นับ count ซ้ำ + trigger pause/complete ซ้ำ
   * — เปลี่ยนเป็น `updateMany({ where: { id, status: 'pending' } })` เช็ค
   * `count` แทน ถ้า 0 แปลว่ามีคำขออื่นชนะไปแล้วระหว่างที่เรา query เจอ target
   * (TOCTOU) ให้ถือว่า "ไม่ได้ทำอะไร" คืน `false` ไม่ recompute
   * count/pause/audit ซ้ำ
   *
   * **คืน `boolean`** (เดิม `void`) — `true` = claim+อัปเดตสำเร็จจริง (ผู้เรียก
   * ควร log audit ต่อ), `false` = ไม่เจอ target หรือมีคนอื่น claim ไปก่อน
   * (ไม่ควร log audit ซ้ำ) — `DeviceService.applyConfig()`/
   * `confirmFirmwareInstall()` (path เดิม) ไม่ได้ใช้ return value นี้ ไม่กระทบ
   *
   * **never-throw** — เป็นแค่ side-effect ติดตามผล ไม่ใช่ core contract ของ
   * apply-config/confirm-firmware-install เอง (mirror pattern `logAudit` ใน
   * ไฟล์นี้/`device.service.ts`) ถ้าไม่เจอ target ที่ match (เช่น apply
   * นอกแคมเปญ) log warning ไว้ debug แล้ว return เฉยๆ ไม่ throw
   */
  async recordTargetResult(
    deviceId: string,
    payload: { configId: string } | { firmwareId: string },
    success: boolean,
    detail: string,
    rolloutId?: string,
  ): Promise<boolean> {
    try {
      const target = await this.prisma.campaignRolloutTarget.findFirst({
        where: {
          deviceId,
          status: 'pending',
          ...(rolloutId ? { rolloutId } : {}),
          rollout: {
            status: { in: ['active', 'paused'] },
            ...('configId' in payload
              ? { configId: payload.configId }
              : { firmwareId: payload.firmwareId }),
          },
        },
        include: { rollout: true },
      });
      if (!target) {
        this.logger.warn(
          `recordTargetResult: ไม่พบ CampaignRolloutTarget ที่ pending ตรงกับ deviceId ${deviceId} + payload ${JSON.stringify(payload)} (ไม่มี Rollout active/paused ที่เครื่องนี้เป็นสมาชิกจริง หรือถูกบันทึกผลไปแล้ว) — ข้ามการอัปเดต Campaign Monitor`,
        );
        return false;
      }
      const rollout = target.rollout;

      return await this.prisma.$transaction(async (tx) => {
        const claim = await tx.campaignRolloutTarget.updateMany({
          where: { id: target.id, status: 'pending' },
          data: {
            status: success ? 'success' : 'failed',
            resultDetail: detail,
          },
        });
        if (claim.count === 0) {
          this.logger.warn(
            `recordTargetResult: target ${target.id} (deviceId ${deviceId}) ถูกคำขออื่น claim ไปแล้วระหว่างที่เรากำลังประมวลผล (race) — ข้าม ไม่นับซ้ำ`,
          );
          return false;
        }

        const [successCount, failureCount, pendingCount, windowFailureCount] =
          await Promise.all([
            tx.campaignRolloutTarget.count({
              where: { rolloutId: rollout.id, status: 'success' },
            }),
            tx.campaignRolloutTarget.count({
              where: { rolloutId: rollout.id, status: 'failed' },
            }),
            tx.campaignRolloutTarget.count({
              where: { rolloutId: rollout.id, status: 'pending' },
            }),
            // #235 review รอบ 3 ข้อ 1 — failure เฉพาะ "รอบปัจจุบัน" (ตั้งแต่
            // approve()/resume() ล่าสุด) แยกจาก failureCount สะสมทั้งประวัติ
            // ด้านบน (ที่ยังต้องคงไว้ตรงๆ ให้ผู้ใช้เห็นค่าจริง) — ไม่งั้นทุก
            // ครั้งที่ resume() แล้วมีผลใหม่เข้ามา failure ที่เคยทำให้ pause
            // ไปแล้วรอบก่อนจะยังถูกนับรวมอยู่ดี ทำให้ resume แล้ว apply ได้
            // แค่เครื่องเดียวก็โดน pause ซ้ำทันทีเกือบทุกครั้ง — ถ้าไม่มี
            // `activeWindowStartedAt` (ไม่ควรเกิดจริงกับ rollout ที่ active
            // อยู่ เพราะ approve()/resume() ตั้งเสมอ) fallback เป็นสะสมทั้งหมด
            rollout.activeWindowStartedAt
              ? tx.campaignRolloutTarget.count({
                  where: {
                    rolloutId: rollout.id,
                    status: 'failed',
                    updatedAt: { gte: rollout.activeWindowStartedAt },
                  },
                })
              : tx.campaignRolloutTarget.count({
                  where: { rolloutId: rollout.id, status: 'failed' },
                }),
          ]);

        // Auto Pause (Incident & Rollback #28, มติ 2026-09-24 — mirror
        // GPS_Config_Firmware_Center_Design.pdf §11.2/หลักการข้อ 22: "ต้อง
        // Auto Pause เมื่อ Failure เกิน Threshold") — เช็คแค่ตอนยัง `active`
        // เท่านั้น (ถ้า `paused` อยู่แล้วไม่ต้องเช็คซ้ำ, `completed` ชนะเสมอ
        // เมื่อ pending หมดไม่ว่า failure rate เท่าไหร่ — ดูค่าผ่าน
        // successCount/failureCount ได้อยู่แล้วตอนจบ ไม่มีประโยชน์ต้อง pause
        // งานที่จบไปแล้ว) — ใช้ windowFailureCount (รอบปัจจุบัน) ไม่ใช่
        // failureCount (สะสมทั้งหมด) เป็นตัวตั้งคำนวณ rate
        const failureRate =
          rollout.targetCount > 0
            ? windowFailureCount / rollout.targetCount
            : 0;
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
        return true;
      });
    } catch (err) {
      this.logger.warn(
        `บันทึกผล Campaign Rollout ไม่สำเร็จ (deviceId ${deviceId}): ${(err as Error).message}`,
      );
      return false;
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

  private async logAudit(
    action: string,
    userId: string,
    metadata?: AuditLogMetadata,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId,
          auditModule: AUDIT_MODULE,
          action,
          ...(metadata ? { metadata: metadata as Prisma.InputJsonValue } : {}),
        },
      });
    } catch (err) {
      this.logger.warn(
        `เขียน AuditLog ไม่สำเร็จ (module ${AUDIT_MODULE}, action ${action}, user ${userId}): ${(err as Error).message}`,
      );
    }
  }
}
