import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [
    JwtModule.register({
      // JWT_SECRET ต้องตรงกับที่ .env กำหนด
      secret: process.env.JWT_SECRET ?? 'changeme',
      signOptions: { expiresIn: '8h' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  // export ให้ module อื่น (Task, Notification, Config, ...) import AuthModule
  // แล้วใช้ JwtAuthGuard/JwtModule ร่วมกันได้เลย แทนที่จะ JwtModule.register(...)
  // ซ้ำเองแบบที่ NotificationModule เคยทำไว้ชั่วคราวก่อนมี auth module
  exports: [JwtModule, JwtAuthGuard],
})
export class AuthModule {}
