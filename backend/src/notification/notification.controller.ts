import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Notification } from '@prisma/client';
import { Request } from 'express';
import { JwtPayload } from '../common/guards/jwt-auth.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { QueryNotificationDto } from './dto/query-notification.dto';
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
}
