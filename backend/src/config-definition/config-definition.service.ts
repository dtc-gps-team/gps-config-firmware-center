import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import {
  ConfigFieldDefinition,
  ConfigFieldDefinitionModelSupport,
  Prisma,
} from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { AuditLogMetadata } from '../audit/audit-log-metadata';
import { PrismaService } from '../prisma/prisma.service';
import { CreateConfigDefinitionDto } from './dto/create-config-definition.dto';

export type ConfigFieldDefinitionWithSupport = ConfigFieldDefinition & {
  supportedModels: ConfigFieldDefinitionModelSupport[];
};

/** ผู้ที่กำลังเรียก endpoint — มาจาก JWT payload เสมอ (แต่ละ module ประกาศเอง
 * ไม่ import ข้าม module เหมือน config.service.ts / device.service.ts) */
export interface ActingUser {
  id: string;
  role: string;
  /** มาจาก `req.ip` ที่ controller แนบมาด้วย */
  ipAddress?: string | null;
}

const AUDIT_MODULE = 'config-definition';

const DATE_ONLY_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;
/** timezone (`Z`/`±hh:mm`) เป็น optional โดยตั้งใจ (ตอบรีวิว B บน PR #255
 * ข้อ 4 ที่ถามว่ากำกวมไหม) — field ที่ใช้ `datetime` ในระบบนี้ตอนนี้ (เช่น
 * เวลารีบูทที่ตั้งค่าไว้) เป็นเวลาท้องถิ่นของอุปกรณ์ ไม่ใช่ timestamp ที่ต้อง
 * แปลงข้าม timezone จึงไม่บังคับ — `isValidCalendarDate` เช็คแค่ตัวเลข
 * y/m/d/h/mi/s ว่า valid ตามปฏิทินเท่านั้น ไม่ตีความ/แปลง offset */
const DATETIME_REGEX =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** ตัวเลขดิบล้วน ไม่รับ hex (`0x10`), `Infinity`/`NaN`, scientific notation,
 * หรือ whitespace — เพราะ `Number()` native แปลงค่าพวกนี้ให้ "ดูเหมือน"
 * เป็นตัวเลขที่ถูกต้องทั้งที่ไม่ใช่ (แก้ตามรีวิว B บน PR #255 ข้อ 4) */
const INTEGER_STRING_REGEX = /^-?\d+$/;
const DECIMAL_STRING_REGEX = /^-?\d+(\.\d+)?$/;

/** เช็ค y-m-d ว่าเป็นวันที่จริงบนปฏิทินไหม — ต่างจาก `Date.parse()` ตรงที่
 * `Date.parse` "rollover" วันที่ผิดแบบเงียบๆ แทนที่จะ error (เช่น
 * `2026-02-31` เลื่อนไปเป็น 3 มี.ค. 2026 โดยอัตโนมัติ) แก้ตามรีวิว B บน
 * PR #255 ข้อ 4 — ใช้ `Date.UTC` แล้วอ่านค่ากลับมาเทียบ ถ้าไม่ตรงแปลว่า
 * JS เพิ่ง rollover ให้ ซึ่งคือ input ที่ไม่ valid */
function isValidCalendarDate(
  year: number,
  month: number,
  day: number,
): boolean {
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

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
/** ขอบเขตค่าตัวเลข (`minValue`/`maxValue`, docs/30) — เรียกหลังผ่าน
 * `matchesDataType()` แล้วเท่านั้น · ค่าที่ไม่ใช่ number (ชนิดอื่น) ไม่ตรวจ ·
 * คืนข้อความต่อท้ายชื่อ field หรือ null ถ้าผ่าน */
function rangeError(
  def: {
    minValue: number | null;
    maxValue: number | null;
    unit: string | null;
  },
  value: unknown,
): string | null {
  if (typeof value !== 'number') return null;
  const { minValue: min, maxValue: max } = def;
  if ((min === null || value >= min) && (max === null || value <= max)) {
    return null;
  }
  const unit = def.unit ? ` ${def.unit}` : '';
  if (min !== null && max !== null) {
    return `ต้องอยู่ระหว่าง ${min}–${max}${unit}`;
  }
  return min !== null
    ? `ต้องไม่น้อยกว่า ${min}${unit}`
    : `ต้องไม่เกิน ${max}${unit}`;
}

function matchesDataType(value: unknown, dataType: string): boolean {
  switch (dataType) {
    case 'number':
      return typeof value === 'number';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'decimal':
      // Number.isFinite กัน NaN/Infinity (แก้ตามรีวิว B บน PR #255 ข้อ 4) —
      // typeof === 'number' เฉยๆ ปล่อยผ่านทั้งคู่เพราะมันก็เป็น "number" จริง
      return typeof value === 'number' && Number.isFinite(value);
    case 'string':
    case 'text':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
    case 'date': {
      if (typeof value !== 'string') return false;
      const m = DATE_ONLY_REGEX.exec(value);
      if (!m) return false;
      return isValidCalendarDate(Number(m[1]), Number(m[2]), Number(m[3]));
    }
    case 'datetime': {
      if (typeof value !== 'string') return false;
      const m = DATETIME_REGEX.exec(value);
      if (!m) return false;
      const [, y, mo, d, h, mi, s] = m;
      if (!isValidCalendarDate(Number(y), Number(mo), Number(d))) return false;
      return Number(h) <= 23 && Number(mi) <= 59 && Number(s) <= 59;
    }
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
      // regex เช็คก่อนเพราะ Number('') === 0 และ Number('0x10') === 16 —
      // ทั้งคู่ "ดูเหมือน" เลขที่ถูกต้องทั้งที่ควรถูกปฏิเสธ (แก้ตามรีวิว B
      // บน PR #255 ข้อ 4)
      return (
        INTEGER_STRING_REGEX.test(raw) && matchesDataType(Number(raw), dataType)
      );
    case 'decimal':
      return (
        DECIMAL_STRING_REGEX.test(raw) && matchesDataType(Number(raw), dataType)
      );
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

  /** `minValue`/`maxValue` (docs/30) ใช้ได้กับชนิดตัวเลขเท่านั้น และ min ≤ max */
  private assertValidRange(dto: {
    dataType: string;
    minValue?: number | null;
    maxValue?: number | null;
  }): void {
    const min = dto.minValue ?? null;
    const max = dto.maxValue ?? null;
    if (min === null && max === null) return;
    if (dto.dataType !== 'integer' && dto.dataType !== 'decimal') {
      throw new BadRequestException(
        `minValue/maxValue ใช้ได้กับ dataType integer หรือ decimal เท่านั้น (ได้รับ "${dto.dataType}")`,
      );
    }
    if (min !== null && max !== null && min > max) {
      throw new BadRequestException(
        `minValue (${min}) ต้องไม่มากกว่า maxValue (${max})`,
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
  /**
   * สร้างนิยามพารามิเตอร์ใหม่ในคลัง เขียน AuditLog ในทรานแซกชันเดียวกับการสร้าง
   * เสมอ (ไม่ใช่ never-throw): บันทึกไม่สำเร็จ = การสร้างล้มตามไปด้วย ไม่มีทางที่
   * นิยามถูกเพิ่มโดยไม่มีร่องรอยให้ตรวจสอบย้อนหลัง เก็บแค่ชื่อ field ไม่เก็บ
   * `defaultValue` (อาจมีค่าที่ไม่ควรไปอยู่ใน log)
   */
  async create(
    dto: CreateConfigDefinitionDto,
    actor: ActingUser,
  ): Promise<ConfigFieldDefinitionWithSupport> {
    this.assertNoSensitiveDefaultValue(dto);
    this.assertDefaultValueMatchesDataType(dto);
    this.assertValidRange(dto);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.configFieldDefinition.create({
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
            minValue: dto.minValue ?? null,
            maxValue: dto.maxValue ?? null,
            supportedModels: {
              create: dto.supportedModels.map((m) => ({
                deviceModel: m.deviceModel,
                protocol: m.protocol,
              })),
            },
          },
          include: { supportedModels: true },
        });
        const metadata: AuditLogMetadata = { fieldNames: [created.fieldName] };
        await tx.auditLog.create({
          data: {
            userId: actor.id,
            auditModule: AUDIT_MODULE,
            action: 'create',
            ipAddress: actor.ipAddress ?? null,
            metadata: metadata as Prisma.InputJsonValue,
          },
        });
        return created;
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
   * field ที่ไม่มีนิยามในคลังเลย → block (มติร่วมกับ B และพี่เลี้ยง 2569-09
   * ยังใช้อยู่ ไม่มีทางลัดให้ field ที่ไม่มีนิยามข้าม validation ไปได้)
   *
   * field ที่มีนิยามแต่ไม่ได้ผูกกับ deviceModel/protocol นี้ → **ผ่าน**
   * (เปลี่ยนจากมติเดิมตามคำแนะนำพี่เลี้ยงตอนรีวิว 12 ต.ค. 2569: ผู้สร้าง
   * Config template เป็นผู้เชี่ยวชาญ ต้องเพิ่มพารามิเตอร์นอกชุดของรุ่นได้
   * เช่นในแคมเปญที่ต้องการค่าพิเศษ) `supportedModels` จึงเป็นแค่ "ชุดค่าเริ่มต้น
   * ของรุ่น" ใช้กรองคลังบนหน้าเว็บและหา required field ของรุ่น ไม่ใช่ข้อห้าม
   * ส่วนชนิดข้อมูล/`allowedValues` ยังตรวจตามนิยามเหมือนเดิม
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

      const outOfRange = rangeError(def, value);
      if (outOfRange) errors.push(`field "${name}" ${outOfRange}`);
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
   *
   * field ต้องรองรับรุ่นนี้ **หรือ** อยู่ใน Config template ของเครื่องอยู่แล้ว
   * (`templateFieldNames`) — template มี field นอกชุดของรุ่นได้ตั้งแต่ผ่อนกฎใน
   * `validateFields()` (รีวิวพี่เลี้ยง 12 ต.ค. 2569) และแอปช่างแสดงทุก field
   * ของ template ที่ `stOverridable` โดยไม่กรองรุ่น ถ้าไม่รับ field ของ template
   * ช่างจะเห็นช่องให้แก้แต่ส่งไม่ผ่าน · ช่างเพิ่ม field นอกชุดที่ template
   * ไม่มีเองไม่ได้ (การเพิ่มเป็นสิทธิ์ของผู้สร้าง template)
   */
  async validateOverridableFields(
    deviceModel: string,
    protocol: string,
    fields: Record<string, unknown>,
    templateFieldNames: readonly string[] = [],
  ): Promise<void> {
    const inTemplate = new Set(templateFieldNames);
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
      if (!supportsModel && !inTemplate.has(name)) {
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

      const outOfRange = rangeError(def, value);
      if (outOfRange) errors.push(`field "${name}" ${outOfRange}`);
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'ค่าที่ขอ override ไม่ผ่านการตรวจสอบ',
        errors,
      });
    }
  }

  /** คลัง Parameter ทั้งก้อนพร้อมรุ่นที่รองรับ — ให้ผู้เรียกที่ตรวจหลายเครื่อง
   * โหลดครั้งเดียว (`validateOperationOverridableFields`) */
  loadFieldDefinitions(): Promise<ConfigFieldDefinitionWithSupport[]> {
    return this.prisma.configFieldDefinition.findMany({
      include: { supportedModels: true },
    });
  }

  /**
   * ตรวจ `fields` ค่าเฉพาะเครื่องที่ **Operation** เสนอตอนสร้าง Rollout
   * (docs/17 ข้อ 3.4 ทางเลือก ข — มติ B 13 ต.ค. 2569) เทียบคลัง Parameter
   *
   * **ต่างจาก `validateOverridableFields()` ของช่างที่จุดเดียว:** ไม่เช็ค
   * `stOverridable` — Operation แก้ได้ทุก field ที่โมเดล/โปรโตคอลนั้นรองรับ
   * (ธง `stOverridable` ตั้งไว้สำหรับช่างหน้างานเท่านั้น) · ที่เหลือเหมือน
   * กัน: ต้องมีนิยามในคลัง, รองรับโมเดล/โปรโตคอล, ชนิดข้อมูลถูก, อยู่ใน
   * `allowedValues` · เป็น partial update จึงไม่เช็ค required
   *
   * แยกเป็นฟังก์ชันใหม่ ไม่แก้ `validateOverridableFields()` ที่ช่างใช้อยู่
   * ตามที่ตกลงใน docs/17 (กันคนอ่านทีหลังสับสนว่าเป็นตัวเดียวกับของช่าง)
   *
   * field ต้องรองรับรุ่นนี้ **หรือ** อยู่ใน Config template ที่ใช้สร้าง Rollout
   * (`templateFieldNames`) — กฎเดียวกับ `validateOverridableFields()` ของช่าง
   * Config template มี field นอกชุดของรุ่นได้ตั้งแต่ผ่อนกฎใน `validateFields()`
   * (รีวิวพี่เลี้ยง 12 ต.ค. 2569) ถ้าไม่รับ field ของ template ที่ Operation
   * เห็นอยู่ในหน้า Config จะตั้งค่าเฉพาะเครื่องให้ field นั้นไม่ได้ · เพิ่ม field
   * นอกชุดที่ template ไม่มีเองไม่ได้ (การเพิ่มเป็นสิทธิ์ของผู้สร้าง template)
   *
   * คืนรายการ error ต่อ field (ไม่ throw) ให้ผู้เรียกที่ตรวจหลายเครื่อง
   * รวมข้อความพร้อมชื่อเครื่องเอง
   */
  async validateOperationOverridableFields(
    deviceModel: string,
    protocol: string,
    fields: Record<string, unknown>,
    templateFieldNames: readonly string[] = [],
    // ผู้เรียกที่ตรวจหลายเครื่องโหลดคลังครั้งเดียวด้วย `loadFieldDefinitions()`
    // แล้วส่งมาที่นี่ (ไม่ส่ง = โหลดเอง) กัน query คลังซ้ำต่อเครื่อง
    preloadedDefinitions?: ConfigFieldDefinitionWithSupport[],
  ): Promise<string[]> {
    const inTemplate = new Set(templateFieldNames);
    const defs = preloadedDefinitions ?? (await this.loadFieldDefinitions());
    const defByName = new Map(defs.map((d) => [d.fieldName, d]));
    const errors: string[] = [];

    for (const [name, value] of Object.entries(fields)) {
      const def = defByName.get(name);
      if (!def) {
        errors.push(
          `ไม่รู้จัก field "${name}" ต้องสร้างนิยามในคลัง Parameter ก่อน`,
        );
        continue;
      }

      const supportsModel = def.supportedModels.some(
        (m) => m.deviceModel === deviceModel && m.protocol === protocol,
      );
      if (!supportsModel && !inTemplate.has(name)) {
        errors.push(
          `field "${name}" ไม่รองรับโมเดล ${deviceModel}/${protocol}`,
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

      const outOfRange = rangeError(def, value);
      if (outOfRange) errors.push(`field "${name}" ${outOfRange}`);
    }

    return errors;
  }
}
