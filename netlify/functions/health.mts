// Server-side database health check.
// Fails closed: anything other than a confirmed, successful read is reported as a problem.

import { isAuthenticated } from "../lib/session.mts";

const json = (body: Record<string, string>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export default async (req: Request) => {
  if (!isAuthenticated(req)) {
    return json({ database: "locked", detail: "Sign in as the editor to view system health." }, 401);
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

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

  const headers: Record<string, string> = { apikey: key };
  // Older JWT-style keys (start with "eyJ") also need the Authorization header.
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;

  try {
    // Read one row from a real table: proves the connection, the key AND that the schema is installed.
    const res = await fetch(`${parsed.origin}/rest/v1/research_runs?select=id&limit=1`, {
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      return json({
        database: "connected",
        detail: "Supabase responded and the research_runs table is readable (schema installed).",
      });
    }
    if (res.status === 404) {
      return json({
        database: "failed",
        detail: "Connected, but the research_runs table was not found. The schema may not be installed.",
      });
    }
    return json({ database: "failed", detail: `Supabase responded with status ${res.status}.` });
  } catch {
    return json({ database: "failed", detail: "Could not reach Supabase (timeout or network error). The project may be paused." });
  }
};
