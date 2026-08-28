/**
 * Guard เบื้องต้น — เมื่อ A สร้าง auth module ให้ย้าย guard นี้เข้าไปอยู่ใน module auth แทน
 *
 * ทำหน้าที่:
 *  1. ดึง Bearer token จาก Authorization header
 *  2. verify ด้วย JwtService + JWT_SECRET จาก .env
 *  3. แนบ decoded payload ไว้ที่ req.user = { sub, role }
 *  4. throw UnauthorizedException (401) ถ้า token ไม่มี / invalid / หมดอายุ
 */

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

export interface JwtPayload {
  sub: string;
  role: string;
  iat?: number;
  exp?: number;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractBearerToken(request);

    if (!token) {
      throw new UnauthorizedException('Authorization token is required');
    }

    try {
      const payload = this.jwtService.verify<JwtPayload>(token);
      // แนบ payload ไว้ที่ req.user เพื่อให้ controller เข้าถึง userId ผ่าน req.user.sub
      (request as Request & { user: JwtPayload }).user = {
        sub: payload.sub,
        role: payload.role,
      };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  private extractBearerToken(request: Request): string | undefined {
    const authHeader = request.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return undefined;
    }
    return authHeader.slice(7); // ตัด "Bearer " ออก
  }
}
