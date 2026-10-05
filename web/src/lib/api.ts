import { localRequest } from "./localApi";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Everything is stored on this phone, so "requests" are answered in-page by the local data layer. */
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await localRequest(method, path, body);
  if (res.status >= 400) throw new ApiError(res.status, (res.body as { error?: string }).error ?? `Request failed (${res.status})`);
  // Hand screens their own copy, like a real network response would.
  return structuredClone(res.body) as T;
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
