"use client";

/** Thin fetch wrapper for client components: JSON in/out, throws Error(message) on non-2xx. */
export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number, public details?: unknown) {
    super(message);
  }
}

interface Opts extends Omit<RequestInit, "body"> {
  body?: unknown;
}

export async function apiFetch<T = unknown>(url: string, opts: Opts = {}): Promise<T> {
  const { body, headers, ...rest } = opts;
  const res = await fetch(url, {
    ...rest,
    headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(headers ?? {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = json?.error ?? {};
    throw new ApiError(err.code ?? "ERROR", err.message ?? `Request failed (${res.status})`, res.status, err.details);
  }
  return (json.data ?? json) as T;
}
