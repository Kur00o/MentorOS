import { supabase } from "./supabase";

export const API_BASE = ((import.meta.env.VITE_API_BASE_URL as string | undefined) || "").replace(/\/$/, "") + "/api/v1";

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function token(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

type Body = Record<string, unknown> | unknown[] | FormData | undefined;

export async function request<T>(method: string, path: string, body?: Body, opts: { raw?: boolean; signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const t = await token();
  if (t) headers.Authorization = `Bearer ${t}`;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { method, headers, body: payload, signal: opts.signal });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError(0, "network_error", "Can't reach MentorOS right now. Check your connection and try again.");
  }
  if (opts.raw && res.ok) return res as unknown as T;
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = data?.error;
    throw new ApiError(res.status, err?.code ?? "error", err?.message ?? data?.detail ?? `Request failed (${res.status})`, err?.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>("GET", path, undefined, { signal }),
  post: <T>(path: string, body?: Body) => request<T>("POST", path, body),
  put: <T>(path: string, body?: Body) => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: Body) => request<T>("PATCH", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};

/** Download an authenticated CSV/file response. */
export async function download(path: string, fallbackName: string): Promise<void> {
  const res = await request<Response>("GET", path, undefined, { raw: true });
  const blob = await res.blob();
  const cd = res.headers.get("content-disposition") || "";
  const name = /filename="?([^"]+)"?/.exec(cd)?.[1] || fallbackName;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "" && v !== false) p.set(k, String(v));
  });
  const s = p.toString();
  return s ? `?${s}` : "";
}
