/**
 * ชุดชนิดข้อมูล (`dataType`) ที่ระบบรู้จักและ validate จริง — มติ issue #201
 * (อัปเดต 2026-09-22, แทนที่มติแรกทั้งหมด) เทียบจุดร่วมของชนิดข้อมูลพื้นฐานที่
 * MySQL/PostgreSQL/MongoDB มีเหมือนกันและเกี่ยวข้องกับการเก็บค่า config
 * parameter จริง — ตัด Binary และ Enum-as-separate-type ออก เพราะ
 * `ConfigFieldDefinition.allowedValues` ที่มีอยู่แล้วครอบคลุมกรณี enum พอ
 *
 * `ConfigFieldDefinition.dataType` ในฐานข้อมูลยังเป็น `String` เปล่า ไม่ใช่
 * Prisma enum (ตั้งใจ — จะได้เพิ่ม/ตัดชนิดในอนาคตโดยไม่ต้อง migration) ชุดนี้
 * คือขอบเขตที่ `@IsIn()` ของ DTO และ `matchesDataType()` ของ
 * `ConfigDefinitionService` ยึดร่วมกันเป็น single source of truth แทน
 *
 * ฝั่ง Web (`parameter-create-form.tsx`, `config-wizard.tsx`) มีชุดเดียวกันนี้
 * คัดลอกไว้ (ไม่มี shared package ข้าม backend/web ตามกฎ monorepo ใน
 * CLAUDE.md) — แก้ชุดนี้ต้องแก้ทั้งคู่
 */
export const CONFIG_DATA_TYPES = [
  'integer',
  'decimal',
  'string',
  'text',
  'boolean',
  'date',
  'datetime',
  'json',
  'array',
  'uuid',
] as const;

export type ConfigDataType = (typeof CONFIG_DATA_TYPES)[number];
