import { Module } from '@nestjs/common';
// เพิ่มใหม่: alias เพราะชื่อชนกับ ConfigModule ของ business domain (./config/config.module)
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
    ConfigModule,
    TaskModule,
    NotificationModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
