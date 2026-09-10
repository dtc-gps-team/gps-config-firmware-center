import { Module } from '@nestjs/common';
import { ConfigSyncWriterModule } from '../config-sync-writer/config-sync-writer.module';
import { IncidentController } from './incident.controller';
import { IncidentService } from './incident.service';

/**
 * incident module (ฝั่ง A) — ดู `incident.service.ts`
 *
 * มีแล้ว:
 *   - สร้าง Incident อัตโนมัติเมื่อ config-sync-writer เขียนไม่สำเร็จ
 *     (listener `'sync-failed'` — มติ #32 docs/07 §9.5)
 *   - read-only endpoint `GET /incidents` + `GET /incidents/:id`
 *     (IncidentController — Sprint 2)
 *
 * **ยังไม่มี** — Create/Update/Rollback endpoint, correlation ·
 * Rollback flow (Sprint Checklist แถว 28)
 */
@Module({
  imports: [ConfigSyncWriterModule],
  controllers: [IncidentController],
  providers: [IncidentService],
  exports: [IncidentService],
})
export class IncidentModule {}
