import {
  IsBoolean,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export const DEVICE_EVENT_TYPES = [
  'OVERSPEED',
  'GEOFENCE_EXIT',
  'GEOFENCE_ENTER',
] as const;
export type DeviceEventType = (typeof DEVICE_EVENT_TYPES)[number];

export const LOCATION_SOURCES = ['gps', 'default'] as const;

/**
 * body ของ `POST /device-sync/{deviceId}/telemetry/{key}` — กล่องส่งทั้ง telemetry
 * และ event มาที่ URL เดียวกัน แยกด้วย `event_type` (docs/23 §5)
 *
 * **snake_case โดยตั้งใจ** (docs/23 Q4 — ต่างจาก camelCase ทั้งระบบ): รับ payload ของ
 * firmware arduino_gps ตามที่ส่งจริง เพราะถือว่า firmware ที่ติดตั้งแล้วแก้ไม่ได้
 * (§1) · ต้องมีทุก field ที่กล่องส่ง ไม่งั้น `forbidNonWhitelisted` ตอบ 400 ทุกรอบ
 * (ดู `dataLoop()`/`sendEvent()` ใน `features.h`) · service แปลงเป็นคอลัมน์ camelCase
 */
export class DeviceDataReportDto {
  /** กล่องใส่มาด้วย — ถ้ามีต้องตรงกับ `:deviceId` ใน path (service เช็ค ไม่ตรง → 400) */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  device_id?: string;

  /** มี = event (`DeviceEvent`) · ไม่มี = telemetry (`DeviceTelemetry`) */
  @IsOptional()
  @IsIn(DEVICE_EVENT_TYPES)
  event_type?: DeviceEventType;

  @IsLatitude()
  latitude!: number;

  @IsLongitude()
  longitude!: number;

  /** `null` ได้ — กล่องยังไม่มี fix และไม่ใช่โหมดจำลอง (`IsOptional` ข้าม null) */
  @IsOptional()
  @IsNumber()
  @Min(0)
  speed_kmh?: number | null;

  // field ของ telemetry — บังคับเฉพาะเมื่อไม่มี event_type (event ไม่ส่ง)
  @ValidateIf((o: DeviceDataReportDto) => !o.event_type)
  @IsBoolean()
  fix?: boolean;

  @ValidateIf((o: DeviceDataReportDto) => !o.event_type)
  @IsIn(LOCATION_SOURCES)
  location_source?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  satellites?: number;

  /** เก็บที่ `Device.reportedFirmwareVersion` ไม่เก็บทุกแถว (§6) */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  firmware_version?: string;

  // field ของ event
  @IsOptional()
  @IsNumber()
  speed_limit_kmh?: number;

  @IsOptional()
  @IsNumber()
  distance_m?: number;

  @IsOptional()
  @IsNumber()
  radius_m?: number;

  /** ส่งเฉพาะโหมดจำลอง */
  @IsOptional()
  @IsBoolean()
  simulated?: boolean;

  /** ไม่ใช้ `@IsISO8601` — กล่องส่ง `""` เมื่อยังไม่มีวันที่/เวลา GPS ถ้าบังคับจะ
   * ปฏิเสธทุกรอบที่ยังไม่มี fix · ว่างหรือ parse ไม่ได้ → ใช้ `receivedAt` (Q7) */
  @IsString()
  @MaxLength(40)
  timestamp!: string;
}
