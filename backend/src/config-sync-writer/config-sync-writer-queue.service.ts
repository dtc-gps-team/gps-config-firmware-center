import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'events';
import {
  CONFIG_SYNC_WRITER,
  type ConfigSyncWriter,
  type LegacyConfigWrite,
} from './config-sync-writer.interface';

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;

/** payload ของ event `'sync-failed'` — A ใช้สร้าง Incident (`source:
 * 'config-sync-writer'`, `metadata` ตาม `IncidentMetadata` — ดู
 * `src/incident/incident-metadata.ts`), B ใช้ยิง notification (`incident_alert`)
 * — คนละ listener คนละ PR ไม่ต้องแก้ไฟล์นี้เลย
 *
 * **listener ต้อง self-contain error handling เอง** — `emit()` เป็น sync
 * ไม่ await ผล listener · async listener (เช่น `await prisma.incident.create`)
 * ที่ reject จะกลายเป็น unhandledRejection ระดับ process · queue นี้ log ได้แค่
 * listener ที่ throw แบบ sync เท่านั้น (review #131 ข้อ 2 — A handle ใน listener) */
export interface ConfigSyncFailure {
  configId: string;
  versionNumber: number;
  deviceModel: string;
  protocol: string;
  attempts: number;
  lastError: string;
}

/**
 * Job runner ของ config-sync-writer (docs/07 §5, มติ §9.5) — in-process queue
 * ช่วง mock (สลับเป็น BullMQ+Redis ตอน docker/production handoff — ข้อที่ไม่
 * block ใน §9.5) · retry N=3 exponential backoff อยู่ชั้นนี้ (ไม่ใช่ใน writer
 * — writer แค่ throw) · serialize ต่อ configId — approve ซ้อนกันเร็วๆ ของ
 * config เดียวกันไม่ยิง 2 job พร้อมกัน (§9 ข้อ 8)
 *
 * เป็น `EventEmitter` โดยตั้งใจ (ไม่ใช่ DI token เดี่ยว) — emit `'sync-failed'`
 * เมื่อ retry ครบแล้วยังพัง ให้ A (Incident) และ B (notification alert) แต่ละ
 * คน `.on('sync-failed', ...)` ในโมดูลของตัวเองคนละ PR โดยไม่ต้องแก้ไฟล์นี้
 *
 * **ไม่มีใครเรียก `enqueueConfigSync()` ในระบบตอนนี้** — A จะเรียกจาก
 * `ConfigService.approve()` หลัง transaction commit ในอีก PR (docs/07 §5)
 */
@Injectable()
export class ConfigSyncWriterQueue extends EventEmitter {
  private readonly logger = new Logger(ConfigSyncWriterQueue.name);
  /** key = configId — กันสอง job ของ config เดียวกันรันซ้อนกัน */
  private readonly runningByConfigId = new Map<string, Promise<void>>();

  constructor(
    @Inject(CONFIG_SYNC_WRITER) private readonly writer: ConfigSyncWriter,
  ) {
    super();
  }

  /** Fire-and-forget ตามเจตนาของ §5 ("ไม่เขียนใน transaction เดียวกับ
   * approve") — caller ไม่ await ผลจริง แค่ enqueue แล้วปล่อย */
  enqueueConfigSync(input: LegacyConfigWrite): void {
    const previous =
      this.runningByConfigId.get(input.configId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined) // job ก่อนหน้าพังไม่ควรบล็อกคิวถัดไปของ config เดียวกัน
      .then(() => this.runWithRetry(input));
    this.runningByConfigId.set(input.configId, next);
    void next.finally(() => {
      if (this.runningByConfigId.get(input.configId) === next) {
        this.runningByConfigId.delete(input.configId);
      }
    });
  }

  private async runWithRetry(input: LegacyConfigWrite): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        await this.writer.writeConfigToLegacySystem(input);
        return;
      } catch (err) {
        lastError = err;
        this.logger.warn(
          `config-sync ล้มเหลว (attempt ${attempt}/${MAX_ATTEMPTS}) config ${input.configId}: ${(err as Error).message}`,
        );
        if (attempt < MAX_ATTEMPTS) {
          await this.delay(BASE_BACKOFF_MS * 2 ** (attempt - 1));
        }
      }
    }

    const failure: ConfigSyncFailure = {
      configId: input.configId,
      versionNumber: input.versionNumber,
      deviceModel: input.deviceModel,
      protocol: input.protocol,
      attempts: MAX_ATTEMPTS,
      lastError: (lastError as Error)?.message ?? String(lastError),
    };
    // บรรทัดสรุป "ล้มเหลวถาวร" — log เสมอ ไม่ผูกกับว่ามี listener 'sync-failed'
    // ไหม (event นี้ไม่ใช่ 'error' → Node drop เงียบถ้าไม่มี listener) · review
    // #131 ข้อ 1
    this.logger.error(
      `config-sync ล้มเหลวถาวรหลัง retry ${MAX_ATTEMPTS} ครั้ง — config ${input.configId} ` +
        `v${input.versionNumber} (${input.deviceModel}/${input.protocol}): ${failure.lastError}`,
    );
    // EventEmitter.emit ไม่ throw ออกมาแม้ listener ข้างในจะ throw แบบ sync
    // (Node ปล่อยเป็น uncaught ใน microtask ถัดไป) — ครอบ try/catch กันไว้อีก
    // ชั้นเผื่อ listener throw sync ตรงๆ ในเธรดเดียวกัน
    try {
      this.emit('sync-failed', failure);
    } catch (emitErr) {
      this.logger.error(
        `listener ของ 'sync-failed' throw (sync) — ${(emitErr as Error).message}`,
      );
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
