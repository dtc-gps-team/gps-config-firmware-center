import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import {
  ConfigFieldDefinition,
  ConfigFieldDefinitionModelSupport,
} from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { CreateConfigDefinitionDto } from './dto/create-config-definition.dto';

export type ConfigFieldDefinitionWithSupport = ConfigFieldDefinition & {
  supportedModels: ConfigFieldDefinitionModelSupport[];
};

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ตรวจแค่ "ชนิดข้อมูลของค่าที่ JSON.parse ให้มาตรงกับ dataType ที่ประกาศไหม"
 * — เจตนาเดียวกับ Phase 1 ข้อ 3 ("syntactic" อย่างน้อยที่สุด) ชุด dataType
 * ที่รู้จักคือ `CONFIG_DATA_TYPES` (มติ issue #201, อัปเดต 2026-09-22) —
 * `dataType` ที่ไม่อยู่ในชุดนี้ไม่ควรเกิดขึ้นแล้ว เพราะ DTO กรองด้วย `@IsIn()`
 * ตอนสร้างไปแล้ว (เดิมปล่อยผ่านหมดไว้ "รอคุยกันเพิ่ม" — คุยจบแล้ว) แต่ยังคง
 * fallback `true` ไว้เผื่อ field ที่มีอยู่ก่อน DTO เข้มงวดขึ้น ไม่ให้ค่าเก่าที่
 * หลุดมาตก validate ย้อนหลังโดยไม่ตั้งใจ
 *
 * **`case 'number'` (แก้ตามรีวิว B บน PR #255 ข้อ 3):** ชุด dataType ใหม่ตัด
 * `number` ออกไปแล้ว (แยกเป็น `integer`/`decimal`) backfill ค่าจริงใน DB ทำผ่าน
 * `seed.ts` (`update:` ใน upsert loop) ซึ่งเป็นคำสั่งแยกจาก `migrate deploy` —
 * ถ้า deploy โค้ดใหม่แล้วยังไม่ได้รัน `db seed` ทันที field ที่ยังเป็น
 * `'number'` เดิมอยู่ใน DB จะตกไปเข้า `default: return true` ด้านล่าง (ปล่อย
 * ผ่านทุกค่า) ตรงข้ามกับเจตนาเดิมของ PR นี้ที่จะปิด gap "ชนิดไม่รู้จักผ่าน
 * เฉยๆ" — คง case นี้ไว้ explicit ให้ validate เหมือนก่อนแก้ทุกประการ
 * (`typeof value === 'number'`) จนกว่า backfill จะรันจริง ไม่ใช่ alias ของ
 * `decimal` เพราะพฤติกรรมเดิมของ `number` ไม่เคยเข้มงวดเรื่อง integer/float */
function matchesDataType(value: unknown, dataType: string): boolean {
  switch (dataType) {
    case 'number':
      return typeof value === 'number';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'decimal':
      return typeof value === 'number';
    case 'string':
    case 'text':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
    case 'date':
      return (
        typeof value === 'string' &&
        DATE_ONLY_REGEX.test(value) &&
        !Number.isNaN(Date.parse(value))
      );
    case 'datetime':
      return (
        typeof value === 'string' &&
        DATETIME_REGEX.test(value) &&
        !Number.isNaN(Date.parse(value))
      );
    case 'json':
      return (
        typeof value === 'object' && value !== null && !Array.isArray(value)
      );
    case 'array':
      return Array.isArray(value);
    case 'uuid':
      return typeof value === 'string' && UUID_REGEX.test(value);
    default:
      return true;
  }
}

/** เช็ค `ConfigFieldDefinition.defaultValue` (string ดิบเสมอ) เทียบกับ
 * `dataType` ตอนสร้าง field definition — ปิด TODO(#201) เดิมใน
 * `CreateConfigDefinitionDto` ที่ตั้งใจรอทำพร้อมรอบนี้ (จะได้ไม่ต้องเขียน
 * type-check logic 2 รอบ) แปลง raw string ให้เป็น shape เดียวกับที่
 * `matchesDataType()` คาดหวังก่อนส่งต่อ ไม่ validate ซ้ำเอง */
function matchesDataTypeString(raw: string, dataType: string): boolean {
  switch (dataType) {
    case 'integer':
    case 'decimal': {
      const n = Number(raw);
      return !Number.isNaN(n) && matchesDataType(n, dataType);
    }
    case 'boolean':
      return raw === 'true' || raw === 'false';
    case 'json':
    case 'array': {
      try {
        return matchesDataType(JSON.parse(raw), dataType);
      } catch {
        return false;
      }
    }
    default:
      // string/text/date/datetime/uuid เก็บ/เช็คเป็น string อยู่แล้ว ส่ง raw
      // ตรงเข้า matchesDataType ได้เลยไม่ต้องแปลงก่อน
      return matchesDataType(raw, dataType);
  }
}

/**
 * Config Definition Lookup (task #12, แผน Agile แถว 12) — catalog ของ field ที่
 * ระบบรู้จัก (ชื่อ, ชนิดข้อมูล, ค่าที่ยอมรับ, บังคับกรอกไหม, รุ่นอุปกรณ์ที่ใช้ได้)
 *
 * ConfigEngineer สร้าง field ใหม่เองผ่าน `create()` ทีละตัวตามที่ใช้จริง — ไม่ต้องรออนุมัติ
 * (ต่างจาก Config ที่ต้องผ่าน Operation) เพราะสุดท้าย field ที่มีปัญหาจริงจะ
 * โดนจับตอนเอาไปสร้าง Config Template แล้วเข้า simulate/approve อยู่ดี —
 * ตัดสินใจร่วมกับ B และพี่เลี้ยง 2569-09 (ดู RBAC_Matrix.md changelog)
 *
 * `validateFields()` คือส่วนที่ `ConfigService.create()`/`update()` เรียกใช้
 * ปิด Gap `// TODO(รอตาราง ConfigFieldDefinition)` เดิมใน config.service.ts
 */
@Injectable()
export class ConfigDefinitionService {
  constructor(private readonly prisma: PrismaService) {}

  /** คืน field definition ทั้งหมด เรียงตาม `fieldName` พร้อมรุ่นอุปกรณ์ที่
   * ใช้ได้ — ไม่มี paging/filter เพราะ catalog มีขนาดเล็ก (หลัก ~สิบ–ร้อย
   * field) และ client ฝั่ง Web/Mobile โหลดครั้งเดียวไปแคชไว้ใช้ตอนกรอกฟอร์ม
   * Config */
  findAll(): Promise<ConfigFieldDefinitionWithSupport[]> {
    return this.prisma.configFieldDefinition.findMany({
      orderBy: { fieldName: 'asc' },
      include: { supportedModels: true },
    });
  }

  /** `GET /config-definitions` (`findAll()`) คืน `defaultValue` กลับแบบไม่ mask
   * ให้ทุก role ที่มีสิทธิ์ `config-definition.Read` (ConfigEngineer/Operation/
   * ST/OT) เห็นได้หมด — endpoint นี้ถูกออกแบบไว้ตั้งแต่แรกว่าเป็นแค่ catalog
   * metadata อ่านได้ ไม่ใช่ข้อมูลอ่อนไหว (ดู RBAC_Matrix.md) ถ้า field
   * `sensitive: true` (เช่น COMMAND_PASSWORD) มี `defaultValue` เป็นตัวอย่างค่า
   * จริง จะรั่วผ่านช่องทางนี้ทันที — ตัดสินใจป้องกันที่ต้นทาง (validate ตอน
   * create/update) แทนการ mask ตอน response เพื่อไม่ให้ต้องเปลี่ยน shape ของ
   * response ที่ client พึ่งพาอยู่แล้ว */
  private assertNoSensitiveDefaultValue(dto: {
    sensitive?: boolean;
    defaultValue?: string;
  }): void {
    if (dto.sensitive && dto.defaultValue) {
      throw new BadRequestException(
        'defaultValue is not allowed when sensitive is true',
      );
    }
  }

  /** เช็คว่า `defaultValue` (ถ้ามี) ตรงกับ `dataType` ที่ประกาศไหม — ปิด
   * TODO(#201) เดิมที่ตั้งใจรอทำพร้อมงานขยายชุด dataType (กัน
   * `dataType: "integer"` + `defaultValue: "abc"` หลุดผ่านไปได้เหมือนก่อนหน้านี้) */
  private assertDefaultValueMatchesDataType(dto: {
    dataType: string;
    defaultValue?: string;
  }): void {
    if (
      dto.defaultValue !== undefined &&
      !matchesDataTypeString(dto.defaultValue, dto.dataType)
    ) {
      throw new BadRequestException(
        `defaultValue "${dto.defaultValue}" ไม่ตรงกับ dataType "${dto.dataType}"`,
      );
    }
  }

  /** สร้าง field definition ใหม่ — resource `config-definition` action
   * `Create` เช็คแล้วที่ PermissionGuard (เฉพาะ Role ConfigEngineer) `fieldName` ซ้ำ
   * -> 409 (มี `@unique` ที่ schema คุมไว้อีกชั้น กัน race condition) */
  async create(
    dto: CreateConfigDefinitionDto,
  ): Promise<ConfigFieldDefinitionWithSupport> {
    this.assertNoSensitiveDefaultValue(dto);
    this.assertDefaultValueMatchesDataType(dto);
    try {
      return await this.prisma.configFieldDefinition.create({
        data: {
          fieldName: dto.fieldName,
          dataType: dto.dataType,
          allowedValues: dto.allowedValues ?? [],
          required: dto.required,
          unknownSpec: dto.unknownSpec ?? false,
          description: dto.description,
          unit: dto.unit,
          stOverridable: dto.stOverridable ?? false,
          category: dto.category,
          sensitive: dto.sensitive ?? false,
          restartRequired: dto.restartRequired ?? false,
          defaultValue: dto.defaultValue,
          supportedModels: {
            create: dto.supportedModels.map((m) => ({
              deviceModel: m.deviceModel,
              protocol: m.protocol,
            })),
          },
        },
        include: { supportedModels: true },
      });
    } catch (err) {
      if (
        err instanceof PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          `มี field ชื่อ "${dto.fieldName}" อยู่แล้วในคลัง`,
        );
      }
      throw err;
    }
  }

  /**
   * ตรวจ `fields` ของ Config เทียบกับ catalog สำหรับ `deviceModel`/`protocol`
   * ที่ระบุ — เรียกจาก `ConfigService.create()`/`update()` ก่อนเขียนลง DB
   * เก็บ error ทุกจุดที่เจอไว้ (ไม่หยุดที่จุดแรก) แล้วโยนรวมทีเดียว เพื่อให้
   * ConfigEngineer เห็นปัญหาทั้งหมดในครั้งเดียว ไม่ต้องแก้ทีละรอบ (แพทเทิร์นเดียวกับ
   * `importFromJson` ใน config.service.ts)
   *
   * ตัดสินใจร่วมกับ B และพี่เลี้ยง 2569-09: field ที่ไม่มีนิยามในคลังเลย หรือ
   * มีนิยามแต่ไม่รองรับ deviceModel/protocol นี้ → block ทั้งคู่ (ไม่มีทางลัด
   * ให้ field "พิเศษเฉพาะลูกค้า" ข้าม validation ไปได้)
   */
  async validateFields(
    deviceModel: string,
    protocol: string,
    fields: Record<string, unknown>,
  ): Promise<void> {
    const defs = await this.prisma.configFieldDefinition.findMany({
      include: { supportedModels: true },
    });
    const defByName = new Map(defs.map((d) => [d.fieldName, d]));
    const errors: string[] = [];

    for (const [name, value] of Object.entries(fields)) {
      const def = defByName.get(name);
      if (!def) {
        errors.push(
          `ไม่รู้จัก field "${name}" — ต้องสร้างนิยามในคลัง Parameter ก่อน`,
        );
        continue;
      }

      const supportsModel = def.supportedModels.some(
        (m) => m.deviceModel === deviceModel && m.protocol === protocol,
      );
      if (!supportsModel) {
        errors.push(
          `field "${name}" ไม่รองรับรุ่นอุปกรณ์ ${deviceModel}/${protocol}`,
        );
        continue;
      }

      if (!matchesDataType(value, def.dataType)) {
        errors.push(`field "${name}" ต้องเป็นชนิดข้อมูล ${def.dataType}`);
        continue;
      }

      if (
        def.allowedValues.length > 0 &&
        !def.allowedValues.includes(String(value))
      ) {
        errors.push(
          `field "${name}" ต้องเป็นค่าใดค่าหนึ่งใน [${def.allowedValues.join(', ')}]`,
        );
      }
    }

    const requiredForModel = defs.filter(
      (d) =>
        d.required &&
        d.supportedModels.some(
          (m) => m.deviceModel === deviceModel && m.protocol === protocol,
        ),
    );
    for (const def of requiredForModel) {
      if (!(def.fieldName in fields)) {
        errors.push(`ขาด field ที่บังคับกรอก "${def.fieldName}"`);
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'ค่าที่กรอกไม่ตรงกับ Config Definition',
        errors,
      });
    }
  }

  /**
   * ตรวจ `fields` ที่ ST ขอ override เทียบกับ catalog — เดิมเรียกจาก
   * `ConfigOverrideService.override()` (issue #185, module ถูกลบไปแล้ว —
   * ดู RBAC_Matrix.md changelog แก้ครั้งที่ 55) ปัจจุบันเรียกจาก
   * `DeviceService.overrideDeviceConfig()` (issue #223) เท่านั้น ก่อนเขียนลง
   * DB
   *
   * **ต่างจาก `validateFields()` ด้านบน 2 จุดสำคัญ:**
   * 1. เช็คเพิ่มว่า field นั้น `stOverridable: true` ไหม — field ที่นิยามไว้
   *    ถูกต้องแต่ไม่ได้เปิด override ก็ยัง block (แยกจาก "ไม่รู้จัก field")
   * 2. **ไม่เช็ค required field ที่ขาด** เพราะ override เป็น partial update
   *    (แก้แค่บาง field ของ Config ที่มีอยู่แล้ว) ไม่ใช่การสร้าง/แทนที่ทั้งชุด
   *    เหมือน `validateFields()` — ถ้าเช็ค required ครบด้วยจะ false-positive
   *    ทุกครั้งที่ override แค่ 1-2 field จากทั้งหมด
   */
  async validateOverridableFields(
    deviceModel: string,
    protocol: string,
    fields: Record<string, unknown>,
  ): Promise<void> {
    const defs = await this.prisma.configFieldDefinition.findMany({
      include: { supportedModels: true },
    });
    const defByName = new Map(defs.map((d) => [d.fieldName, d]));
    const errors: string[] = [];

    for (const [name, value] of Object.entries(fields)) {
      const def = defByName.get(name);
      if (!def) {
        errors.push(
          `ไม่รู้จัก field "${name}" — ต้องสร้างนิยามในคลัง Parameter ก่อน`,
        );
        continue;
      }

      if (!def.stOverridable) {
        errors.push(`field "${name}" ไม่อนุญาตให้ override`);
        continue;
      }

      const supportsModel = def.supportedModels.some(
        (m) => m.deviceModel === deviceModel && m.protocol === protocol,
      );
      if (!supportsModel) {
        errors.push(
          `field "${name}" ไม่รองรับรุ่นอุปกรณ์ ${deviceModel}/${protocol}`,
        );
        continue;
      }

      if (!matchesDataType(value, def.dataType)) {
        errors.push(`field "${name}" ต้องเป็นชนิดข้อมูล ${def.dataType}`);
        continue;
      }

      if (
        def.allowedValues.length > 0 &&
        !def.allowedValues.includes(String(value))
      ) {
        errors.push(
          `field "${name}" ต้องเป็นค่าใดค่าหนึ่งใน [${def.allowedValues.join(', ')}]`,
        );
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'ค่าที่ขอ override ไม่ผ่านการตรวจสอบ',
        errors,
      });
    }
  }
}
