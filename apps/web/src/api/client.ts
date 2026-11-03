// Small fetch layer: session cookies, JSON envelopes, typed errors.
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message)
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  })
  if (res.status === 204) return undefined as T
  const text = await res.text()
  let payload: unknown = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = text
    }
  }
  if (!res.ok) {
    const err = (payload as { error?: { code?: string; message?: string } } | null)?.error
    throw new ApiError(res.status, err?.code ?? 'error', err?.message ?? `Request failed (${res.status})`)
  }
  return payload as T
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body),
  delete: <T>(url: string, body?: unknown) => request<T>('DELETE', url, body),
}

export const QUERY_KEYS = {
  me: ['me'] as const,
  board: ['board'] as const,
  setupStatus: ['setup-status'] as const,
  flight: (id: string) => ['flight', id] as const,
  positions: (id: string) => ['positions', id] as const,
  alerts: (id: string) => ['alerts', id] as const,
  logbook: (q: string, year: string) => ['logbook', q, year] as const,
  stats: ['stats'] as const,
  airports: (q: string) => ['airports', q] as const,
  airlines: ['airlines'] as const,
  boardInvalidate: () => void 0,
}
