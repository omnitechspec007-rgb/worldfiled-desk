// Minimal server-side Supabase REST helper. Service key stays on the server.
// Every call fails closed: a non-2xx response throws, so a failed write is never reported as saved.

export class DbError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function config() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new DbError("Database is not configured.", 503);
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".supabase.co")) {
    throw new DbError("SUPABASE_URL is invalid.", 503);
  }
  const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;
  return { origin: parsed.origin, headers };
}

export async function db<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; prefer?: string } = {}
): Promise<T> {
  const { origin, headers } = config();
  const h = { ...headers };
  if (init.prefer) h.Prefer = init.prefer;
  let res: Response;
  try {
    res = await fetch(`${origin}/rest/v1/${path}`, {
      method: init.method ?? "GET",
      headers: h,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new DbError("Could not reach the database (timeout or network error).", 502);
  }
  if (!res.ok) {
    throw new DbError(`Database request failed (status ${res.status}).`, 502);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}
