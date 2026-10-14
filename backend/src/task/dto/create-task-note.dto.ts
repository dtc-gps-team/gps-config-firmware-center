import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * `POST /tasks/{taskId}/notes` (Task Event History, issue #296) — บันทึกบน
 * timeline ที่ไม่ผูกกับการเปลี่ยนสถานะ · ข้อความอย่างเดียว ไม่มีแนบรูป (ตัดออก
 * จากสโคปรอบนี้) · ความยาวสูงสุดเท่า `Incident.description` (2000)
 */
export class CreateTaskNoteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  note: string;
}
