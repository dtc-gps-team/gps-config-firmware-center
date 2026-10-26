import { PrismaClient } from '@prisma/client';

/**
 * ชื่อ Campaign ระบบตัวเดียวที่ใช้เก็บ Rollout เครื่องเดียวของ "คำขอส่ง
 * Config จากหน้างาน" (docs/25 §3.2 ทาง ค. Hybrid, Q2 ที่ A ยืนยันแล้ว) — ไม่
 * เพิ่ม field ใหม่ใน schema (`campaignId`/`source`) ตามที่ตกลงกัน ใช้แค่
 * Campaign แถวเดียวที่หาด้วยชื่อนี้แทน (เช็คด้วย `===` เท่านั้น ไม่ใช่ regex/
 * substring — ชื่อนี้ไม่ควรมีใครสร้าง Campaign จริงชนกันเองเพราะมีเครื่องหมาย
 * `()` ที่ผู้ใช้จริงไม่น่าตั้งชื่อซ้ำ)
 *
 * **ใช้เทียบที่ 2 จุด:**
 * - `CampaignService.findAll()` (ซ่อนจาก Campaign Monitor, Q2)
 * - `IncidentService.handleRolloutFailed()` (ไม่สร้าง Incident จากคำขอ
 *   หน้างานที่ล้มเหลว, Q4 — ความล้มเหลวรายคำขอแจ้งผู้ขอผ่าน notification พอ)
 */
export const FIELD_APPLY_SYSTEM_CAMPAIGN_NAME =
  'ระบบ: คำขอส่ง Config จากหน้างาน (ห้ามลบ — docs/25)';

/**
 * หา Campaign ระบบตัวนี้ ถ้ายังไม่มีให้สร้างใหม่ (lazy — ไม่ seed ตอน startup
 * เพราะ `createdBy` ต้องเป็น User ที่มีอยู่จริง และในสภาพแวดล้อม production
 * ไม่รับประกันว่ามี test user ให้ seed ผูกด้วยตอนนั้น) ใช้ `actorId` ของ
 * Operation ที่กำลังอนุมัติคำขออยู่ตอนนี้เป็น `createdBy` ตอนสร้างครั้งแรก —
 * เป็นแค่ metadata ไม่มีผลต่อ SoD ของ Rollout เครื่องเดียวที่สร้างตามมา (เช็ค
 * SoD จริงอยู่ที่ `ConfigApplyRequest` ของ B ก่อนเรียกมาถึงจุดนี้แล้ว)
 *
 * **Known limitation:** ไม่ได้ล็อกกันคำขอ 2 รายการแรกพร้อมกันเป๊ะๆ (race
 * เล็กน้อยสร้าง Campaign ซ้ำได้ในทางทฤษฎี) — ผลคือมี Campaign ระบบ 2 แถว
 * ชื่อเดียวกัน ไม่กระทบการทำงาน (ทั้งคู่ถูกซ่อนจาก Monitor เหมือนกัน) แค่ไม่
 * สวย ยอมรับความเสี่ยงนี้แทนการเพิ่ม unique constraint ใหม่ใน schema
 */
export async function getOrCreateFieldApplySystemCampaign(
  prisma: Pick<PrismaClient, 'campaign'>,
  actorId: string,
): Promise<{ id: string }> {
  const existing = await prisma.campaign.findFirst({
    where: { name: FIELD_APPLY_SYSTEM_CAMPAIGN_NAME },
    select: { id: true },
  });
  if (existing) return existing;

  return prisma.campaign.create({
    data: {
      name: FIELD_APPLY_SYSTEM_CAMPAIGN_NAME,
      description:
        'สร้างอัตโนมัติ — เก็บ Rollout เครื่องเดียวของคำขอส่ง Config จากหน้างาน (docs/25) ไม่ใช่ Campaign จริงที่ Operation จัดการเอง',
      createdBy: actorId,
    },
    select: { id: true },
  });
}
