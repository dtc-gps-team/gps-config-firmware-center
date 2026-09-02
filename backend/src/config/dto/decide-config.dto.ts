import { IsBoolean } from 'class-validator';

/** Body ของ `POST /config/{id}/decide` (Stage 4) — SW ปักผลตัดสินใจเองหลังดู
 * ผล `simulate` แล้ว ตาม docs/api/openapi.yaml `decideConfig` requestBody
 * (`required: [passed]`, type boolean เท่านั้น) — ไม่รับ field อื่นเลย
 * (global ValidationPipe เป็น whitelist + forbidNonWhitelisted อยู่แล้ว) */
export class DecideConfigDto {
  @IsBoolean()
  passed!: boolean;
}
