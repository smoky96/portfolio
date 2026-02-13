import { clearSession, dispatchAuthExpired, getAccessToken } from "../auth/session";

const API_BASE = import.meta.env.VITE_API_BASE ?? "/api/v1";

export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAccessToken();
  const headers = new Headers(init?.headers ?? undefined);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const isFormDataBody = typeof FormData !== "undefined" && init?.body instanceof FormData;
  if (!isFormDataBody && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers
  });

  if (!res.ok) {
    const message = await res.text();
    if (res.status === 401) {
      clearSession();
      dispatchAuthExpired();
      throw new UnauthorizedError(message || "Unauthorized");
    }
    throw new Error(message || `Request failed: ${res.status}`);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  postForm: <T>(path: string, body: FormData) => request<T>(path, { method: "POST", body }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" })
};
