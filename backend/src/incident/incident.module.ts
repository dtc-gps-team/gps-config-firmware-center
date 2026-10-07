import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConfigSyncWriterModule } from '../config-sync-writer/config-sync-writer.module';
import { NotificationModule } from '../notification/notification.module';
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
 *   - Field Incident Report (issue #236) — `POST /incidents`,
 *     `POST /incidents/:id/decide`
 *
 * **ยังไม่มี** — correlation · Rollback flow อัตโนมัติเต็มรูปแบบ
 * (Sprint Checklist แถว 28 ทำแล้วบางส่วนผ่าน `campaign-rollout.service.ts`)
 */
@Module({
  // AuthModule — JwtAuthGuard/JwtModule ร่วม (สำหรับ IncidentController) ·
  //   PermissionGuard resolve เองผ่าน PrismaModule @Global + Reflector
  // ConfigSyncWriterModule — inject ConfigSyncWriterQueue เข้า IncidentService
  //   (listener `'sync-failed'`)
  // NotificationModule (issue #236) — แจ้ง Operation ตอนมี field report ใหม่
  //   + แจ้งผู้รายงานตอน Operation ตัดสินใจ (mirror DeviceModule)
  imports: [AuthModule, ConfigSyncWriterModule, NotificationModule],
  controllers: [IncidentController],
  providers: [IncidentService],
  exports: [IncidentService],
})
export class IncidentModule {}
