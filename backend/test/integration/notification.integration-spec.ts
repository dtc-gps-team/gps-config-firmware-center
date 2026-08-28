import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient, User } from '@prisma/client';
import { NotificationService } from '../../src/notification/notification.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestPrisma, makeUser, resetDb } from './setup';

function buildService(prisma: PrismaClient): NotificationService {
  const config = {
    get: (_key: string, def?: string) => def ?? 'mock',
  } as unknown as ConfigService;
  return new NotificationService(prisma as unknown as PrismaService, config);
}

describe('NotificationService (integration — real postgres)', () => {
  let prisma: PrismaClient;
  let service: NotificationService;
  let owner: User;
  let attacker: User;

  beforeAll(async () => {
    prisma = createTestPrisma();
    await prisma.$connect();
    service = buildService(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    owner = await makeUser(prisma);
    attacker = await makeUser(prisma);
  });

  it('send (mock mode) → creates an unread row linked to the user', async () => {
    const n = await service.send({
      userId: owner.id,
      type: 'task_assigned',
      payload: { taskId: 'abc' },
    });

    const row = await prisma.notification.findUnique({
      where: { id: n.id },
      include: { user: true },
    });
    expect(row!.read).toBe(false);
    expect(row!.sentAt).toBeNull();
    expect(row!.user.id).toBe(owner.id);
    expect(row!.payload).toEqual({ taskId: 'abc' });
  });

  it('send → rejects when userId has no matching User (FK constraint P2003)', async () => {
    await expect(
      service.send({ userId: 'no-such-user', type: 'incident_alert' }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('markSent → stamps sentAt', async () => {
    const n = await service.send({ userId: owner.id, type: 'firmware_ready' });
    const sent = await service.markSent(n.id);
    expect(sent.sentAt).toBeInstanceOf(Date);
  });

  it("findByUser → returns only that user's rows, newest first, unread filter works", async () => {
    await service.send({ userId: owner.id, type: 'task_assigned' });
    const second = await service.send({
      userId: owner.id,
      type: 'config_approved',
    });
    await service.markRead(second.id, owner.id);
    await service.send({ userId: attacker.id, type: 'task_assigned' });

    const all = await service.findByUser(owner.id);
    expect(all).toHaveLength(2);
    expect(all[0].createdAt.getTime()).toBeGreaterThanOrEqual(
      all[1].createdAt.getTime(),
    );

    const unread = await service.findByUser(owner.id, true);
    expect(unread).toHaveLength(1);
    expect(unread[0].type).toBe('task_assigned');
  });

  it("markRead → marks the owner's notification as read", async () => {
    const n = await service.send({ userId: owner.id, type: 'task_assigned' });
    const read = await service.markRead(n.id, owner.id);
    expect(read.read).toBe(true);
  });

  it('markRead → IDOR: another user cannot mark it read (404, row untouched)', async () => {
    const n = await service.send({ userId: owner.id, type: 'task_assigned' });

    await expect(service.markRead(n.id, attacker.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    const row = await prisma.notification.findUnique({ where: { id: n.id } });
    expect(row!.read).toBe(false);
  });

  it('markRead → 404 for an id that does not exist at all', async () => {
    await expect(
      service.markRead('22222222-2222-2222-2222-222222222222', owner.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
