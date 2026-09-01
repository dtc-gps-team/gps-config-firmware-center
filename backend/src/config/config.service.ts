import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Config, Prisma } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { CreateConfigDto } from './dto/create-config.dto';
import { QueryConfigDto } from './dto/query-config.dto';
import { UpdateConfigDto } from './dto/update-config.dto';
import { EDITABLE_CONFIG_STATUS } from './config-status';

/** ผู้ที่กำลังเรียก endpoint — มาจาก JWT payload ({ sub, role }) เสมอ */
export interface ActingUser {
  id: string;
  role: string;
}

@Injectable()
export class ConfigService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateConfigDto, actor: ActingUser): Promise<Config> {
    // สิทธิ์ resource "config" action Create เช็คแล้วที่ PermissionGuard
    // (เฉพาะ Role SW ตาม RolePermission seed) เหลือแค่ผูก createdBy จาก JWT
    return this.prisma.config.create({
      data: {
        deviceModel: dto.deviceModel,
        protocol: dto.protocol,
        // cast เป็น Prisma.InputJsonValue — DTO ใช้ Record<string, unknown>
        // ตรงๆ (class-validator @IsObject() ไม่รู้จัก type ของ Prisma) แต่
        // Prisma.JsonValue ปฏิเสธ Record ธรรมดาเพราะ type ของมันรวม array
        // แบบ readonly ที่ไม่ตรงกับ Record shape เป๊ะๆ — cast ตรงจุดที่ส่งเข้า
        // Prisma พอ ไม่ต้องเปลี่ยน type ของ DTO
        fields: dto.fields as Prisma.InputJsonValue,
        createdBy: actor.id,
      },
    });
  }

  findAll(query: QueryConfigDto): Promise<Config[]> {
    // ไม่ scope ตาม creator — ทุก Role ที่มีสิทธิ์ Read เห็น Config ทั้งหมด และ
    // SW ทุกคนแก้/ลบ draft ของกันและกันได้ (update/remove ก็ไม่ filter
    // createdBy เหมือนกัน) ยืนยันเป็นการตัดสินใจแล้วตอนตอบ review PR #45 —
    // ดู RBAC_Matrix.md Section 2 แถว "Config Editor" footnote ² (ต่างจาก
    // Task ที่ ST/OT เห็น/แก้เฉพาะงานตัวเอง — เจตนาต่างกันจริง ไม่ใช่ตกหล่น)
    return this.prisma.config.findMany({
      where: { status: query.status },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string): Promise<Config> {
    const config = await this.prisma.config.findUnique({ where: { id } });
    if (!config) {
      throw new NotFoundException(`ไม่พบ Config id ${id}`);
    }
    return config;
  }

  async update(id: string, dto: UpdateConfigDto): Promise<Config> {
    // IDOR/state-guard pattern เดียวกับ Task (CLAUDE.md): filter ด้วย status
    // ตอน update แล้วเช็ค count === 0 -> ต้องแยกให้ออกว่าเป็น "ไม่เจอ id เลย"
    // (404) หรือ "เจอแต่สถานะไม่ใช่ draft" (409) เลย findOne ก่อนเพื่อแยก 2
    // case นี้ให้ตรงกับ error response ที่ openapi.yaml ระบุไว้
    const existing = await this.findOne(id);
    if (existing.status !== EDITABLE_CONFIG_STATUS) {
      throw new ConflictException(
        `สถานะ Config ปัจจุบันไม่ใช่ ${EDITABLE_CONFIG_STATUS} จึงแก้ไขไม่ได้`,
      );
    }

    // race condition: ระหว่าง findOne กับ update นี้ row อาจถูกลบ/เปลี่ยน
    // สถานะไปพอดีจาก request อื่น (rare) — Prisma โยน P2025 ("Record to
    // update not found") ในกรณีนั้น แปลงเป็น 404 แทนที่จะปล่อยเป็น 500
    try {
      return await this.prisma.config.update({
        where: { id },
        data: {
          deviceModel: dto.deviceModel,
          protocol: dto.protocol,
          fields: dto.fields as Prisma.InputJsonValue | undefined,
        },
      });
    } catch (err) {
      if (
        err instanceof PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        throw new NotFoundException(`ไม่พบ Config id ${id}`);
      }
      throw err;
    }
  }

  async remove(id: string): Promise<void> {
    const existing = await this.findOne(id);
    if (existing.status !== EDITABLE_CONFIG_STATUS) {
      throw new ConflictException(
        `สถานะ Config ปัจจุบันไม่ใช่ ${EDITABLE_CONFIG_STATUS} จึงลบไม่ได้`,
      );
    }

    // race condition เดียวกับ update() — ดูคอมเมนต์ด้านบน
    try {
      await this.prisma.config.delete({ where: { id } });
    } catch (err) {
      if (
        err instanceof PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        throw new NotFoundException(`ไม่พบ Config id ${id}`);
      }
      throw err;
    }
  }
}
