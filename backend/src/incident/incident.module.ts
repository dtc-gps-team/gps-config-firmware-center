import { Module } from '@nestjs/common';
import { ConfigSyncWriterModule } from '../config-sync-writer/config-sync-writer.module';
import { IncidentService } from './incident.service';

/**
 * incident module (ฝั่ง A) — ดู `incident.service.ts`
 *
 * มีแล้ว: สร้าง Incident อัตโนมัติเมื่อ config-sync-writer เขียนไม่สำเร็จ
 * (listener `'sync-failed'` — มติ #32 docs/07 §9.5)
 *
 * **ยังไม่มี** — controller / endpoint (`GET /incidents`, incident detail),
 * Rollback flow, correlation · Sprint 3 (checklist แถว 28)
 */
@Module({
  imports: [ConfigSyncWriterModule],
  providers: [IncidentService],
  exports: [IncidentService],
})
export class IncidentModule {}
