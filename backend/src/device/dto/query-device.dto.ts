import { DeviceLifecycleStatus } from '@prisma/client';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { DEVICE_LIFECYCLE_STATUSES } from '../device-lifecycle-status';

/**
 * Query ของ `GET /devices` (Device Search — Sprint 2 #11) — ทุก filter optional
 * ไม่ส่งอะไรมาเลย = คืนทุกเครื่อง
 *
 * `search` = คำค้นเดียว match ทั้ง `deviceId` และ `simNumber` แบบ contains
 * (case-insensitive) — ตรง UI ที่มีช่องค้นหาช่องเดียว · `deviceModel`/`protocol`/
 * `status` = filter ตรงตัว (dropdown จากค่าจริงในข้อมูล ตาม UI standard
 * ../planning/01_GPS_Build_Reference.md §3)
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
}
