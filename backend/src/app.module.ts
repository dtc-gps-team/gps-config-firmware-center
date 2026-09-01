import { Module } from '@nestjs/common';
// alias เพราะชื่อชนกับ business module ../config/config.module.ts (Config
// model/resource ของเราเอง) — ConfigModule เปล่าๆ ในไฟล์นี้หมายถึงตัวของเรา
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from './config/config.module';
import { NotificationModule } from './notification/notification.module';
import { PrismaModule } from './prisma/prisma.module';
import { TaskModule } from './task/task.module';

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      // env อยู่ที่ root ของ repo (ดู .env.example จาก Sprint 0) — backend ไม่มี .env ของตัวเอง
      envFilePath: ['../.env'],
    }),
    PrismaModule,
    AuthModule,
    TaskModule,
    NotificationModule,
    ConfigModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
