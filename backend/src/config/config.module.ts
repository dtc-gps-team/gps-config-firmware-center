import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConfigController } from './config.controller';
import { ConfigService } from './config.service';

// ชื่อ module นี้ (ConfigController/ConfigService/ConfigModule) ชนกับชื่อ
// ConfigModule ของ @nestjs/config ที่ import อยู่ใน app.module.ts อยู่แล้ว —
// ไม่ได้ลบ/เปลี่ยนชื่อ business module นี้ (ตั้งชื่อตาม Prisma model `Config`
// และ path `/config` ที่มีอยู่แล้วทุกที่) แต่ alias import ของ @nestjs/config
// เป็น NestConfigModule แทนที่ app.module.ts — ดู comment ที่นั่น
@Module({
  imports: [AuthModule],
  controllers: [ConfigController],
  providers: [ConfigService],
  exports: [ConfigService],
})
export class ConfigModule {}
