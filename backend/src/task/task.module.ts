import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TaskController } from './task.controller';
import { TaskService } from './task.service';

@Module({
  imports: [
    JwtModule.register({
      // JWT_SECRET ต้องตรงกับที่ใช้ใน auth service (ดู .env)
      // Guard เบื้องต้น — เมื่อ A สร้าง auth module ให้ย้าย JwtModule config เข้าไปอยู่ใน module auth แทน
      // (pattern เดียวกับ NotificationModule — PR #39 ยังไม่ merge ตอนที่แก้ไฟล์นี้
      // เมื่อ merge แล้วให้ migrate ทั้งสอง module ไป import AuthModule พร้อมกัน)
      secret: process.env.JWT_SECRET ?? 'changeme',
      signOptions: { expiresIn: '8h' },
    }),
  ],
  controllers: [TaskController],
  providers: [TaskService, JwtAuthGuard],
  exports: [TaskService],
})
export class TaskModule {}
