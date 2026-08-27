import { TaskStatus } from '@prisma/client';

/** ค่า status ทั้งหมดของงาน — ใช้ validate DTO ให้ตรงกับ enum ใน Prisma schema */
export const TASK_STATUSES: readonly TaskStatus[] = [
  'pending',
  'in_progress',
  'completed',
  'cancelled',
];
