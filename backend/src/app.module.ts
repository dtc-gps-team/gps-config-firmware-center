import { Module } from '@nestjs/common';
// เพิ่มใหม่: alias เพราะชื่อชนกับ ConfigModule ของ business domain (./config/config.module)
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from './config/config.module';
import { ConfigDefinitionModule } from './config-definition/config-definition.module';
import { ConfigDeletionModule } from './config-deletion/config-deletion.module';
import { ConfigSyncWriterModule } from './config-sync-writer/config-sync-writer.module';
import { DeviceModule } from './device/device.module';
import { IncidentModule } from './incident/incident.module';
import { NotificationModule } from './notification/notification.module';
import { PrismaModule } from './prisma/prisma.module';
import { TaskModule } from './task/task.module';
import { UserModule } from './user/user.module';

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      // env อยู่ที่ root ของ repo (ดู .env.example จาก Sprint 0) — backend ไม่มี .env ของตัวเอง
      envFilePath: ['../.env'],
    }),
    // scheduled job รายวันของ config-deletion (docs/11 Part A) — ยังไม่มี module
    // ไหนใช้ @Cron มาก่อน จึงเพิ่ม ScheduleModule.forRoot() ที่นี่ครั้งเดียว
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    ConfigModule,
    ConfigDefinitionModule,
    ConfigDeletionModule,
    ConfigSyncWriterModule,
    DeviceModule,
    IncidentModule,
    TaskModule,
    NotificationModule,
    UserModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
