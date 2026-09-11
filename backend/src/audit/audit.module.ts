import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

/**
 * audit module (ฝั่ง A, Sprint 3 #27) — read-only endpoint `GET /audit-logs`
 *
 * การ**เขียน** AuditLog ไม่ได้อยู่ในโมดูลนี้ — แต่ละโมดูลเขียนเอง (ดู
 * audit.service.ts) โมดูลนี้จึงไม่ export อะไรให้โมดูลอื่น import
 */
@Module({
  imports: [AuthModule],
  controllers: [AuditController],
  providers: [AuditService],
})
export class AuditModule {}
