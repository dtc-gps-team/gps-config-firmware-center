import { Module } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';
import {
  CONFIG_SYNC_WRITER,
  ConfigSyncWriter,
} from './config-sync-writer.interface';
import { ConfigSyncWriterQueue } from './config-sync-writer-queue.service';
import { MockConfigSyncWriter } from './mock-config-sync-writer';

/**
 * config-sync-writer — งานร่วม A+B (Critical Infra) · ดู `docs/07`
 *
 * มีแล้ว: interface + `CONFIG_SYNC_WRITER` token + `mock` impl + shared type
 * `IncidentMetadata` (`src/incident/`) + `ConfigSyncWriterQueue` (job runner
 * in-process + retry N=3 exponential backoff + serialize ต่อ configId — มติ
 * #32 §7 คอลัมน์ "ร่วมกัน")
 *
 * **ยังไม่มี** — เชื่อม `ConfigService.approve()` → `enqueueConfigSync()` (งาน A,
 * `config` module) · `.on('sync-failed')` สร้าง Incident (งาน A) · `.on(
 * 'sync-failed')` ยิง notification `incident_alert` (งาน B) — คนละ PR
 *
 * provider factory อ่าน `LEGACY_SYNC_MODE` (`mock` default | `docker` |
 * `production`) ตาม Mock Mode Pattern (CLAUDE.md) — `docker`/`production` ยัง
 * throw ตอน startup (ไม่ fail เงียบ) เพราะเป็น handoff (docs/07 §2)
 */
@Module({
  providers: [
    {
      provide: CONFIG_SYNC_WRITER,
      useFactory: (nestConfig: NestConfigService): ConfigSyncWriter => {
        const mode = nestConfig.get<string>('LEGACY_SYNC_MODE', 'mock');
        if (mode !== 'mock') {
          throw new Error(
            `LEGACY_SYNC_MODE=${mode} ยังไม่รองรับ — โหมด docker/production เป็นงาน handoff ` +
              `(รอ TBD คำสั่ง Write ระบบเดิม + เครื่องทดสอบ DTC + ไฟเขียวทีม — ดู docs/07 §2, §9.5 Q4)`,
          );
        }
        return new MockConfigSyncWriter();
      },
      inject: [NestConfigService],
    },
    ConfigSyncWriterQueue,
  ],
  exports: [CONFIG_SYNC_WRITER, ConfigSyncWriterQueue],
})
export class ConfigSyncWriterModule {}
