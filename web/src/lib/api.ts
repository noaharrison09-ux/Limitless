export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, "You're offline. Try again when you have a connection.");
  }
  if (res.status === 401 && !path.startsWith("/auth")) {
    window.dispatchEvent(new Event("limitless:unauthorized"));
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown = {}) => request<T>("POST", path, body),
  put: <T>(path: string, body: unknown = {}) => request<T>("PUT", path, body),
  patch: <T>(path: string, body: unknown = {}) => request<T>("PATCH", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};

/** Tells every mounted screen to refetch (after a change elsewhere, or when the app comes back to the foreground). */
export function refreshAll() {
  window.dispatchEvent(new Event("limitless:refresh"));
}

export function toast(message: string) {
  window.dispatchEvent(new CustomEvent("limitless:toast", { detail: message }));
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
