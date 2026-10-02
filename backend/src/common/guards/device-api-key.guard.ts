import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';

const API_KEY_HEADER = 'x-device-api-key';

/** อุปกรณ์ที่ auth ผ่านแล้ว — แนบไว้ที่ `req.device` (คนละ actor type กับ
 * `JwtPayload`/`req.user` ที่ใช้กับ staff/Web/Mobile — อุปกรณ์ไม่มี
 * username/password/role) */
export interface AuthenticatedDevice {
  deviceId: string;
}

/**
 * Guard สำหรับ endpoint ที่**อุปกรณ์**เรียกเอง (issue #157 PR 2/3 — ยังไม่มี
 * route ไหนผูก guard นี้จนกว่าจะถึง PR 2, ดู docs/14_Device_Sync_Proposal.md
 * §3.2/§5) — คนละตัวกับ `JwtAuthGuard` เพราะอุปกรณ์ไม่ใช่ staff ที่มี
 * username/password/role ตรวจ header `X-Device-Api-Key` เทียบกับ
 * `Device.apiKeyHash` ของเครื่องที่ path param `:deviceId` ระบุ (bcrypt
 * compare เดียวกับ `AuthService` ตรวจ `User.passwordHash`)
 *
 * ต้องอ่าน `apiKeyHash` กลับมาเอง (`omit: { apiKeyHash: false }`) เพราะ
 * `PrismaService` ตั้ง default omit สนามนี้ไว้ทั้งระบบ (ดู prisma.service.ts)
 * — จุดเดียวในระบบที่จงใจ override กลับ
 */
@Injectable()
export class DeviceApiKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const apiKey = request.headers[API_KEY_HEADER];
    const deviceId = request.params?.deviceId;

    if (typeof apiKey !== 'string' || !apiKey) {
      throw new UnauthorizedException(`ต้องแนบ header ${API_KEY_HEADER}`);
    }
    if (typeof deviceId !== 'string' || !deviceId) {
      throw new UnauthorizedException('ไม่พบ deviceId ใน path');
    }

    const device = await this.prisma.device.findUnique({
      where: { deviceId },
      omit: { apiKeyHash: false },
    });
    if (!device?.apiKeyHash) {
      // ไม่พบเครื่อง หรือเครื่องยังไม่เคยลงทะเบียนผ่าน POST /devices (ไม่มี
      // key เลย) — ข้อความเดียวกันทั้ง 2 กรณี กัน enumeration ว่า deviceId
      // ไหนมีอยู่จริงในระบบบ้าง
      throw new UnauthorizedException('deviceId หรือ API key ไม่ถูกต้อง');
    }

    const keyMatches = await bcrypt.compare(apiKey, device.apiKeyHash);
    if (!keyMatches) {
      throw new UnauthorizedException('deviceId หรือ API key ไม่ถูกต้อง');
    }

    (request as Request & { device: AuthenticatedDevice }).device = {
      deviceId: device.deviceId,
    };
    return true;
  }
}
