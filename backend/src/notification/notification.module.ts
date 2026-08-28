import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';

@Module({
  imports: [
    JwtModule.register({
      // JWT_SECRET ต้องตรงกับที่ใช้ใน auth service (ดู .env)
      // Guard เบื้องต้น — เมื่อ A สร้าง auth module ให้ย้าย JwtModule config เข้าไปอยู่ใน module auth แทน
      secret: process.env.JWT_SECRET ?? 'changeme',
      signOptions: { expiresIn: '8h' },
    }),
  ],
  controllers: [NotificationController],
  providers: [NotificationService, JwtAuthGuard],
  exports: [NotificationService],
})
export class NotificationModule {}
