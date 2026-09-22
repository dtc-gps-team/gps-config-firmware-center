import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

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

  @IsString()
  @MinLength(1)
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
   * Web เท่านั้น ไม่ได้เข้ารหัสค่าที่เก็บใน DB เพิ่ม default false */
  @IsOptional()
  @IsBoolean()
  sensitive?: boolean;

  /** ต้อง Restart กล่องหลังเปลี่ยนค่า field นี้ไหม — metadata แสดงผล/เตือน
   * ผู้ใช้เท่านั้น ยังไม่ผูกกับ logic ใดใน backend default false */
  @IsOptional()
  @IsBoolean()
  restartRequired?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ConfigDefinitionModelSupportDto)
  supportedModels!: ConfigDefinitionModelSupportDto[];
}
