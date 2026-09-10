"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { login as loginRequest, setUnauthorizedHandler } from "@/lib/api";
import {
  clearSession,
  getStoredSession,
  saveSession,
  type AuthSession,
} from "@/lib/auth-storage";
import { getTokenExpiryMs } from "@/lib/jwt";

type AuthContextValue = {
  isReady: boolean;
  isAuthenticated: boolean;
  session: AuthSession | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(null);

  useEffect(() => {
    // อ่าน session จาก localStorage หลัง client mount เท่านั้น เพื่อเลี่ยง
    // hydration mismatch (ฝั่ง server ไม่มี localStorage) — เป็น deferred read
    // ที่ตั้งใจ ไม่ใช่ cascading render ที่ rule ตั้งใจกัน
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setSession(getStoredSession());
    setIsReady(true);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const result = await loginRequest({ username, password });
    const nextSession: AuthSession = {
      accessToken: result.accessToken,
      role: result.role,
    };
    saveSession(nextSession);
    setSession(nextSession);
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setSession(null);
  }, []);

  // 401 จาก API call ใดๆ (token หมดอายุ / ถูกเพิกถอน) → logout ทันที
  // AuthGuard จะ redirect ไป /login ต่อเอง
  useEffect(() => {
    setUnauthorizedHandler(logout);
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  // token หมดอายุระหว่างเปิดแอปค้างไว้ → logout ตอนถึงเวลา ไม่ต้องรอให้ผู้ใช้
  // ยิง API แล้วเจอ 401 ก้อนแรกก่อน · setTimeout(delay <= 0) เด้ง next tick
  // ไม่ใช่ระหว่าง render
  useEffect(() => {
    if (!session) return;
    const expiryMs = getTokenExpiryMs(session.accessToken);
    if (expiryMs === null) return;
    const timer = setTimeout(logout, Math.max(0, expiryMs - Date.now()));
    return () => clearTimeout(timer);
  }, [session, logout]);

  const value = useMemo<AuthContextValue>(
    () => ({
      isReady,
      isAuthenticated: session !== null,
      session,
      login,
      logout,
    }),
    [isReady, session, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
