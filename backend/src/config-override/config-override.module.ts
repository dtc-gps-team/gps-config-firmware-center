import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConfigDefinitionModule } from '../config-definition/config-definition.module';
import { ConfigOverrideController } from './config-override.controller';
import { ConfigOverrideService } from './config-override.service';

// Per-Field Config Override ACL (issue #185) — module แยกจาก `config` ตามที่
// เสนอไว้ใน issue §4.2 (คนละ flow กันโดยสิ้นเชิง ข้าม Approval Center ไปเลย)
// import ConfigDefinitionModule เพื่อใช้ validateOverridableFields()
@Module({
  imports: [AuthModule, ConfigDefinitionModule],
  controllers: [ConfigOverrideController],
  providers: [ConfigOverrideService],
})
export class ConfigOverrideModule {}
