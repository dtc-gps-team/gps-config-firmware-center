import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';

@Module({
  // JwtModule/JwtAuthGuard ย้ายมารวมที่ AuthModule แล้ว (ตามคอมเมนต์เดิมที่ B ทิ้งไว้)
  // import AuthModule แทนการ JwtModule.register(...) ซ้ำเอง
  imports: [AuthModule],
  controllers: [NotificationController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
