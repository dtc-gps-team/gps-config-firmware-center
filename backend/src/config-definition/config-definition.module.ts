import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConfigDefinitionController } from './config-definition.controller';
import { ConfigDefinitionService } from './config-definition.service';

// Config Definition Lookup (task #12) — module แยกจาก `config` module โดยตั้งใจ
// (ตารางคนละตัว, RBAC resource คนละตัว, ยังไม่มี dependency ระหว่างกันในรอบนี้)
// import `AuthModule` เพื่อใช้ `JwtAuthGuard`/`JwtModule` ร่วม แบบเดียวกับ
// `config.module.ts` — `PermissionGuard` resolve ได้เองผ่าน `PrismaModule`
// (`@Global`) + `Reflector`
@Module({
  imports: [AuthModule],
  controllers: [ConfigDefinitionController],
  providers: [ConfigDefinitionService],
  exports: [ConfigDefinitionService],
})
export class ConfigDefinitionModule {}
