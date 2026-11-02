import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Firmware, FirmwareUploadStatus, Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import type { AuditLogMetadata } from '../audit/audit-log-metadata';
import { OPEN_CAMPAIGN_ROLLOUT_STATUSES } from '../campaign/campaign-rollout-status';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateFirmwareCompatibilityDto } from './dto/update-firmware-compatibility.dto';
import { lockFirmwareForDelete } from './firmware-lock';
import { FirmwareStorageService } from './firmware-storage.service';
import {
  FIRMWARE_SIMULATOR,
  type FirmwareSimulator,
  type SimulationResult,
} from './firmware-simulator';
import {
  DECIDABLE_FIRMWARE_APPROVAL_STATUS,
  SIMULATABLE_FIRMWARE_STATUS,
} from './firmware-status';

/** ผู้ที่กำลังเรียก endpoint — มาจาก JWT payload เสมอ (แต่ละ module ประกาศ
 * interface นี้เองซ้ำกัน ไม่ import ข้าม module — pattern เดียวกับ
 * config.service.ts / campaign.service.ts) */
export interface ActingUser {
  id: string;
  role: string;
  /** มาจาก `req.ip` ที่ controller แนบมาด้วย (docs §13.3 Audit Log ระบุ IP
   * Address เป็น field ที่ต้องเก็บ) — optional mirror `config.service.ts` */
  ipAddress?: string | null;
}

const AUDIT_MODULE = 'firmware';

@Injectable()
export class FirmwareService {
  private readonly logger = new Logger(FirmwareService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FirmwareStorageService,
    @Inject(FIRMWARE_SIMULATOR)
    private readonly simulator: FirmwareSimulator,
  ) {}

  findAll(): Promise<Firmware[]> {
    return this.prisma.firmware.findMany({
      where: { deletedAt: null },
      orderBy: { uploadedAt: 'desc' },
    });
  }

  async findOne(id: string): Promise<Firmware> {
    const firmware = await this.prisma.firmware.findUnique({ where: { id } });
    // ตัวที่ลบแล้ว (soft delete) ถือว่าไม่มี แถวยังอยู่ให้ประวัติ/partition อ้างถึง
    if (!firmware || firmware.deletedAt) {
      throw new NotFoundException(`ไม่พบ Firmware id ${id}`);
    }
    return firmware;
  }

  /**
   * `DELETE /firmware/{id}` ลบ Firmware ได้**ทุกสถานะ** ยกเว้นที่ระบบยังต้องใช้อยู่
   * ตอนนี้ (409, ดู `assertNotInUse`) ลบไฟล์ใน Object Storage จริง (ตัวที่กินพื้นที่
   * สะสม) แล้ว soft delete แถว (`deletedAt`) เก็บ version/checksum ไว้ให้ประวัติและ
   * partition ของกล่องอ้างถึงได้ ลบแล้วกู้ไม่ได้ ต้องอัปโหลดใหม่ Firmware Rollback
   * ไปหาตัวที่ลบแล้วจะล้มพร้อมข้อความ (ไม่มีไฟล์ให้ส่ง)
   *
   * 2 ขั้นที่กู้คืนได้ (review B บน #426):
   * 1) transaction เดียว: ล็อกแถว (FOR UPDATE) -> ตรวจ "ยังถูกใช้งานอยู่" ซ้ำหลังได้ล็อก ->
   *    ตั้ง `deletedAt` (**ปิดกั้น reference ใหม่ก่อนแตะไฟล์** ทุกเส้นทางที่สร้าง reference
   *    ล็อกแถวเดียวกัน ดู firmware-lock.ts แล้วเห็น deletedAt -> 409)
   * 2) ลบไฟล์ใน storage · ถ้าล้ม (502) ย้อน `deletedAt` กลับให้แถวใช้งานได้เหมือนเดิม ลองใหม่
   *    ได้ · ถ้าย้อนไม่ได้ด้วย (DB ล้มซ้ำ) log ระดับ error พร้อม objectKey ให้ตามเก็บ และ
   *    ผลที่เหลือคือ "แถวถูกซ่อน แต่ไฟล์ยังอยู่" (เปลืองพื้นที่ ไม่กระทบการทำงาน) ไม่มีกรณี
   *    "แถวยังใช้งานได้แต่ไฟล์หาย" เพราะลบไฟล์หลังตั้ง deletedAt เสมอ
   */
  async remove(id: string, actor: ActingUser): Promise<void> {
    await this.findOne(id);

    const firmware = await this.prisma.$transaction(async (tx) => {
      await lockFirmwareForDelete(tx, id);
      const current = await tx.firmware.findUnique({ where: { id } });
      if (!current || current.deletedAt) {
        throw new NotFoundException(`ไม่พบ Firmware id ${id}`);
      }
      await this.assertNotInUse(tx, current);
      await tx.firmware.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      return current;
    });

    try {
      await this.storage.deleteObject(firmware.objectKey);
    } catch (err) {
      this.logger.warn(
        `ลบไฟล์ Firmware ${id} ออกจาก Object Storage ไม่สำเร็จ: ${(err as Error).message}`,
      );
      try {
        await this.prisma.firmware.update({
          where: { id },
          data: { deletedAt: null },
        });
      } catch (revertErr) {
        this.logger.error(
          `ย้อนสถานะลบของ Firmware ${id} ไม่สำเร็จ แถวถูกซ่อนแต่ไฟล์ยังอยู่ใน storage (objectKey ${firmware.objectKey}) ต้องตามลบไฟล์เอง: ${(revertErr as Error).message}`,
        );
      }
      throw new BadGatewayException(
        'ลบไฟล์ Firmware ออกจาก Object Storage ไม่สำเร็จ ลองใหม่อีกครั้ง',
      );
    }

    await this.logAudit('delete', actor, {
      firmwareId: id,
      firmwareVersion: firmware.version,
    });
  }

  /**
   * ลบไม่ได้ถ้า (409 บอกว่าติดอะไร): มีกล่องที่กำลังรัน Firmware นี้อยู่ (พาร์ทิชันที่
   * active ชี้มาที่ตัวนี้ หรือกล่องรายงานเวอร์ชันนี้ของรุ่นที่ตรงกัน มติ 2026-11
   * บล็อกเพื่อความปลอดภัย) · Rollout ชนิด Firmware ที่ยังไม่จบ · คำขอส่งเข้ากล่อง
   * ชนิด Firmware ที่ยังไม่จบ · คำขอ Override Firmware ที่ยังรออนุมัติหรืออนุมัติแล้ว
   * แต่ยังไม่ถูกใช้ · พาร์ทิชันที่**ไม่ active** (ตัวย้อนกลับ) ไม่บล็อก
   */
  private async assertNotInUse(
    tx: Prisma.TransactionClient,
    firmware: Firmware,
  ): Promise<void> {
    const [running, rollouts, applyRequests, overrides] = await Promise.all([
      tx.device.findMany({
        where: {
          OR: [
            { activePartition: 'A', partitionAFirmwareId: firmware.id },
            { activePartition: 'B', partitionBFirmwareId: firmware.id },
            {
              reportedFirmwareVersion: firmware.version,
              deviceModel: { in: firmware.deviceModelCompatibility },
            },
          ],
        },
        select: { deviceId: true },
        take: 6,
      }),
      tx.campaignRollout.count({
        where: {
          firmwareId: firmware.id,
          status: { in: [...OPEN_CAMPAIGN_ROLLOUT_STATUSES] },
        },
      }),
      tx.configApplyRequest.count({
        where: {
          firmwareId: firmware.id,
          status: { in: ['pending', 'approved', 'sending'] },
        },
      }),
      tx.deviceFirmwareOverride.count({
        where: {
          firmwareId: firmware.id,
          OR: [{ status: 'pending' }, { status: 'approved', consumedAt: null }],
        },
      }),
    ]);

    const reasons: string[] = [];
    if (running.length > 0) {
      const ids = running.slice(0, 5).map((d) => d.deviceId);
      const more = running.length > 5 ? ' และอื่นๆ' : '';
      reasons.push(
        `มีกล่องกำลังรัน Firmware นี้อยู่ (${ids.join(', ')}${more})`,
      );
    }
    if (rollouts > 0) reasons.push(`Rollout ที่ยังไม่จบ ${rollouts} รอบ`);
    if (applyRequests > 0) {
      reasons.push(`คำขอส่งเข้ากล่องที่ยังไม่จบ ${applyRequests} รายการ`);
    }
    if (overrides > 0) {
      reasons.push(`คำขอ Override Firmware ที่ยังไม่เสร็จ ${overrides} รายการ`);
    }
    if (reasons.length > 0) {
      throw new ConflictException(
        `ลบ Firmware นี้ไม่ได้ เพราะยังถูกใช้งานอยู่: ${reasons.join(', ')}`,
      );
    }
  }

  /**
   * `POST /firmware` (v3.7 — อัปโหลดตรงเข้าระบบเราทางเดียว ไม่มีช่องทาง
   * "ดึงจากระบบเดิม" แล้ว) — FirmwareEngineer เท่านั้น อัปโหลดไฟล์ขึ้น Object Storage
   * (MinIO/S3) แบบ synchronous แล้วตั้ง `uploadStatus` ตามผลจริง — ไม่ throw
   * 500 ถ้า Object Storage ล้มเหลว เพราะ `uploadStatus: failed` มีไว้แทนค่านี้
   * อยู่แล้ว (client เห็นสถานะจริงบนหน้าเว็บได้ทันที ไม่ใช่แค่ error ทั่วไป)
   *
   * initial compatibility tag = รุ่นเดียวที่ระบุตอนอัปโหลด — แก้/เพิ่มทีหลัง
   * ผ่าน `updateCompatibility()` แยกต่างหาก (Compatibility Tag, dev plan
   * แถวที่ 23)
   */
  async upload(
    file: Express.Multer.File | undefined,
    version: string | undefined,
    deviceModel: string | undefined,
    actor: ActingUser,
  ): Promise<Firmware> {
    if (!file) {
      throw new BadRequestException(
        'ไม่มีไฟล์แนบมา (multipart field name ต้องเป็น "file")',
      );
    }
    if (!version?.trim()) {
      throw new BadRequestException('ต้องระบุ version');
    }
    if (!deviceModel?.trim()) {
      throw new BadRequestException('ต้องระบุ deviceModel');
    }

    const id = randomUUID();
    const objectKey = `firmware/${id}/${file.originalname}`;
    // ให้ QA เทียบกับ hash ที่ผู้สร้างไฟล์แจ้งมานอกระบบก่อนอนุมัติ (จับได้แค่
    // "ไฟล์ผิด/ไฟล์เสียระหว่างอัปโหลด" ไม่ได้ตรวจเนื้อหาว่าโค้ดถูกต้อง) —
    // คำนวณจาก buffer ที่รับมาตรงๆ ก่อนส่งขึ้น Object Storage
    const checksumSha256 = createHash('sha256')
      .update(file.buffer)
      .digest('hex');

    let uploadStatus: FirmwareUploadStatus;
    try {
      await this.storage.uploadObject({
        key: objectKey,
        body: file.buffer,
        contentType: file.mimetype,
      });
      uploadStatus = 'stored';
    } catch (err) {
      this.logger.warn(
        `อัปโหลด Firmware ขึ้น Object Storage ไม่สำเร็จ (id ${id}): ${(err as Error).message}`,
      );
      uploadStatus = 'failed';
    }

    const created = await this.prisma.firmware.create({
      data: {
        id,
        version: version.trim(),
        deviceModelCompatibility: [deviceModel.trim()],
        uploadStatus,
        objectKey,
        originalFilename: file.originalname,
        fileSizeBytes: file.size,
        checksumSha256,
        uploadedBy: actor.id,
      },
    });

    // AuditLog (CLAUDE.md Audit Pattern) — never-throw เหมือนโมดูล
    // config/device/campaign
    await this.logAudit('create', actor);
    return created;
  }

  /** `PATCH /firmware/{id}` — FirmwareEngineer แก้ Compatibility Tag ทีหลัง (แทนที่ทั้ง
   * array เสมอ ไม่ merge — ดู comment เหนือ DTO) */
  async updateCompatibility(
    id: string,
    dto: UpdateFirmwareCompatibilityDto,
    actor: ActingUser,
  ): Promise<Firmware> {
    await this.findOne(id);

    const updated = await this.prisma.firmware.update({
      where: { id },
      data: { deviceModelCompatibility: dto.deviceModelCompatibility },
    });

    await this.logAudit('update', actor);
    return updated;
  }

  /**
   * `POST /firmware/{id}/simulate` — ทดสอบ Firmware กับ Device Simulator
   * (mock) · ต้อง `uploadStatus: stored` แล้วเท่านั้น (ไฟล์อยู่ใน Object
   * Storage จริง) — ไม่แตะ status ใดๆ (dry-run ล้วน mirror `ConfigService.simulate`)
   */
  async simulate(id: string, deviceModel: string): Promise<SimulationResult> {
    const firmware = await this.findOne(id);

    if (firmware.uploadStatus !== SIMULATABLE_FIRMWARE_STATUS) {
      throw new ConflictException(
        `uploadStatus ปัจจุบัน (${firmware.uploadStatus}) ยังไม่พร้อมทดสอบ — ต้องเป็น ${SIMULATABLE_FIRMWARE_STATUS} เท่านั้น`,
      );
    }

    return this.simulator.simulateFirmware({
      deviceModel,
      deviceModelCompatibility: firmware.deviceModelCompatibility,
    });
  }

  /**
   * `POST /firmware/{id}/approve` — QAEngineer อนุมัติคุณภาพ Firmware หลังดู
   * ผล `simulate` แล้ว (docs/13_Role_Redesign_Proposal.md §3.2) — ต้อง
   * `approvalStatus: pending_review` เท่านั้น (mirror `ConfigService.approve`
   * แต่ไม่มีขั้น `decide` แยกก่อนหน้าแบบ Config เพราะที่นี่มีผู้ตัดสินใจแค่คน
   * เดียว ไม่ใช่ 2 actor ต่อกัน — ไม่มี ConfigVersion-style snapshot เพราะ
   * Firmware แก้ไฟล์เดิมซ้ำไม่ได้อยู่แล้ว ไม่มีอะไรต้อง snapshot เพิ่ม)
   */
  async approve(id: string, actor: ActingUser): Promise<Firmware> {
    const firmware = await this.findOne(id);

    if (firmware.approvalStatus !== DECIDABLE_FIRMWARE_APPROVAL_STATUS) {
      throw new ConflictException(
        `สถานะอนุมัติคุณภาพปัจจุบัน (${firmware.approvalStatus}) ไม่ใช่ ${DECIDABLE_FIRMWARE_APPROVAL_STATUS} จึงอนุมัติไม่ได้`,
      );
    }

    const updated = await this.prisma.firmware.update({
      where: { id },
      data: { approvalStatus: 'approved', approvedBy: actor.id },
    });

    await this.logAudit('approve', actor);
    return updated;
  }

  /**
   * `POST /firmware/{id}/reject` — QAEngineer ปฏิเสธคุณภาพ Firmware — ต้อง
   * `approvalStatus: pending_review` เท่านั้น (mirror `ConfigService.reject`)
   * ไม่ตั้งค่า `approvedBy` (คงเป็น null — ไม่มีใคร "อนุมัติ" การ reject)
   * Firmware Engineer ต้องอัปโหลดเวอร์ชันใหม่แก้ไข ไม่มีการแก้ไฟล์เดิมซ้ำ
   */
  async reject(id: string, actor: ActingUser): Promise<Firmware> {
    const firmware = await this.findOne(id);

    if (firmware.approvalStatus !== DECIDABLE_FIRMWARE_APPROVAL_STATUS) {
      throw new ConflictException(
        `สถานะอนุมัติคุณภาพปัจจุบัน (${firmware.approvalStatus}) ไม่ใช่ ${DECIDABLE_FIRMWARE_APPROVAL_STATUS} จึงปฏิเสธไม่ได้`,
      );
    }

    const updated = await this.prisma.firmware.update({
      where: { id },
      data: { approvalStatus: 'rejected' },
    });

    await this.logAudit('reject', actor);
    return updated;
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
