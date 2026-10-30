import { clearSessionCookie, isAuthenticated, isConfigured, makeSessionCookie, passphraseMatches } from "../lib/session.mts";

const json = (body: Record<string, unknown>, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra },
  });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default async (req: Request) => {
  if (!isConfigured()) {
    return json(
      {
        authenticated: false,
        error: "not_configured",
        detail: "EDITOR_PASSPHRASE and SESSION_SECRET (32+ characters) must be set in Netlify environment variables.",
      },
      503
    );
  }

  if (req.method === "GET") {
    return json({ authenticated: isAuthenticated(req) });
  }

  if (req.method === "POST") {
    let body: { action?: string; passphrase?: string } = {};
    try {
      const text = await req.text();
      if (text.length > 2000) return json({ error: "too_large" }, 413);
      body = JSON.parse(text);
    } catch {
      return json({ error: "bad_request" }, 400);
    }

    if (body.action === "logout") {
      return json({ authenticated: false }, 200, { "Set-Cookie": clearSessionCookie() });
    }

    if (body.action === "login" && typeof body.passphrase === "string") {
      if (passphraseMatches(body.passphrase)) {
        return json({ authenticated: true }, 200, { "Set-Cookie": makeSessionCookie() });
      }
      await sleep(1000); // slows down guessing
      return json({ authenticated: false, error: "invalid" }, 401);
    }
    return json({ error: "bad_request" }, 400);
  }

  return json({ error: "method_not_allowed" }, 405);
};
