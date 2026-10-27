import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Body ของ `POST /tasks/start` (docs/28 §5.1) — ช่างเริ่มงานกับกล่องเอง ·
 * **ไม่รับ `assignedTo`** ผู้รับผิดชอบคือผู้เรียกเสมอ (จาก JWT) */
export class StartTaskDto {
  /** เลขเครื่อง (`Device.deviceId`) ไม่ใช่ `Device.id` — เหมือน `Task.deviceId` */
  @IsString()
  @MinLength(1)
  deviceId!: string;

  /** ไม่บังคับ — ถ้าส่งมาบันทึกเป็น TaskEvent ที่มี note */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
