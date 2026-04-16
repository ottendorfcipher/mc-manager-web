/** Base API client. Cookies (JWT) are sent automatically via `credentials: include`. */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (res.status === 401) {
    // Redirect to login — no need to bubble an error
    window.location.href = "/auth/login";
    return undefined as unknown as T;
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error ?? "Unknown error");
  }

  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

export const api = {
  get:    <T>(path: string)                          => request<T>(path),
  post:   <T>(path: string, body?: unknown)          => request<T>(path, { method: "POST",  body: JSON.stringify(body) }),
  put:    <T>(path: string, body?: unknown)          => request<T>(path, { method: "PUT",   body: JSON.stringify(body) }),
  patch:  <T>(path: string, body?: unknown)          => request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string)                          => request<T>(path, { method: "DELETE" }),
};
