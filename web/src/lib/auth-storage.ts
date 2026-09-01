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
