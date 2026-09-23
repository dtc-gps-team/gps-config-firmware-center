import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DeviceModelController } from './device-model.controller';
import { DeviceModelService } from './device-model.service';

// device-model module (issue #209, docs/15) — แยกจาก `device` module โดยตั้งใจ
// (ตารางคนละตัว, RBAC resource คนละตัว) import AuthModule เพื่อใช้
// JwtAuthGuard/JwtModule ร่วม mirror `config-definition.module.ts`
// export DeviceModelService ให้ ConfigModule เรียก findByName() ตอน validate
// protocol (issue #209 ข้อ 4)
@Module({
  imports: [AuthModule],
  controllers: [DeviceModelController],
  providers: [DeviceModelService],
  exports: [DeviceModelService],
})
export class DeviceModelModule {}
