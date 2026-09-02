import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Config, Prisma } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { CreateConfigDto } from './dto/create-config.dto';
import { QueryConfigDto } from './dto/query-config.dto';
import { UpdateConfigDto } from './dto/update-config.dto';
import {
  EDITABLE_CONFIG_STATUS,
  SIMULATABLE_CONFIG_STATUSES,
} from './config-status';
import {
  DEVICE_SIMULATOR,
  type DeviceSimulator,
  type SimulationResult,
} from './device-simulator';

/** ผู้ที่กำลังเรียก endpoint — มาจาก JWT payload ({ sub, role }) เสมอ */
export interface ActingUser {
  id: string;
  role: string;
}

/** เฉพาะ format ที่รองรับตอนนี้ (v3.2 — ดู openapi.yaml importConfig summary) */
const SUPPORTED_IMPORT_FORMATS = ['json'];

@Injectable()
export class ConfigService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(DEVICE_SIMULATOR)
    private readonly deviceSimulator: DeviceSimulator,
  ) {}

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

  /**
   * Stage 2 (#26) — Import Config จากไฟล์ JSON (v3.2 รองรับ JSON เป็นจุดเริ่มต้น
   * ตาม openapi.yaml importConfig summary — CSV/อื่นๆ เป็น scope อนาคต)
   *
   * เข้า flow เดียวกับฟอร์ม (createConfig) เป๊ะๆ: parse ไฟล์ -> validate ด้วย
   * CreateConfigDto ตัวเดียวกับที่ form ใช้ -> create() ตัวเดียวกัน ไม่มี
   * business rule พิเศษแยกสำหรับ import (ตาม openapi.yaml: "แปลงเป็น
   * DeviceConfigDraft แล้ว เข้า flow ทดสอบ/อนุมัติเดียวกับฟอร์ม")
   *
   * จงใจไม่แยก interface `ConfigImporter`/`parseConfigFile` ตาม Build
   * Reference §3.1 — ตอนนี้รองรับ format เดียว (JSON) เขียนตรงๆ ในเมธอดนี้
   * พอ ยังไม่มีเหตุผลจะ abstract ล่วงหน้า (YAGNI) เมื่อไหร่ที่มี format ที่ 2
   * จริง (เช่น CSV) ค่อย refactor แยก interface ตอนนั้น — ยืนยันแล้วตอบ
   * review PR #46 ของ kittiphong
   */
  async importFromJson(
    file: Express.Multer.File | undefined,
    format: string | undefined,
    actor: ActingUser,
  ): Promise<Config> {
    if (!file) {
      throw new BadRequestException(
        'ไม่มีไฟล์แนบมา (multipart field name ต้องเป็น "file")',
      );
    }

    if (!format || !SUPPORTED_IMPORT_FORMATS.includes(format)) {
      throw new BadRequestException(
        `รองรับเฉพาะ format: ${SUPPORTED_IMPORT_FORMATS.join(', ')} เท่านั้น`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(file.buffer.toString('utf-8'));
    } catch {
      throw new BadRequestException(
        'ไฟล์ไม่ใช่ JSON ที่ถูกต้อง (parse ไม่ผ่าน)',
      );
    }

    // JSON ที่ valid แต่ไม่ใช่ object เดียว (null / array / ค่าเดี่ยว) ต้องดัก
    // ก่อน plainToInstance/validate — class-validator โยน TypeError ตอนเจอ
    // null ตรงๆ (validate(null) อ่าน .constructor ไม่ได้) หลุดเป็น 500 แทน
    // 400 ถ้าไม่มี guard นี้ (พบจาก code review ของ kittiphong บน PR ของ Stage 2 นี้)
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      throw new BadRequestException(
        'เนื้อหา JSON ต้องเป็น object เดียว (ไม่ใช่ null / array / ค่าเดี่ยว)',
      );
    }

    // validate ด้วย DTO ตัวเดียวกับ createConfig (whitelist + forbidNonWhitelisted
    // เหมือนกับ global ValidationPipe ใน main.ts) เพื่อให้กฎเดียวกันเป๊ะๆ ไม่ว่า
    // จะสร้างผ่านฟอร์มหรือ import — กันไม่ให้ JSON มี field แปลกปลอมหลุดเข้า DB
    //
    // TODO(รอตาราง ConfigFieldDefinition): ตอนนี้ validate แค่ shape ของ
    // `fields` ว่าเป็น object (ผ่าน CreateConfigDto) ยังไม่เช็คว่าค่าจริงตรงกับ
    // ConfigFieldDefinition ของ deviceModel/protocol นั้นๆ ไหม (เช่น field ที่
    // จำเป็นครบ, type/ค่าที่ยอมรับได้ถูกต้อง) — ยืนยันแล้วว่า Stage 3
    // (Simulate) จงใจไม่ทำส่วนนี้เช่นกัน (ดู docs/04_Phase1_A_ConfigWorkflow.md
    // หัวข้อ "จงใจไม่ทำใน Stage นี้") ต้องรอตาราง Config Definition Lookup
    // จริงก่อนถึงจะทำได้ลึกกว่านี้ — ยังไม่มี Stage ไหนรับผิดชอบตอนนี้
    const dto = plainToInstance(CreateConfigDto, parsed, {
      excludeExtraneousValues: false,
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    if (errors.length > 0) {
      throw new BadRequestException({
        message:
          'ข้อมูลใน JSON ไม่ตรงตามโครงสร้าง Config (แปลงเป็น DeviceConfigDraft ไม่สำเร็จ)',
        errors: errors.map((e) => ({
          property: e.property,
          constraints: e.constraints,
        })),
      });
    }

    return this.create(dto, actor);
  }

  /**
   * Stage 3 (#26) — ทดสอบ Config กับ Device Simulator (dry-run)
   *
   * **ไม่แตะ status เลย** — คืนแค่ `SimulationResult` ให้ SW ดูผล กดซ้ำได้
   * เรื่อยๆ ระหว่างที่ยังปรับแก้ค่าอยู่ ตาม docs/api/openapi.yaml
   * (`simulateConfig` summary) — ขั้นที่ SW ปักผลตัดสินใจจริงๆ ว่าจะส่งต่อ
   * Operation หรือไม่ (เปลี่ยน status) ยังเป็น open question ที่ยังไม่ปิด
   * (ดู docs/architecture/RBAC_Matrix.md Section 6) ไม่ implement ในนี้
   *
   * รับ `deviceModel` ใน request body ได้ตาม docs/api/openapi.yaml แต่ตั้งใจ
   * ไม่ใช้ค่านั้นเลย — ใช้ `deviceModel`/`protocol`/`fields` ที่ persist ไว้ใน
   * DB ของ Config นี้เสมอ เพื่อไม่ให้ client ส่ง deviceModel ปลอมมาแล้วได้ผล
   * ทดสอบของอุปกรณ์คนละรุ่นกับที่ Config จริงๆ ผูกไว้ (ฟิลด์นี้มีประโยชน์กับ
   * `simulateFirmware` มากกว่า เพราะ Firmware ตัวเดียวอาจใช้ได้กับหลาย
   * deviceModel แต่ Config ผูกกับ deviceModel เดียวตายตัวอยู่แล้วตั้งแต่สร้าง)
   */
  async simulate(id: string): Promise<SimulationResult> {
    const config = await this.findOne(id);

    if (!SIMULATABLE_CONFIG_STATUSES.includes(config.status)) {
      throw new ConflictException(
        `สถานะ Config ปัจจุบัน (${config.status}) ไม่รองรับการทดสอบ (เช่น approved/synced ไปแล้ว)`,
      );
    }

    return this.deviceSimulator.simulateConfig({
      deviceModel: config.deviceModel,
      protocol: config.protocol,
      fields: config.fields as Record<string, unknown>,
    });
  }

  findAll(query: QueryConfigDto): Promise<Config[]> {
    // ไม่ scope ตาม creator — ทุก Role ที่มีสิทธิ์ Read เห็น Config ทั้งหมด และ
    // SW ทุกคนแก้/ลบ draft ของกันและกันได้ (update/remove ก็ไม่ filter
    // createdBy เหมือนกัน) ยืนยันเป็นการตัดสินใจแล้วตอนตอบ review PR #46 —
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
