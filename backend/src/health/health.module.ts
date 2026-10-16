import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

// PrismaService มาจาก PrismaModule (@Global) ไม่ต้อง import ซ้ำ
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
