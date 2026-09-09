import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationModule } from '../notification/notification.module';
import { ConfigDeletionController } from './config-deletion.controller';
import { ConfigDeletionJob } from './config-deletion.job';
import { ConfigDeletionService } from './config-deletion.service';

// docs/11 Part A — คำขอลบ Config อัตโนมัติ
//
// module แยกจาก `config` โดยตั้งใจ: RBAC resource เป็น `config-deletion`
// (แยกจาก `config`) และ path เป็น top-level `/config-deletion-requests` ตาม
// docs/11 §5 — pattern เดียวกับที่ `config-definition` แยกออกจาก `config`
//
// imports:
//   - AuthModule — ใช้ JwtAuthGuard/JwtModule ร่วม (PermissionGuard resolve
//     เองผ่าน PrismaModule @Global + Reflector)
//   - NotificationModule — ยิง config_deletion_pending / config_deletion_grace
// ไม่ import ConfigModule เพราะ PrismaService เป็น @Global อยู่แล้ว และ flow นี้
// ไม่เรียก ConfigService (เขียน Config.deletedAt ตรงผ่าน prisma ใน transaction)
@Module({
  imports: [AuthModule, NotificationModule],
  controllers: [ConfigDeletionController],
  providers: [ConfigDeletionService, ConfigDeletionJob],
  exports: [ConfigDeletionService],
})
export class ConfigDeletionModule {}
