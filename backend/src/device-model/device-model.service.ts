import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DeviceModel, Prisma } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { AuditLogMetadata } from '../audit/audit-log-metadata';
import { PrismaService } from '../prisma/prisma.service';
import { lockDeviceModelForDelete } from './device-model-lock';
import { CreateDeviceModelDto } from './dto/create-device-model.dto';
import { UpdateDeviceModelDto } from './dto/update-device-model.dto';

/** ผู้ที่กำลังเรียก endpoint — มาจาก JWT payload เสมอ (แต่ละ module ประกาศเอง
 * ไม่ import ข้าม module เหมือน config.service.ts / device.service.ts) */
export interface ActingUser {
  id: string;
  role: string;
  /** มาจาก `req.ip` ที่ controller แนบมาด้วย */
  ipAddress?: string | null;
}

const AUDIT_MODULE = 'device-model';

/**
 * แปลงค่าวันที่จาก DTO ให้เป็นรูปแบบที่ Prisma รับ — `@IsDateString()` ยอมรับ
 * วันที่อย่างเดียว (`"2027-10-12"` จากช่องเลือกวันที่บนเว็บ) แต่คอลัมน์
 * `DateTime` ของ Prisma ไม่รับ string แบบนั้น (ต้องเป็น ISO เต็มหรือ `Date`)
 * เดิมส่ง string ตรงๆ เลยได้ `PrismaClientValidationError` กลายเป็น 500
 * undefined = ไม่แตะค่าเดิม, null = ล้างค่า · คัดลอกจาก `toDbDate()` ใน
 * `task.service.ts` (โมดูล B) แทนการ import ข้ามโมดูล
 */
function toDbDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  return new Date(value);
}

/**
 * DeviceModel registry (issue #209, docs/15) — canonical registry ของ
 * "รุ่นสินค้า" แทน string อิสระเดิมที่กระจายอยู่ใน `Device`/`Config`/
 * `Firmware`/`ConfigFieldDefinitionModelSupport` (ยังไม่ migrate 3 ตัวหลัง
 * ไปใช้ modelId ในรอบนี้ — ดู docs/15 หัวข้อ 5)
 *
 * สร้าง/แก้ได้แค่ Admin/SuperAdmin (เช็คที่ PermissionGuard) — อ่านเปิดกว้าง
 * ให้ทุก role ที่ login แล้ว (ไม่มี PermissionGuard บน endpoint GET เลย mirror
 * `UserService.list()`)
 */
@Injectable()
export class DeviceModelService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(): Promise<DeviceModel[]> {
    return this.prisma.deviceModel.findMany({ orderBy: { name: 'asc' } });
  }

  async findOne(id: string): Promise<DeviceModel> {
    const model = await this.prisma.deviceModel.findUnique({ where: { id } });
    if (!model) {
      throw new NotFoundException(`ไม่พบรุ่นอุปกรณ์ id ${id}`);
    }
    return model;
  }

  /** ใช้จาก `ConfigService` เพื่อ validate ว่า `Config.protocol` อยู่ใน
   * `supportedProtocols` ของรุ่นนั้นไหม (issue #209 ข้อ 4) — คืน `null` ถ้า
   * ไม่เจอรุ่นนี้ในทะเบียนเลย (ให้ผู้เรียกตัดสินใจเองว่าจะ throw ข้อความ
   * ไหน ไม่ใช่หน้าที่ของ service นี้) */
  findByName(name: string): Promise<DeviceModel | null> {
    return this.prisma.deviceModel.findUnique({ where: { name } });
  }

  /**
   * เขียน AuditLog ในทรานแซกชันเดียวกับการเปลี่ยนข้อมูลเสมอ (ไม่ใช่ never-throw)
   * — บันทึกไม่สำเร็จ = การสร้าง/แก้ล้มตามไปด้วย ไม่มีทางที่ข้อมูลเปลี่ยนโดยไม่มี
   * ร่องรอยให้ตรวจสอบย้อนหลัง (เหมือน `overrideDeviceConfig()` ใน device.service.ts)
   * เก็บแค่ id/ชื่อรุ่น/ชื่อ field ที่เปลี่ยน ไม่เก็บค่า
   */
  private async logAudit(
    tx: Prisma.TransactionClient,
    action: 'create' | 'update' | 'delete',
    actor: ActingUser,
    metadata: AuditLogMetadata,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        auditModule: AUDIT_MODULE,
        action,
        ipAddress: actor.ipAddress ?? null,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  async create(
    dto: CreateDeviceModelDto,
    actor: ActingUser,
  ): Promise<DeviceModel> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.deviceModel.create({
          data: {
            name: dto.name,
            manufacturer: dto.manufacturer,
            supportedProtocols: dto.supportedProtocols,
            status: dto.status,
            warrantyMonths: dto.warrantyMonths,
            endOfSupportDate: toDbDate(dto.endOfSupportDate),
            notes: dto.notes,
          },
        });
        await this.logAudit(tx, 'create', actor, {
          deviceModelId: created.id,
          modelName: created.name,
        });
        return created;
      });
    } catch (err) {
      if (
        err instanceof PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(`มีรุ่นอุปกรณ์ชื่อ "${dto.name}" อยู่แล้ว`);
      }
      throw err;
    }
  }

  async update(
    id: string,
    dto: UpdateDeviceModelDto,
    actor: ActingUser,
  ): Promise<DeviceModel> {
    // เช็คก่อนเพื่อคืน 404 ที่ตรงเจตนา (ไม่ใช่ปล่อยให้ P2025 หลุดเป็น 500)
    await this.findOne(id);

    // ชื่อ field ที่ผู้เรียกส่งมาจริง (ไม่นับที่ undefined) — บันทึกเฉพาะชื่อ
    const fieldNames = Object.entries(dto)
      .filter(([, value]) => value !== undefined)
      .map(([name]) => name);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.deviceModel.update({
          where: { id },
          data: {
            manufacturer: dto.manufacturer,
            supportedProtocols: dto.supportedProtocols,
            status: dto.status,
            warrantyMonths: dto.warrantyMonths,
            endOfSupportDate: toDbDate(dto.endOfSupportDate),
            notes: dto.notes,
          },
        });
        await this.logAudit(tx, 'update', actor, {
          deviceModelId: updated.id,
          modelName: updated.name,
          fieldNames,
        });
        return updated;
      });
    } catch (err) {
      // race condition: row ถูกลบไปพอดีระหว่าง findOne กับ update นี้ (rare)
      if (
        err instanceof PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        throw new NotFoundException(`ไม่พบรุ่นอุปกรณ์ id ${id}`);
      }
      throw err;
    }
  }

  /**
   * `DELETE /device-models/{id}` — ลบจริงได้เฉพาะรุ่นที่ **ไม่มีอะไรอ้างอิงอยู่เลย** (มติ A 2026-11-05:
   * "เลิกผลิต" เป็นปุ่มหลัก ลบจริงเฉพาะที่ไม่มีอะไรผูก เช่นสร้างรุ่นผิดชื่อ) ผู้อ้างอิงที่นับ: อุปกรณ์
   * (`modelId` ทุกสถานะ รวมปลดระวางแล้ว), Config (ชื่อรุ่น รวมที่ลบแบบ soft delete แล้ว), Firmware
   * (`deviceModelCompatibility` รวมที่ลบแล้ว), พารามิเตอร์ (`supportedModels`) · มีอย่างใดอย่างหนึ่ง
   * -> 409 บอกจำนวนแต่ละชนิดและชี้ไป "ปรับเป็นเลิกผลิต" แทน
   *
   * ล็อกแถว FOR UPDATE แล้วตรวจซ้ำหลังได้ล็อก คู่กับ `lockDeviceModelForUse()` ฝั่งสร้าง/แก้ Config กัน
   * TOCTOU (ดู device-model-lock.ts) · บันทึกชื่อรุ่นลง AuditLog (snapshot ให้อ่าน log รู้เรื่องหลังลบ)
   */
  async remove(id: string, actor: ActingUser): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockDeviceModelForDelete(tx, id);
      const model = await tx.deviceModel.findUniqueOrThrow({ where: { id } });
      const name = model.name;

      const [devices, configs, configsDeleted, firmware, parameters] =
        await Promise.all([
          tx.device.count({ where: { modelId: id } }),
          tx.config.count({ where: { deviceModel: name } }),
          tx.config.count({
            where: { deviceModel: name, deletedAt: { not: null } },
          }),
          tx.firmware.count({
            where: { deviceModelCompatibility: { has: name } },
          }),
          tx.configFieldDefinitionModelSupport.count({
            where: { deviceModel: name },
          }),
        ]);

      const used: string[] = [];
      if (devices > 0) {
        used.push(`อุปกรณ์ ${devices} เครื่อง (รวมที่ปลดระวางแล้ว)`);
      }
      if (configs > 0) {
        used.push(
          configsDeleted > 0
            ? `Config ${configs} ตัว (ลบแล้ว ${configsDeleted})`
            : `Config ${configs} ตัว`,
        );
      }
      if (firmware > 0) used.push(`Firmware ${firmware} ตัว`);
      if (parameters > 0) used.push(`พารามิเตอร์ ${parameters} รายการ`);
      if (used.length > 0) {
        throw new ConflictException(
          `ลบรุ่น "${name}" ไม่ได้ เพราะยังมีข้อมูลอ้างอิงอยู่: ${used.join(', ')} - ใช้ "ปรับเป็นเลิกผลิต" แทน (รุ่นเดิมยังแสดงและใช้งานกับเครื่องที่มีอยู่ได้ตามปกติ)`,
        );
      }

      await tx.deviceModel.delete({ where: { id } });
      await this.logAudit(tx, 'delete', actor, {
        deviceModelId: model.id,
        modelName: name,
      });
    });
  }
}
