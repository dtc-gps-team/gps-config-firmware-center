import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaClient, User } from '@prisma/client';
import { ActingUser, TaskService } from '../../src/task/task.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestPrisma, makeUser, resetDb } from './setup';

function actorFor(user: User, role: ActingUser['role']): ActingUser {
  return { id: user.id, role };
}

describe('TaskService (integration — real postgres)', () => {
  let prisma: PrismaClient;
  let service: TaskService;
  let operationUser: User;

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
    operationUser = await makeUser(prisma, { role: 'Operation' });
  });

  it('create → persists a row with defaults and a real FK to User', async () => {
    const assignee = await makeUser(prisma, { role: 'OT' });
    const task = await service.create(
      { title: 'ติดตั้งกล่องที่ไซต์ A', assignedTo: assignee.id },
      actorFor(operationUser, 'Operation'),
    );

    const row = await prisma.task.findUnique({
      where: { id: task.id },
      include: { assignedUser: true },
    });
    expect(row).not.toBeNull();
    expect(row!.status).toBe('pending');
    expect(row!.assignedUser.id).toBe(assignee.id);
  });

  it('create → rejects when assignedTo has no matching User (FK constraint P2003)', async () => {
    await expect(
      service.create(
        { title: 'orphan', assignedTo: 'no-such-user-id' },
        actorFor(operationUser, 'Operation'),
      ),
    ).rejects.toMatchObject({ code: 'P2003' });

    expect(await prisma.task.count()).toBe(0);
  });

  it('create → role อื่นที่ไม่ใช่ Operation สร้างงานไม่ได้ (403)', async () => {
    const swUser = await makeUser(prisma, { role: 'SW' });
    await expect(
      service.create(
        { title: 'x', assignedTo: swUser.id },
        actorFor(swUser, 'SW'),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(await prisma.task.count()).toBe(0);
  });

  it('findAll → Operation filters by status and assignedTo, newest first', async () => {
    const assignee = await makeUser(prisma, { role: 'OT' });
    const other = await makeUser(prisma, { role: 'OT' });
    const actor = actorFor(operationUser, 'Operation');
    await service.create({ title: 'a', assignedTo: assignee.id }, actor);
    const b = await service.create(
      { title: 'b', assignedTo: assignee.id },
      actor,
    );
    await prisma.task.update({
      where: { id: b.id },
      data: { status: 'completed' },
    });
    await service.create({ title: 'c', assignedTo: other.id }, actor);

    const minePending = await service.findAll(
      { assignedTo: assignee.id, status: 'pending' },
      actor,
    );
    expect(minePending.map((t) => t.title)).toEqual(['a']);

    const allAssigneeTasks = await service.findAll(
      { assignedTo: assignee.id },
      actor,
    );
    expect(allAssigneeTasks).toHaveLength(2);
    expect(allAssigneeTasks[0].createdAt.getTime()).toBeGreaterThanOrEqual(
      allAssigneeTasks[1].createdAt.getTime(),
    );
  });

  it('findAll → ST/OT เห็นเฉพาะงานตัวเอง แม้ query assignedTo จะระบุคนอื่น', async () => {
    const stUser = await makeUser(prisma, { role: 'ST' });
    const otherUser = await makeUser(prisma, { role: 'OT' });
    const opActor = actorFor(operationUser, 'Operation');
    await service.create({ title: 'mine', assignedTo: stUser.id }, opActor);
    await service.create({ title: 'other', assignedTo: otherUser.id }, opActor);

    const result = await service.findAll(
      { assignedTo: otherUser.id },
      actorFor(stUser, 'ST'),
    );

    expect(result.map((t) => t.title)).toEqual(['mine']);
  });

  it('update → Operation applies a partial change and bumps updatedAt', async () => {
    const assignee = await makeUser(prisma, { role: 'OT' });
    const actor = actorFor(operationUser, 'Operation');
    const task = await service.create(
      { title: 'draft', assignedTo: assignee.id },
      actor,
    );
    const before = task.updatedAt.getTime();
    await new Promise((r) => setTimeout(r, 5));

    const updated = await service.update(
      task.id,
      { status: 'in_progress' },
      actor,
    );

    expect(updated.status).toBe('in_progress');
    expect(updated.title).toBe('draft');
    expect(updated.updatedAt.getTime()).toBeGreaterThan(before);
  });

  it('update → throws NotFoundException for a missing id (Operation)', async () => {
    await expect(
      service.update(
        '11111111-1111-1111-1111-111111111111',
        { title: 'x' },
        actorFor(operationUser, 'Operation'),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('update → เจ้าของงาน (ST/OT) แก้ status ตัวเองได้', async () => {
    const stUser = await makeUser(prisma, { role: 'ST' });
    const task = await service.create(
      { title: 'mine', assignedTo: stUser.id },
      actorFor(operationUser, 'Operation'),
    );

    const updated = await service.update(
      task.id,
      { status: 'completed' },
      actorFor(stUser, 'ST'),
    );

    expect(updated.status).toBe('completed');
  });

  it('update → เจ้าของงาน (ST/OT) แก้ field อื่นนอกจาก status ไม่ได้ (403)', async () => {
    const stUser = await makeUser(prisma, { role: 'ST' });
    const task = await service.create(
      { title: 'mine', assignedTo: stUser.id },
      actorFor(operationUser, 'Operation'),
    );

    await expect(
      service.update(task.id, { title: 'hacked' }, actorFor(stUser, 'ST')),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const row = await prisma.task.findUnique({ where: { id: task.id } });
    expect(row!.title).toBe('mine');
  });

  it('update → ST/OT แก้งานที่ไม่ใช่ของตัวเองไม่ได้ (404 ไม่เปิดเผยว่ามี record)', async () => {
    const stUser = await makeUser(prisma, { role: 'ST' });
    const otherUser = await makeUser(prisma, { role: 'OT' });
    const task = await service.create(
      { title: 'other', assignedTo: otherUser.id },
      actorFor(operationUser, 'Operation'),
    );

    await expect(
      service.update(task.id, { status: 'completed' }, actorFor(stUser, 'ST')),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deleting a User with tasks is blocked by ON DELETE RESTRICT', async () => {
    const assignee = await makeUser(prisma, { role: 'OT' });
    await service.create(
      { title: 'keep-me', assignedTo: assignee.id },
      actorFor(operationUser, 'Operation'),
    );
    await expect(
      prisma.user.delete({ where: { id: assignee.id } }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });
});
