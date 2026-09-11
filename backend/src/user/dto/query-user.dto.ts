import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Query ของ `GET /users` (Approval Center — Sprint 3 #19) — filter ตาม
 * `role` code · ไม่ส่ง = ทุก user ที่ active · mirror `QueryDeviceDto` /
 * `QueryIncidentDto`
 */
export class QueryUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  role?: string;
}
