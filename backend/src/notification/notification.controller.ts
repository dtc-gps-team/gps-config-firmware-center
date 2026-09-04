import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { DeviceToken, Notification } from '@prisma/client';
import { Request } from 'express';
import { JwtPayload } from '../common/guards/jwt-auth.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { QueryNotificationDto } from './dto/query-notification.dto';
import {
  DeleteDeviceTokenDto,
  RegisterDeviceTokenDto,
} from './dto/register-device-token.dto';
import { NotificationService } from './notification.service';

/** Request ที่ผ่าน JwtAuthGuard จะมี user อยู่เสมอ */
type AuthenticatedRequest = Request & { user: JwtPayload };

@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  /**
   * GET /api/v1/notifications?unread=true
   * ดึงเฉพาะ notification ของ user ที่ login อยู่ (จาก JWT payload.sub)
   */
  @Get()
  findAll(
    @Req() req: AuthenticatedRequest,
    @Query() query: QueryNotificationDto,
  ): Promise<Notification[]> {
    return this.notificationService.findByUser(req.user.sub, query.unread);
  }

  /**
   * PATCH /api/v1/notifications/:notificationId/read
   * ทำเครื่องหมายว่าอ่านแล้ว (read = true)
   * ส่ง req.user.sub เข้าไปด้วยเพื่อป้องกัน IDOR — service จะส่ง 404 ถ้า notification ไม่ใช่ของ user นี้
   */
  @Patch(':notificationId/read')
  markRead(
    @Param('notificationId', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<Notification> {
    return this.notificationService.markRead(id, req.user.sub);
  }

  /**
   * POST /api/v1/notifications/device-tokens
   * ลงทะเบียน / อัปเดต FCM device token ของ user ปัจจุบัน (upsert ตาม token)
   * `userId` ผูกกับ JWT เสมอ — ไม่รับจาก client
   *
   * ตอบ 200 (ไม่ใช่ 201) เพราะเป็น upsert idempotent — เรียกซ้ำด้วย token เดิม
   * ไม่ได้สร้าง resource ใหม่
   */
  @Post('device-tokens')
  @HttpCode(200)
  registerDeviceToken(
    @Body() dto: RegisterDeviceTokenDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<DeviceToken> {
    return this.notificationService.registerDeviceToken(
      req.user.sub,
      dto.token,
      dto.platform,
    );
  }

  /**
   * DELETE /api/v1/notifications/device-tokens?token=<token>
   * ถอนทะเบียน device token (เรียกตอน logout) — IDOR-safe: ลบได้เฉพาะ token
   * ของตัวเอง (404 ถ้าไม่พบ / เป็นของคนอื่น)
   *
   * รับ token เป็น query param ไม่ใช่ path param เพราะ (1) FCM token มี `/` `:`
   * ที่เปราะเมื่ออยู่ใน path segment (2) path `/notifications/device-tokens/{token}`
   * ชนกับ `/notifications/{notificationId}/read` (redocly no-ambiguous-paths)
   */
  @Delete('device-tokens')
  @HttpCode(204)
  removeDeviceToken(
    @Query() query: DeleteDeviceTokenDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    return this.notificationService.removeDeviceToken(
      req.user.sub,
      query.token,
    );
  }
}
