import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

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
  @IsOptional()
  @IsString()
  @MaxLength(50)
  imei?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  serialNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  blackboxId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  bootloader?: string;
}
