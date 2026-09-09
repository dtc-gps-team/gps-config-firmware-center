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
  if (typeof body === "object" && body !== null && "errors" in body) {
    const errors = (body as { errors: unknown }).errors;
    if (Array.isArray(errors) && errors.every((e) => typeof e === "string")) {
      return errors;
    }
  }
  return undefined;
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
  if (!mergedHeaders.has("Content-Type")) {
    mergedHeaders.set("Content-Type", "application/json");
  }
  if (token) {
    mergedHeaders.set("Authorization", `Bearer ${token}`);
  }

  return fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: mergedHeaders,
  });
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
