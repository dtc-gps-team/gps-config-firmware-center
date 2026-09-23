import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DeviceModel } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDeviceModelDto } from './dto/create-device-model.dto';
import { UpdateDeviceModelDto } from './dto/update-device-model.dto';

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

  async create(dto: CreateDeviceModelDto): Promise<DeviceModel> {
    try {
      return await this.prisma.deviceModel.create({
        data: {
          name: dto.name,
          manufacturer: dto.manufacturer,
          supportedProtocols: dto.supportedProtocols,
          status: dto.status,
          warrantyMonths: dto.warrantyMonths,
          endOfSupportDate: dto.endOfSupportDate,
          notes: dto.notes,
        },
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

  async update(id: string, dto: UpdateDeviceModelDto): Promise<DeviceModel> {
    // เช็คก่อนเพื่อคืน 404 ที่ตรงเจตนา (ไม่ใช่ปล่อยให้ P2025 หลุดเป็น 500)
    await this.findOne(id);

    try {
      return await this.prisma.deviceModel.update({
        where: { id },
        data: {
          manufacturer: dto.manufacturer,
          supportedProtocols: dto.supportedProtocols,
          status: dto.status,
          warrantyMonths: dto.warrantyMonths,
          endOfSupportDate: dto.endOfSupportDate,
          notes: dto.notes,
        },
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
}
