/**
 * อ่าน JWT ฝั่ง client — **ไม่ verify signature** (นั่นเป็นงาน backend) ใช้แค่
 * ดูว่า access token หมดอายุหรือยัง เพื่อไม่ให้แอป render เป็น "login อยู่"
 * ทั้งที่ทุก API call จะเด้ง 401 (backend JWT TTL = 8 ชม.)
 */

/** เวลาหมดอายุของ token เป็น epoch ms · null = อ่าน `exp` ไม่ได้ / token พัง */
export function getTokenExpiryMs(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const decoded = JSON.parse(atob(padded)) as { exp?: unknown };
    return typeof decoded.exp === "number" ? decoded.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** token หมดอายุแล้ว — อ่าน `exp` ไม่ได้ก็ถือว่าใช้ไม่ได้ (ปลอดภัยไว้ก่อน) */
export function isTokenExpired(token: string): boolean {
  const expiryMs = getTokenExpiryMs(token);
  if (expiryMs === null) return true;
  return Date.now() >= expiryMs;
}

/** user id ของเจ้าของ token (`sub` claim) · null ถ้าอ่านไม่ได้ — ใช้ filter
 *  "ของฉัน" ฝั่ง client (backend ยัง enforce สิทธิ์จริงเสมอ) */
export function getTokenSubject(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const decoded = JSON.parse(atob(padded)) as { sub?: unknown };
    return typeof decoded.sub === "string" ? decoded.sub : null;
  } catch {
    return null;
  }
}
