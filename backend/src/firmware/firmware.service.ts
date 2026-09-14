import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Firmware, FirmwareUploadStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateFirmwareCompatibilityDto } from './dto/update-firmware-compatibility.dto';
import { FirmwareStorageService } from './firmware-storage.service';
import {
  FIRMWARE_SIMULATOR,
  type FirmwareSimulator,
  type SimulationResult,
} from './firmware-simulator';
import { SIMULATABLE_FIRMWARE_STATUS } from './firmware-status';

/** ผู้ที่กำลังเรียก endpoint — มาจาก JWT payload เสมอ (แต่ละ module ประกาศ
 * interface นี้เองซ้ำกัน ไม่ import ข้าม module — pattern เดียวกับ
 * config.service.ts / campaign.service.ts) */
export interface ActingUser {
  id: string;
  role: string;
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
      orderBy: { uploadedAt: 'desc' },
    });
  }

  async findOne(id: string): Promise<Firmware> {
    const firmware = await this.prisma.firmware.findUnique({ where: { id } });
    if (!firmware) {
      throw new NotFoundException(`ไม่พบ Firmware id ${id}`);
    }
    return firmware;
  }

  /**
   * `POST /firmware` (v3.7 — อัปโหลดตรงเข้าระบบเราทางเดียว ไม่มีช่องทาง
   * "ดึงจากระบบเดิม" แล้ว) — SW เท่านั้น อัปโหลดไฟล์ขึ้น Object Storage
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
        uploadedBy: actor.id,
      },
    });

    // AuditLog (CLAUDE.md Audit Pattern) — never-throw เหมือนโมดูล
    // config/device/campaign
    await this.logAudit('create', actor.id);
    return created;
  }

  /** `PATCH /firmware/{id}` — SW แก้ Compatibility Tag ทีหลัง (แทนที่ทั้ง
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

    await this.logAudit('update', actor.id);
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
