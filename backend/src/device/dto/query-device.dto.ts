import { DeviceLifecycleStatus } from '@prisma/client';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { DEVICE_LIFECYCLE_STATUSES } from '../device-lifecycle-status';

/**
 * Query ของ `GET /devices` (Device Search — Sprint 2 #11) — ทุก filter optional
 * ไม่ส่งอะไรมาเลย = คืนทุกเครื่อง
 *
 * `search` = คำค้นเดียว match ทั้ง `deviceId` และ `simNumber` แบบ contains
 * (case-insensitive) — ตรง UI ที่มีช่องค้นหาช่องเดียว · `deviceModel`/`protocol`/
 * `status` = filter ตรงตัว (dropdown จากค่าจริงในข้อมูล ตาม UI standard
 * ../planning/01_GPS_Build_Reference.md §3)
 *
 * `customerId` (issue #204) — ให้ Mobile ดึง "รายการอุปกรณ์ของบริษัทที่เลือก"
 * มา group ตาม deviceModel เอง ก่อนหน้านี้ `Device.customerId` แสดง/กรองได้
 * แค่ฝั่ง client เท่านั้น (docs/12 เฟส B) ตัวนี้เปิดให้ filter ที่ backend ได้
 * จริง — อุปกรณ์ที่ `customerId` เป็น `null` (ยังไม่ผูกบริษัท) จะไม่ถูกคืน
 * เมื่อส่ง filter นี้มา (ตรงตามเจตนา — หน้าจอ "เลือกจากรายการ" ของ Mobile ใช้
 * เฉพาะอุปกรณ์ที่ผูกบริษัทแล้วเท่านั้น ส่วนเครื่องที่ยังไม่ผูกยังพิมพ์
 * device ID เองได้ตามช่องทางเดิม)
 */
export class QueryDeviceDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  deviceModel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  protocol?: string;

  @IsOptional()
  @IsIn(DEVICE_LIFECYCLE_STATUSES)
  status?: DeviceLifecycleStatus;

  @IsOptional()
  @IsUUID()
  customerId?: string;
}
