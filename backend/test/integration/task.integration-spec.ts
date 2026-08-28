import { NotFoundException } from '@nestjs/common';
import { PrismaClient, User } from '@prisma/client';
import { TaskService } from '../../src/task/task.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestPrisma, makeUser, resetDb } from './setup';

describe('TaskService (integration — real postgres)', () => {
  let prisma: PrismaClient;
  let service: TaskService;
  let user: User;

  beforeAll(async () => {
    prisma = createTestPrisma();
    await prisma.$connect();
    service = new TaskService(prisma as unknown as PrismaService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    user = await makeUser(prisma);
  });

  it('create → persists a row with defaults and a real FK to User', async () => {
    const task = await service.create({
      title: 'ติดตั้งกล่องที่ไซต์ A',
      assignedTo: user.id,
    });

    const row = await prisma.task.findUnique({
      where: { id: task.id },
      include: { assignedUser: true },
    });
    expect(row).not.toBeNull();
    expect(row!.status).toBe('pending');
    expect(row!.assignedUser.id).toBe(user.id);
  });

  it('create → rejects when assignedTo has no matching User (FK constraint P2003)', async () => {
    await expect(
      service.create({ title: 'orphan', assignedTo: 'no-such-user-id' }),
    ).rejects.toMatchObject({ code: 'P2003' });

    expect(await prisma.task.count()).toBe(0);
  });

  it('findAll → filters by status and assignedTo, newest first', async () => {
    const other = await makeUser(prisma);
    await service.create({ title: 'a', assignedTo: user.id });
    const b = await service.create({ title: 'b', assignedTo: user.id });
    await prisma.task.update({
      where: { id: b.id },
      data: { status: 'completed' },
    });
    await service.create({ title: 'c', assignedTo: other.id });

    const minePending = await service.findAll({
      assignedTo: user.id,
      status: 'pending',
    });
    expect(minePending.map((t) => t.title)).toEqual(['a']);

    const allMine = await service.findAll({ assignedTo: user.id });
    expect(allMine).toHaveLength(2);
    expect(allMine[0].createdAt.getTime()).toBeGreaterThanOrEqual(
      allMine[1].createdAt.getTime(),
    );
  });

  it('update → applies a partial change and bumps updatedAt', async () => {
    const task = await service.create({ title: 'draft', assignedTo: user.id });
    const before = task.updatedAt.getTime();
    await new Promise((r) => setTimeout(r, 5));

    const updated = await service.update(task.id, { status: 'in_progress' });

    expect(updated.status).toBe('in_progress');
    expect(updated.title).toBe('draft');
    expect(updated.updatedAt.getTime()).toBeGreaterThan(before);
  });

  it('update → throws NotFoundException for a missing id', async () => {
    await expect(
      service.update('11111111-1111-1111-1111-111111111111', { title: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deleting a User with tasks is blocked by ON DELETE RESTRICT', async () => {
    await service.create({ title: 'keep-me', assignedTo: user.id });
    await expect(
      prisma.user.delete({ where: { id: user.id } }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });
});
