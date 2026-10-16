import {
  Controller,
  Get,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface HealthStatus {
  status: 'ok' | 'error';
  database: 'ok' | 'error';
}

// health module:
//   GET /health  ตรวจว่า backend รันอยู่และต่อฐานข้อมูลได้
//
// public ไม่มี guard เพราะผู้เรียกคือระบบ ไม่ใช่ผู้ใช้: healthcheck ของ docker
// compose (ให้ web รอจน backend พร้อมจริง), health check ของผู้ให้บริการคลาวด์
// และเครื่องมือติดตามระบบ ตอบแค่ ok / error ไม่บอกรายละเอียดของ error (ดูได้จาก
// log ของ backend) กันข้อมูลภายในรั่วออกไปทาง endpoint ที่ไม่ต้อง login
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<HealthStatus> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (err) {
      this.logger.error(
        `health check: ต่อฐานข้อมูลไม่ได้ ${(err as Error).message}`,
      );
      throw new ServiceUnavailableException({
        status: 'error',
        database: 'error',
      } satisfies HealthStatus);
    }
    return { status: 'ok', database: 'ok' };
  }
}
