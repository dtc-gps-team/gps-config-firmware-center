import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CONFIG_DATA_TYPES } from '../config-data-types';

/** รุ่นอุปกรณ์ + โปรโตคอลคู่หนึ่งที่ field นี้ใช้ได้ — field เดียวระบุได้
 * หลายคู่ (เช่น APN ใช้กับทั้ง GT06N/TCP และ GT06N/UDP) */
export class ConfigDefinitionModelSupportDto {
  @IsString()
  @MinLength(1)
  deviceModel!: string;

  @IsString()
  @MinLength(1)
  protocol!: string;
}

/** Body ของ `POST /config-definitions` — ConfigEngineer สร้าง field definition ใหม่เอง
 * (self-service ไม่ต้องรออนุมัติ — ตัดสินใจร่วมกับ B และพี่เลี้ยง 2569-09)
 *
 * `supportedModels` บังคับต้องมีอย่างน้อย 1 คู่เสมอ — field ที่ไม่ผูกกับรุ่น
 * ไหนเลยใช้ validate อะไรไม่ได้จริง (ConfigDefinitionService.validateFields
 * จะมองว่า field แบบนี้ "ไม่รองรับ" ทุกรุ่นเท่ากันหมด) */
export class CreateConfigDefinitionDto {
  @IsString()
  @MinLength(1)
  fieldName!: string;

  /** ชุดชนิดข้อมูลที่ระบบรู้จัก — มติ issue #201 (อัปเดต 2026-09-22) ดู
   * `CONFIG_DATA_TYPES` สำหรับที่มา/เหตุผลของชุดนี้ */
  @IsString()
  @MinLength(1)
  @IsIn(CONFIG_DATA_TYPES)
  dataType!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedValues?: string[];

  @IsBoolean()
  required!: boolean;

  /** `true` = รู้แค่ว่า field นี้มีจริง + `dataType` (syntactic_only) ยังไม่
   * รู้ `allowedValues`/`required`/ช่วงค่าที่แท้จริง — ปล่อยว่างได้ default
   * `false` (รู้กฎครบ) ตรงกับ `ConfigFieldDefinition.unknownSpec` ใน schema
   * ดู `docs/04_Phase1_A_ConfigWorkflow.md` § Validation strictness */
  @IsOptional()
  @IsBoolean()
  unknownSpec?: boolean;

  @IsOptional()
  @IsString()
  description?: string;

  /** หน่วยของค่า field นี้ (เช่น "วินาที", "KB", "%") — metadata สำหรับแสดงผล
   * ข้างช่องกรอกตอนสร้าง Config เท่านั้น ไม่ถูกใช้ตอน validate */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  /** ST override ค่า field นี้บนอุปกรณ์ผ่าน `POST /config/{id}/override` ได้
   * ไหม — ตั้งใน Parameter Library ตอนสร้าง/แก้ field (issue #185) ปล่อยว่าง
   * ได้ default `false` (override ไม่ได้เลยจนกว่าจะเปิดชัดเจน) — OT ไม่มี
   * สิทธิ์ override เลยไม่ว่าค่านี้จะเป็นอะไร (ไม่มี RBAC grant ให้ OT) */
  @IsOptional()
  @IsBoolean()
  stOverridable?: boolean;

  /** หมวดหมู่ field สำหรับจัดกลุ่มแสดงผล (เช่น "Network", "Server", "Security")
   * — ตรงกับ `docs/GPS_Config_Firmware_Center_Design.pdf` §5.1 ไม่บังคับ,
   * ไม่ใช่ enum เพราะยังไม่รู้ชุดหมวดเต็มจนกว่าจะมีสเปกฟิลด์จริง (~262 ค่า) */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  category?: string;

  /** field เก็บค่าอ่อนไหว (เช่น password, เบอร์โทร) — ใช้ซ่อนค่าบนหน้าจอฝั่ง
   * Web เท่านั้น ไม่ได้เข้ารหัสค่าที่เก็บใน DB เพิ่ม default false
   *
   * **ห้ามตั้งพร้อมกับ `defaultValue`** — `GET /config-definitions` คืน
   * `defaultValue` แบบไม่ mask ให้ทุก role ที่มีสิทธิ์ Read เห็น (catalog
   * metadata ไม่ใช่ข้อมูลอ่อนไหว ตาม RBAC_Matrix.md) ถ้า field `sensitive`
   * มี `defaultValue` เป็นตัวอย่างค่าจริง (เช่น รหัสผ่าน) จะรั่วผ่านช่องทางนี้
   * — เช็คบังคับที่ `ConfigDefinitionService.assertNoSensitiveDefaultValue()`
   * (400 ถ้าฝ่าฝืน) ไม่ใช่แค่ที่ DTO นี้ */
  @IsOptional()
  @IsBoolean()
  sensitive?: boolean;

  /** ต้อง Restart กล่องหลังเปลี่ยนค่า field นี้ไหม — metadata แสดงผล/เตือน
   * ผู้ใช้เท่านั้น ยังไม่ผูกกับ logic ใดใน backend default false */
  @IsOptional()
  @IsBoolean()
  restartRequired?: boolean;

  /** ค่าเริ่มต้นของ field นี้ (issue #202) — เก็บเป็น string ดิบ parse ตาม
   * dataType ตอนใช้งานจริงฝั่ง Web (ConfigWizard auto-fill ตอนสร้าง Config
   * ใหม่เท่านั้น ไม่ใช่ตอน Clone) ไม่บังคับ, ไม่ผูกกับ validateFields
   *
   * เช็คว่าตรงกับ `dataType` ที่ประกาศไหมแล้วที่
   * `ConfigDefinitionService.assertDefaultValueMatchesDataType()` (ปิด
   * TODO(#201) เดิม — ไม่เช็คที่ DTO นี้ตรงๆ เพราะต้องรู้ค่า `dataType` ของ
   * field เดียวกันประกอบด้วย ทำที่ service เลยทีเดียวพร้อมกับ logic อื่น) */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  defaultValue?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ConfigDefinitionModelSupportDto)
  supportedModels!: ConfigDefinitionModelSupportDto[];
}
