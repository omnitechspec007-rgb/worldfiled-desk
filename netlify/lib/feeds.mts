// Safe feed retrieval and parsing.
// - http/https only; no IP literals, localhost or internal-looking hostnames
// - redirects followed manually (max 3) and re-validated at every hop
// - timeout and response-size limits
// - every failure is returned as an explicit error; nothing is ever reported as "empty but fine"
import { createHash } from "node:crypto";
import Parser from "rss-parser";

export function checkUrl(raw: string): URL {
  const u = new URL(raw);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("blocked protocol");
  const h = u.hostname.toLowerCase();
  if (u.username || u.password) throw new Error("blocked credentials in URL");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".lan")) {
    throw new Error("blocked internal hostname");
  }
  if (h.includes(":") || /^[0-9.]+$/.test(h) || /^0x[0-9a-f]+$/i.test(h) || !h.includes(".")) {
    throw new Error("blocked address");
  }
  return u;
}

export type Fetched = { ok: true; status: number; text: string; finalUrl: string } | { ok: false; status: number; error: string };

export async function safeFetch(
  url: string,
  opts: { timeoutMs?: number; maxBytes?: number; maxRedirects?: number } = {}
): Promise<Fetched> {
  const { timeoutMs = 6000, maxBytes = 2_000_000, maxRedirects = 3 } = opts;
  let current = url;
  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const u = checkUrl(current);
      const res = await fetch(u.toString(), {
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          "User-Agent": "WorldFiledDesk/0.1 (editorial research reader)",
          Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5",
        },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return { ok: false, status: res.status, error: "redirect without location" };
        current = new URL(loc, u).toString();
        continue;
      }
      if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };
      const declared = Number(res.headers.get("content-length") ?? 0);
      if (declared > maxBytes) return { ok: false, status: res.status, error: "response too large" };
      const reader = res.body?.getReader();
      if (!reader) return { ok: false, status: res.status, error: "empty response body" };
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > maxBytes) {
          await reader.cancel();
          return { ok: false, status: res.status, error: "response too large" };
        }
        chunks.push(value);
      }
      return { ok: true, status: res.status, text: Buffer.concat(chunks).toString("utf8"), finalUrl: u.toString() };
    }
    return { ok: false, status: 0, error: "too many redirects" };
  } catch (e: any) {
    const m = String(e?.message ?? e);
    if (m.startsWith("blocked")) return { ok: false, status: 0, error: m };
    if (e?.name === "TimeoutError" || /timed? ?out|aborted/i.test(m)) return { ok: false, status: 0, error: "timed out" };
    return { ok: false, status: 0, error: "network error" };
  }
}

export function normalizeUrl(raw: string): string {
  const u = new URL(raw);
  u.hash = "";
  u.hostname = u.hostname.toLowerCase();
  for (const k of [...u.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid|mc_|ref$|ref_)/i.test(k)) u.searchParams.delete(k);
  }
  let s = u.toString();
  if (s.endsWith("/") && u.pathname !== "/") s = s.slice(0, -1);
  return s;
}

export const urlHash = (raw: string) => createHash("sha256").update(normalizeUrl(raw)).digest("hex");

export type Item = { url: string; title: string; summary: string | null; publishedAt: string | null };

export type FeedResult =
  | { status: "healthy"; items: Item[]; skippedOld: number; http: number }
  | { status: "degraded"; items: []; error: string; http: number }
  | { status: "failing"; items: []; error: string; http: number };

const stripHtml = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

export async function fetchFeed(feedUrl: string, windowDays = 3, maxItems = 12, now = Date.now()): Promise<FeedResult> {
  const got = await safeFetch(feedUrl);
  if (!got.ok) return { status: "failing", items: [], error: got.error, http: got.status };

  let feed: Parser.Output<Record<string, unknown>>;
  try {
    feed = await new Parser({ timeout: 1000 }).parseString(got.text);
  } catch {
    return { status: "failing", items: [], error: "response was not a valid feed (malformed XML or a web page)", http: got.status };
  }
  if (!feed.items || feed.items.length === 0) {
    // Reachable but nothing parsed: flag it. This is NOT evidence that nothing happened.
    return { status: "degraded", items: [], error: "feed parsed but contained no items", http: got.status };
  }

  const cutoff = now - windowDays * 86_400_000;
  const items: Item[] = [];
  let skippedOld = 0;
  for (const it of feed.items) {
    const link = (it.link ?? "").trim();
    const title = stripHtml(it.title ?? "").slice(0, 300);
    if (!link || !title) continue;
    let url: string;
    try {
      url = checkUrl(new URL(link, got.finalUrl).toString()).toString();
    } catch {
      continue;
    }
    const t = Date.parse(it.isoDate ?? it.pubDate ?? "");
    const publishedAt = Number.isFinite(t) && t <= now + 86_400_000 ? new Date(t).toISOString() : null;
    if (publishedAt && Date.parse(publishedAt) < cutoff) {
      skippedOld++;
      continue;
    }
    const summary = stripHtml(String(it.contentSnippet ?? it.summary ?? it.content ?? "")).slice(0, 400) || null;
    items.push({ url, title, summary, publishedAt });
  }
  items.sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
  return { status: "healthy", items: items.slice(0, maxItems), skippedOld, http: got.status };
}
