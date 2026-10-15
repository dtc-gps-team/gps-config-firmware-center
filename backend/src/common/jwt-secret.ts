/**
 * ตรวจ `JWT_SECRET` ตอน startup (เรียกจาก main.ts ก่อนสร้างแอป)
 *
 * ทำไมต้องมี: `AuthModule` และ `TaskModule` ใช้ `'changeme'` แทนแบบเงียบๆ ถ้าไม่ได้
 * ตั้ง `JWT_SECRET` สะดวกตอนพัฒนา แต่ถ้า backend เปิดให้คนภายนอกเรียกได้ (deploy จริง
 * หรือเปิด tunnel ตอนทดสอบด้วยมือถือตาม docs/19 หัวข้อ 10) ใครที่รู้ค่า default นี้ก็
 * sign token ปลอมเป็น Admin ได้ทันที ตรวจที่นี่จุดเดียวก่อนสร้างแอป จึงครอบคลุมทุก
 * module ที่อ่าน `JWT_SECRET` โดยไม่ต้องแก้ไฟล์ของ module นั้น
 *
 * **ตรวจเมื่อไร:** `NODE_ENV=production` (deploy จริง) หรือมีการตั้ง `TRUST_PROXY`
 * (แปลว่า backend อยู่หลัง proxy หรือ tunnel ที่คนภายนอกเข้าถึงได้ แม้จะรันด้วย dev
 * server) นอกเหนือจากนี้ถือเป็นการพัฒนาในเครื่อง ไม่บังคับ
 *
 * **ถือว่าไม่ปลอดภัยเมื่อ:** ไม่ได้ตั้ง, เป็นค่าตัวอย่างที่รู้กันทั่วไป หรือสั้นกว่า
 * `MIN_JWT_SECRET_LENGTH` ตัวอักษร (HS256 ควรใช้ key ยาวอย่างน้อย 256 bit)
 *
 * mirror แนวทางของ `resolveTrustProxy()` และ guard ของ FCM: ค่าที่อันตราย throw ตอน
 * startup ให้รู้ทันที ไม่ปล่อยให้ระบบรันต่อแบบเงียบๆ
 */

export const MIN_JWT_SECRET_LENGTH = 32;

/** ค่าที่รู้กันทั่วไป: fallback ในโค้ด และค่าตัวอย่างใน `.env.example` */
const KNOWN_PLACEHOLDER_SECRETS = new Set([
  'changeme',
  'changeme-generate-a-real-secret',
]);

export function shouldEnforceJwtSecret(env: NodeJS.ProcessEnv): boolean {
  if (env.NODE_ENV === 'production') return true;
  const trustProxy = env.TRUST_PROXY?.trim().toLowerCase() ?? '';
  return trustProxy !== '' && trustProxy !== '0' && trustProxy !== 'false';
}

export function assertJwtSecret(env: NodeJS.ProcessEnv): void {
  if (!shouldEnforceJwtSecret(env)) return;

  const secret = env.JWT_SECRET?.trim() ?? '';
  const reason =
    secret === ''
      ? 'ไม่ได้ตั้งค่า'
      : KNOWN_PLACEHOLDER_SECRETS.has(secret)
        ? 'ยังเป็นค่าตัวอย่าง'
        : secret.length < MIN_JWT_SECRET_LENGTH
          ? `สั้นกว่า ${MIN_JWT_SECRET_LENGTH} ตัวอักษร`
          : null;

  if (reason !== null) {
    throw new Error(
      `JWT_SECRET ${reason} แต่ backend กำลังรันแบบที่คนภายนอกเข้าถึงได้ ` +
        `(NODE_ENV=production หรือตั้ง TRUST_PROXY) ใครก็ปลอม token ได้ ` +
        `ให้ตั้งเป็นค่าสุ่มอย่างน้อย ${MIN_JWT_SECRET_LENGTH} ตัวอักษร ` +
        `เช่น node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`,
    );
  }
}
