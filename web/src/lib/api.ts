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
