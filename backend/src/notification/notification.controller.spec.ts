import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Notification } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const JWT_SECRET = 'test-secret';

const sampleNotification: Notification = {
  id: '22222222-2222-2222-2222-222222222222',
  userId: 'user-abc',
  type: 'task_assigned',
  payload: { taskId: 'task-1' },
  read: false,
  sentAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

// ---------------------------------------------------------------------------
// Helper: สร้าง Bearer token จริงด้วย JwtService.sign() เพื่อทดสอบ JwtAuthGuard
// ---------------------------------------------------------------------------

function buildToken(sub: string, role: string): string {
  const jwtService = new JwtService({ secret: JWT_SECRET });
  return jwtService.sign({ sub, role });
}

// ---------------------------------------------------------------------------
// Controller tests (JwtAuthGuard resolved ผ่าน DI + JwtService mock)
// ---------------------------------------------------------------------------

describe('NotificationController', () => {
  let controller: NotificationController;
  let service: jest.Mocked<
    Pick<NotificationService, 'findByUser' | 'markRead'>
  >;

  beforeEach(async () => {
    service = {
      findByUser: jest.fn(),
      markRead: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationController],
      providers: [
        { provide: NotificationService, useValue: service },
        // provide JwtService ตรงๆ เพื่อให้ JwtAuthGuard inject ได้ใน test module
        { provide: JwtService, useValue: new JwtService({ secret: JWT_SECRET }) },
        JwtAuthGuard,
      ],
    }).compile();

    controller = module.get(NotificationController);
  });

  it('GET /notifications — คืน notification ทั้งหมดของ user', async () => {
    service.findByUser.mockResolvedValue([sampleNotification]);

    const fakeReq = {
      user: { sub: 'user-abc', role: 'OT' },
    } as Parameters<typeof controller.findAll>[0];

    const result = await controller.findAll(fakeReq, {});

    expect(result).toEqual([sampleNotification]);
    expect(service.findByUser).toHaveBeenCalledWith('user-abc', undefined);
  });

  it('GET /notifications?unread=true — ส่ง unread=true เข้า service', async () => {
    service.findByUser.mockResolvedValue([sampleNotification]);

    const fakeReq = {
      user: { sub: 'user-abc', role: 'OT' },
    } as Parameters<typeof controller.findAll>[0];

    await controller.findAll(fakeReq, { unread: true });

    expect(service.findByUser).toHaveBeenCalledWith('user-abc', true);
  });

  it('PATCH /notifications/:id/read — เรียก service.markRead', async () => {
    const updated = { ...sampleNotification, read: true };
    service.markRead.mockResolvedValue(updated);

    const result = await controller.markRead(sampleNotification.id);

    expect(result).toEqual(updated);
    expect(service.markRead).toHaveBeenCalledWith(sampleNotification.id);
  });
});

// ---------------------------------------------------------------------------
// JwtAuthGuard — ทดสอบ guard logic โดยตรง (ไม่ผ่าน NestJS DI)
// ---------------------------------------------------------------------------

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;

  beforeEach(() => {
    guard = new JwtAuthGuard(new JwtService({ secret: JWT_SECRET }));
  });

  it('token ถูกต้อง — canActivate คืน true และ attach req.user', () => {
    const token = buildToken('user-abc', 'OT');
    const mockReq: Record<string, unknown> = {
      headers: { authorization: `Bearer ${token}` },
    };

    const ctx = {
      switchToHttp: () => ({ getRequest: () => mockReq }),
    } as Parameters<JwtAuthGuard['canActivate']>[0];

    const result = guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(mockReq['user']).toMatchObject({ sub: 'user-abc', role: 'OT' });
  });

  it('ไม่มี Authorization header — throw UnauthorizedException', () => {
    const mockReq = { headers: {} };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => mockReq }),
    } as Parameters<JwtAuthGuard['canActivate']>[0];

    expect(() => guard.canActivate(ctx)).toThrow('Authorization token is required');
  });

  it('token ไม่ถูกต้อง — throw UnauthorizedException', () => {
    const mockReq = {
      headers: { authorization: 'Bearer invalid.token.here' },
    };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => mockReq }),
    } as Parameters<JwtAuthGuard['canActivate']>[0];

    expect(() => guard.canActivate(ctx)).toThrow('Invalid or expired token');
  });
});
