import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';

export interface UploadFirmwareObjectInput {
  key: string;
  body: Buffer;
  contentType?: string;
}

/**
 * Object Storage (Firmware) — MinIO ตอนนี้ → AWS S3 ตอนใช้งานจริง (`.env.example`
 * comment เดิม) ต่างจาก `config-sync-writer`/`DeviceSimulator` ที่ต้องมี
 * Interface+Mock แยก เพราะที่นั่น "ระบบจริง" (ระบบเดิม/กล่อง GPS) เป็นสิ่งที่
 * เราต่อไม่ได้เลยตอนนี้ (TBD คำสั่ง Write) — แต่ MinIO เป็น S3-compatible
 * storage ตัวจริงที่รันอยู่แล้วผ่าน docker-compose ตั้งแต่ Sprint 0 ใช้
 * `@aws-sdk/client-s3` เชื่อมตรงได้เลย วันที่ deploy จริงแค่เปลี่ยน
 * `OBJECT_STORAGE_*` env ให้ชี้ AWS S3 จริง โค้ดไม่ต้องแก้แม้แต่บรรทัดเดียว
 * (S3 API เดียวกัน) — ไม่ต้องทำ mock mode ตาม CLAUDE.md § Mock Mode Pattern
 *
 * `forcePathStyle: true` จำเป็นสำหรับ MinIO (ไม่รองรับ virtual-hosted-style
 * bucket addressing แบบ AWS S3 จริง) — ยังใช้ได้ปกติกับ AWS S3 ด้วย (path-style
 * ยังทำงานได้แม้ AWS จะเลิกแนะนำ) จึงตั้งค่าเดียวกันได้ทั้งสองที่
 */
@Injectable()
export class FirmwareStorageService implements OnModuleInit {
  private readonly logger = new Logger(FirmwareStorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(nestConfig: NestConfigService) {
    this.bucket = nestConfig.get<string>(
      'OBJECT_STORAGE_BUCKET',
      'gps-firmware',
    );
    this.client = new S3Client({
      endpoint: nestConfig.get<string>('OBJECT_STORAGE_ENDPOINT'),
      // MinIO ไม่สนใจค่า region จริง แต่ SDK บังคับต้องส่งมาเสมอ
      region: 'us-east-1',
      credentials: {
        accessKeyId: nestConfig.get<string>('OBJECT_STORAGE_ACCESS_KEY', ''),
        secretAccessKey: nestConfig.get<string>(
          'OBJECT_STORAGE_SECRET_KEY',
          '',
        ),
      },
      forcePathStyle: true,
    });
  }

  /**
   * สร้าง bucket อัตโนมัติถ้ายังไม่มี (dev/CI ใหม่ที่ MinIO เพิ่ง provision
   * ไม่เคยมี bucket มาก่อน — S3 ไม่สร้าง bucket ให้เองตอน PutObject) ไม่ throw
   * ถ้าเตรียม bucket ไม่สำเร็จ — ปล่อยให้ upload จริงตอนใช้งานเป็นคนแจ้ง error
   * ที่ตรงจุดกว่า (เห็น request ที่ล้มเหลวจริง ไม่ใช่แค่ startup log)
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.client.send(
          new CreateBucketCommand({ Bucket: this.bucket }),
        );
        this.logger.log(
          `สร้าง Object Storage bucket "${this.bucket}" อัตโนมัติ (ไม่เจอมาก่อน)`,
        );
      } catch (err) {
        this.logger.warn(
          `เตรียม Object Storage bucket "${this.bucket}" ไม่สำเร็จ: ${(err as Error).message} — upload จริงจะ error ให้เห็นตอนใช้งาน`,
        );
      }
    }
  }

  async uploadObject(input: UploadFirmwareObjectInput): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
      }),
    );
  }
}
