// Server-side database connectivity check.
// Fails closed: anything other than a confirmed response is reported as a problem.

const json = (body: Record<string, string>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export default async () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return json({
      database: "not configured",
      detail: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing in Netlify environment variables.",
    });
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return json({ database: "failed", detail: "SUPABASE_URL is not a valid URL." });
  }
  if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".supabase.co")) {
    return json({ database: "failed", detail: "SUPABASE_URL must be an https://<project>.supabase.co address." });
  }

  try {
        const headers: Record<string, string> = { apikey: key.trim() };
    // Older JWT-style keys (start with "eyJ") also need the Authorization header.
    if (key.trim().startsWith("eyJ")) headers.Authorization = `Bearer ${key.trim()}`;
    const res = await fetch(`${parsed.origin}/rest/v1/`, {
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      return json({ database: "connected", detail: "Supabase responded successfully." });
    }
    return json({ database: "failed", detail: `Supabase responded with status ${res.status}.` });
  } catch {
    return json({ database: "failed", detail: "Could not reach Supabase (timeout or network error). The project may be paused." });
  }
};
