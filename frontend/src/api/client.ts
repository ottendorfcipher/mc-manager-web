/** Base API client. Cookies (JWT) are sent automatically via `credentials: include`. */

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Read the current impersonation target from sessionStorage without importing
 *  the Zustand store (avoids circular deps at module init time). */
function getImpersonateHeader(): Record<string, string> {
  try {
    const raw = sessionStorage.getItem("rsc_impersonate_as");
    if (!raw) return {};
    const { email } = JSON.parse(raw) as { email: string };
    if (email) return { "x-impersonate-as": email };
  } catch { /* ignore */ }
  return {};
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      // Inject impersonation header on every request so the backend can
      // validate it per-request (no server-side session state needed).
      ...getImpersonateHeader(),
      ...(init.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error ?? "Unknown error");
  }

  const text = await res.text();
  if (!text) return undefined as unknown as T;
  return JSON.parse(text) as T;
}

export const api = {
  get:    <T>(path: string)             => request<T>(path),
  post:   <T>(path: string, body?: unknown) => request<T>(path, { method: "POST",  body: JSON.stringify(body) }),
  put:    <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT",   body: JSON.stringify(body) }),
  patch:  <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string)            => request<T>(path, { method: "DELETE" }),
};
