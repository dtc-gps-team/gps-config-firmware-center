/**
 * backend กำลังรันแบบที่คนภายนอกเข้าถึงได้หรือไม่ ใช้เป็นกติกาเดียวของทุกการป้องกันที่
 * "ห้ามรันแบบเปิดด้วยค่าที่ทุกคนรู้" (`JWT_SECRET` ใน jwt-secret.ts, รหัสบัญชีทดสอบใน
 * test-users.ts และ seed)
 *
 * - `NODE_ENV=production` = deploy จริง (docker compose ตั้งค่านี้)
 * - ตั้ง `TRUST_PROXY` = อยู่หลัง proxy หรือ tunnel ที่คนภายนอกเรียกเข้ามาได้ แม้รันด้วย
 *   dev server (เช่นตอนทดสอบด้วยมือถือตาม docs/19 หัวข้อ 10)
 *
 * นอกเหนือจากนี้ถือเป็นการพัฒนาในเครื่อง ไม่บังคับอะไร
 */
export function isExposedEnvironment(env: NodeJS.ProcessEnv): boolean {
  if (env.NODE_ENV === 'production') return true;
  const trustProxy = env.TRUST_PROXY?.trim().toLowerCase() ?? '';
  return trustProxy !== '' && trustProxy !== '0' && trustProxy !== 'false';
}
