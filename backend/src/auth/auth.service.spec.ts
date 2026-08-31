import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

jest.mock('bcrypt', () => ({ compare: jest.fn() }));

type UserDelegateMock = { findUnique: jest.Mock };

const sampleUser = {
  id: 'user-1',
  username: 'sw.test',
  passwordHash: 'hashed',
  fullName: 'SW Tester',
  roleId: 'role-1',
  isActive: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  role: {
    id: 'role-1',
    code: 'SW',
    name: 'Software Engineer',
    description: null,
  },
};

async function buildService(
  user: UserDelegateMock,
): Promise<{ service: AuthService; jwtService: { sign: jest.Mock } }> {
  const jwtService = { sign: jest.fn().mockReturnValue('signed.jwt.token') };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      AuthService,
      { provide: PrismaService, useValue: { user } },
      { provide: JwtService, useValue: jwtService },
    ],
  }).compile();

  return { service: module.get(AuthService), jwtService };
}

describe('AuthService', () => {
  let user: UserDelegateMock;

  beforeEach(() => {
    user = { findUnique: jest.fn() };
    (bcrypt.compare as jest.Mock).mockReset();
  });

  it('login สำเร็จ: query user พร้อม role, เทียบ password ด้วย bcrypt, sign JWT {sub, role: role.code}', async () => {
    user.findUnique.mockResolvedValue(sampleUser);
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    const { service, jwtService } = await buildService(user);

    const result = await service.login('sw.test', 'password123');

    expect(user.findUnique).toHaveBeenCalledWith({
      where: { username: 'sw.test' },
      include: { role: true },
    });
    expect(bcrypt.compare).toHaveBeenCalledWith('password123', 'hashed');
    expect(jwtService.sign).toHaveBeenCalledWith({
      sub: 'user-1',
      role: 'SW',
    });
    expect(result).toEqual({ accessToken: 'signed.jwt.token', role: 'SW' });
  });

  it('username ไม่มีในระบบ: throw UnauthorizedException ไม่เรียก bcrypt เลย', async () => {
    user.findUnique.mockResolvedValue(null);
    const { service } = await buildService(user);

    await expect(service.login('nobody', 'x')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });

  it('user ถูกปิดใช้งาน (isActive=false): throw UnauthorizedException ไม่เรียก bcrypt เลย', async () => {
    user.findUnique.mockResolvedValue({ ...sampleUser, isActive: false });
    const { service } = await buildService(user);

    await expect(service.login('sw.test', 'password123')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });

  it('password ผิด: throw UnauthorizedException', async () => {
    user.findUnique.mockResolvedValue(sampleUser);
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);
    const { service } = await buildService(user);

    await expect(service.login('sw.test', 'wrong')).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
