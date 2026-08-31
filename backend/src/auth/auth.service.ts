import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { JwtPayload } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

export interface LoginResult {
  accessToken: string;
  role: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * ตรวจ username/password แล้ว sign JWT — payload = { sub: user.id, role: role.code }
   * ตรงกับ JwtPayload ใน common/guards/jwt-auth.guard.ts (guard ตัวเดิมที่ B ทำไว้)
   *
   * ใช้ error message เดียวกันทั้ง 3 เคส (username ไม่มี / user ถูกปิดใช้งาน / password ผิด)
   * เพื่อไม่ให้ผู้โจมตีเดา username ที่มีอยู่จริงในระบบได้จากข้อความ error ที่ต่างกัน
   */
  async login(username: string, password: string): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({
      where: { username },
      include: { role: true },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Username/Password ไม่ถูกต้อง');
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Username/Password ไม่ถูกต้อง');
    }

    const payload: JwtPayload = { sub: user.id, role: user.role.code };
    const accessToken = this.jwtService.sign(payload);

    return { accessToken, role: user.role.code };
  }
}
