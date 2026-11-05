import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

/**
 * Query ของ `GET /customers` — `activeOnly=true` คืนเฉพาะลูกค้าที่ยังใช้งานอยู่ (dropdown ตอนลงทะเบียน
 * อุปกรณ์ใหม่) · ไม่ส่ง = ทุกคน รวมที่ปิดใช้งาน (dropdown filter หน้า Device Search ต้องเห็นลูกค้า
 * ของเครื่องเดิม)
 */
export class QueryCustomerDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  activeOnly?: boolean;
}
