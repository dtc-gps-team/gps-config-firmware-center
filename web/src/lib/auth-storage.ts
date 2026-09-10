import { isTokenExpired } from "./jwt";

const TOKEN_KEY = "gps.accessToken";
const ROLE_KEY = "gps.role";

export type AuthSession = {
  accessToken: string;
  role: string;
};

export function getStoredSession(): AuthSession | null {
  if (typeof window === "undefined") return null;

  const accessToken = localStorage.getItem(TOKEN_KEY);
  const role = localStorage.getItem(ROLE_KEY);
  if (!accessToken || !role) return null;

  // token หมดอายุ (เช่น เปิดแอปทิ้งไว้ข้ามคืน / reboot แล้วกลับมา) — ล้างทิ้ง
  // ไม่คืน session ที่ยิง API ไม่ผ่าน ให้ AuthGuard เด้งไป /login แทนการค้าง
  // หน้าเดิมที่ทุก call เป็น 401 เงียบๆ
  if (isTokenExpired(accessToken)) {
    clearSession();
    return null;
  }

  return { accessToken, role };
}

export function saveSession(session: AuthSession): void {
  localStorage.setItem(TOKEN_KEY, session.accessToken);
  localStorage.setItem(ROLE_KEY, session.role);
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ROLE_KEY);
}
