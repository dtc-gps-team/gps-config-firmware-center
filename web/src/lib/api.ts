export type LoginRequest = {
  username: string;
  password: string;
};

export type LoginResponse = {
  accessToken: string;
  role: string;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
    /** รายการ error ย่อย (เช่น backend validateFields ที่ส่ง `{ message, errors: string[] }`) */
    readonly details?: string[],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "/api/v1";

/**
 * เรียกเมื่อ authenticated request (ส่ง token) เจอ 401 — token หมดอายุ / ถูก
 * เพิกถอน / `JWT_SECRET` เปลี่ยน · `AuthProvider` ลงทะเบียน `logout` ไว้ที่นี่
 * เพื่อให้ `AuthGuard` เด้งไป `/login` แทนการวนลูป error 401 ในทุกหน้า
 */
type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(
  handler: UnauthorizedHandler | null,
): void {
  onUnauthorized = handler;
}

function getErrorMessage(body: unknown, fallback: string): string {
  if (typeof body === "object" && body !== null && "message" in body) {
    const message = (body as { message: unknown }).message;
    if (typeof message === "string") return message;
    if (Array.isArray(message) && message.every((m) => typeof m === "string")) {
      return message.join(", ");
    }
  }
  return fallback;
}

function getErrorDetails(body: unknown): string[] | undefined {
  if (typeof body !== "object" || body === null || !("errors" in body)) {
    return undefined;
  }
  const errors = (body as { errors: unknown }).errors;
  if (!Array.isArray(errors)) return undefined;

  // backend validateFields — `errors: string[]`
  if (errors.every((e) => typeof e === "string")) {
    return errors as string[];
  }

  // class-validator shape (เช่น `POST /config/import`) —
  // `errors: [{ property, constraints: { rule: message } }]` → flatten เป็น string
  const flattened = errors
    .map((e) => {
      if (typeof e !== "object" || e === null) return null;
      const { property, constraints } = e as {
        property?: unknown;
        constraints?: unknown;
      };
      const messages =
        typeof constraints === "object" && constraints !== null
          ? Object.values(constraints).filter(
              (m): m is string => typeof m === "string",
            )
          : [];
      if (messages.length === 0) return null;
      return typeof property === "string" && property
        ? `${property}: ${messages.join(", ")}`
        : messages.join(", ");
    })
    .filter((m): m is string => m !== null);

  return flattened.length > 0 ? flattened : undefined;
}

export async function login(request: LoginRequest): Promise<LoginResponse> {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(
      getErrorMessage(body, "เข้าสู่ระบบไม่สำเร็จ"),
      response.status,
    );
  }

  return body as LoginResponse;
}

export async function apiFetch(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<Response> {
  const { token, headers, ...rest } = init;

  const mergedHeaders = new Headers(headers);
  // FormData (เช่น อัปโหลดไฟล์ `POST /config/import`) ต้องปล่อยให้ browser ตั้ง
  // `Content-Type: multipart/form-data; boundary=…` เอง — ถ้า set เป็น JSON
  // ทับไว้ boundary จะหาย แล้ว backend parse ไฟล์ไม่ออก
  const isFormData =
    typeof FormData !== "undefined" && rest.body instanceof FormData;
  if (!isFormData && !mergedHeaders.has("Content-Type")) {
    mergedHeaders.set("Content-Type", "application/json");
  }
  if (token) {
    mergedHeaders.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: mergedHeaders,
  });

  // เฉพาะ call ที่ส่ง token มาแล้วโดน 401 = session ใช้ไม่ได้แล้ว → แจ้ง
  // AuthProvider ให้ logout (call ที่ไม่มี token ไม่นับ — ไม่ควรมีอยู่แล้ว
  // สำหรับ endpoint ที่ต้อง auth แต่กันไว้)
  if (response.status === 401 && token) {
    onUnauthorized?.();
  }

  return response;
}

/**
 * `apiFetch` + parse JSON + โยน `ApiError` เมื่อ response ไม่ ok (4xx/5xx) —
 * ใช้กับทุก endpoint ที่ต้อง auth (ส่ง `token` มาด้วย) `message` ของ error
 * เอามาจาก body ของ backend (`{ message }`) ถ้ามี ไม่งั้นใช้ fallback
 */
export async function apiJson<T>(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<T> {
  const response = await apiFetch(path, init);

  // 204 No Content (เช่น DELETE) — ไม่มี body ให้ parse
  if (response.status === 204) return undefined as T;

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(
      getErrorMessage(body, `คำขอไม่สำเร็จ (${response.status})`),
      response.status,
      getErrorDetails(body),
    );
  }

  return body as T;
}
