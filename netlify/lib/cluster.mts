// Deterministic story grouping by headline similarity. Pure functions, no AI.
// IMPORTANT: grouping coverage of the same event is NOT independent corroboration.
import { createHash } from "node:crypto";

const STOP = new Set(
  "a an the and or but of in on at to for from by with as is are was were be been being it its this that these those after before over under into out up down amid says say said new report reports reported will would could may might has have had not no more most than also about against between during while".split(
    " "
  )
);

export function tokens(title: string): string[] {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

export function jaccard(a: Set<string>, b: Set<string>): { score: number; shared: number } {
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  const union = a.size + b.size - shared;
  return { score: union === 0 ? 0 : shared / union, shared };
}

export type ClusterInput = { id: string; title: string };
export type Cluster = { key: string; seedId: string; memberIds: string[] };

export const SIMILARITY = 0.5;
export const MIN_SHARED = 3;

export function clusterItems(items: ClusterInput[]): Cluster[] {
  const sorted = [...items].sort((x, y) => x.id.localeCompare(y.id));
  const clusters: { seed: ClusterInput; seedTokens: Set<string>; members: string[] }[] = [];
  for (const it of sorted) {
    const t = new Set(tokens(it.title));
    let placed = false;
    if (t.size >= MIN_SHARED) {
      for (const c of clusters) {
        const { score, shared } = jaccard(t, c.seedTokens);
        if (score >= SIMILARITY && shared >= MIN_SHARED) {
          c.members.push(it.id);
          placed = true;
          break;
        }
      }
    }
    if (!placed) clusters.push({ seed: it, seedTokens: t, members: [it.id] });
  }
  return clusters.map((c) => ({
    key: createHash("sha1").update([...c.seedTokens].sort().join(" ") || c.seed.id).digest("hex").slice(0, 20),
    seedId: c.seed.id,
    memberIds: c.members,
  }));
}
