import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/** ตัดช่องว่างหัวท้ายก่อน validate — ช่องที่บังคับกรอกจึงไม่ผ่านด้วยช่องว่างล้วน
 * (MinLength(1) อย่างเดียวรับ "   " ได้) และค่าที่บันทึกเป็นค่าที่ตัดแล้วเสมอ */
const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * `POST /devices` (issue #157 PR 1) — ลงทะเบียนอุปกรณ์เข้าระบบครั้งแรก เป็น
 * endpoint ฝั่ง staff (Admin/SuperAdmin เท่านั้น ผ่าน `JwtAuthGuard`/
 * `PermissionGuard` ปกติ — **ไม่ใช่** endpoint ที่อุปกรณ์เรียกเอง เพราะ
 * อุปกรณ์ยังไม่มี API key จนกว่าจะลงทะเบียนจบ ดู `DeviceService.register()`)
 *
 * รับ `modelId` (UUID ของ `DeviceModel`) ไม่รับ `deviceModel` string ตรงๆ —
 * server resolve `deviceModel` เองจาก `model.name` เสมอ (issue #209 ข้อ 5 กัน
 * 2 ค่านี้ไม่ตรงกัน) · `protocol` ต้องอยู่ใน `DeviceModel.supportedProtocols`
 * ของรุ่นนั้น (validate แบบเดียวกับที่ `ConfigService.create()` ใช้อยู่แล้ว)
 */
export class RegisterDeviceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  deviceId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  simNumber!: string;

  @IsUUID()
  modelId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  protocol!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  hardwareRevisionCode?: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  // Identity group เพิ่มเติม (PDF §4.1) — string อิสระ ไม่มี validation
  // รูปแบบในรอบนี้ (ดู comment เหนือ field เดียวกันใน schema.prisma)
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  imei!: string;

  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  serialNumber!: string;

  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  blackboxId!: string;

  // Firmware ที่กล่องมีติดมาก่อนเข้าระบบเรา (เช่นจากโรงงาน) — optional เพราะ
  // ไม่ใช่ทุกกรณีที่รู้แน่ชัด (issue #362 ส่วนขยาย Rollback, เจอตอนทดสอบกับ
  // กล่องจริง) ไม่ใส่ไว้ = `DeviceService.register()` ไม่ seed Dual Partition
  // bookkeeping อะไรให้เลย (เหมือนพฤติกรรมเดิมทุกประการ) — ถ้าไม่ใส่ไว้ตั้งแต่
  // ตอนนี้ กด "Rollback Firmware" ครั้งแรกในอนาคตจะไม่มีของเก่าให้ย้อนกลับไป
  // เลย (ดู comment เหนือ `CampaignRolloutService.rollback()`)
  @IsOptional()
  @IsUUID()
  initialFirmwareId?: string;
}
