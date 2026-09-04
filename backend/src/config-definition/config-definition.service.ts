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

/** ตรวจแค่ "ชนิดข้อมูลของค่าที่ JSON.parse ให้มาตรงกับ dataType ที่ประกาศไหม"
 * — เจตนาเดียวกับ Phase 1 ข้อ 3 ("syntactic" อย่างน้อยที่สุด) `dataType` ที่
 * ไม่รู้จัก (สะกดผิด/พิมพ์อิสระตอนสร้าง) ไม่ block เพื่อไม่ปิดทางไว้ก่อนคุยกัน
 * เพิ่ม — ปล่อยผ่านเหมือนไม่มีนิยาม (เจตนาเดียวกับ Gap `syntactic_only` vs
 * `semantic` ที่ตกลงไว้ว่ายังไม่ทำรอบนี้) */
function matchesDataType(value: unknown, dataType: string): boolean {
  switch (dataType) {
    case 'number':
      return typeof value === 'number';
    case 'string':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
    default:
      return true;
  }
}

/**
 * Config Definition Lookup (task #12, แผน Agile แถว 12) — catalog ของ field ที่
 * ระบบรู้จัก (ชื่อ, ชนิดข้อมูล, ค่าที่ยอมรับ, บังคับกรอกไหม, รุ่นอุปกรณ์ที่ใช้ได้)
 *
 * SW สร้าง field ใหม่เองผ่าน `create()` ทีละตัวตามที่ใช้จริง — ไม่ต้องรออนุมัติ
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

  /** สร้าง field definition ใหม่ — resource `config-definition` action
   * `Create` เช็คแล้วที่ PermissionGuard (เฉพาะ Role SW) `fieldName` ซ้ำ
   * -> 409 (มี `@unique` ที่ schema คุมไว้อีกชั้น กัน race condition) */
  async create(
    dto: CreateConfigDefinitionDto,
  ): Promise<ConfigFieldDefinitionWithSupport> {
    try {
      return await this.prisma.configFieldDefinition.create({
        data: {
          fieldName: dto.fieldName,
          dataType: dto.dataType,
          allowedValues: dto.allowedValues ?? [],
          required: dto.required,
          unknownSpec: dto.unknownSpec ?? false,
          description: dto.description,
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
   * SW เห็นปัญหาทั้งหมดในครั้งเดียว ไม่ต้องแก้ทีละรอบ (แพทเทิร์นเดียวกับ
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
}
