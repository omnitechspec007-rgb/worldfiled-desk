// Creative Prompt Architect API. Approved stories only. Builds a story-specific Claude production prompt.
//   GET  ?storyId=ID            recommendation preview (nothing is saved)
//   POST {storyId, ...}         generate a prompt and save it as the next version in Prompt History
//   GET  ?history=1             list saved prompts (no prompt text)
//   GET  ?id=ID                 one saved prompt; the text is withheld if its approval is no longer current
// Two independent approval gates: this function checks the newest human decision, and the database
// trigger on creative_prompts checks it again at insert time.
import { hasSameOrigin, isAuthenticated } from "../lib/session.mts";
import { db, DbError } from "../lib/db.mts";
import { buildEvidencePack, classCounts, PackTooLarge, type EvStory } from "../lib/evidence-pack.mts";
import { recommendTreatment, getTreatment, TREATMENTS } from "../lib/treatments.mts";
import { DELIVERABLES, type Deliverable } from "../lib/production-tools.mts";
import { buildArchitectPrompt, PromptTooLarge, type StyleRuleIn } from "../lib/prompt-architect.mts";
import { brandChecklist, BRAND_VERSION } from "../lib/brand.mts";
import { scoreStory, type StoryInput } from "../lib/scoring.mts";
import { editionClaimClearance, editionClaimClearanceByStory, loadStories } from "../lib/edition-data.mts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const UUID = /^[0-9a-f-]{36}$/i;

async function latestDecision(storyId: string) {
  const r = await db<any[]>(`editorial_decisions?story_id=eq.${storyId}&select=id,decision,notes,created_at&order=created_at.desc,id.desc&limit=1`);
  return r[0] ?? null;
}

async function loadStory(storyId: string) {
  const rows = await db<any[]>(
    `stories?id=eq.${storyId}&select=id,headline,category,created_at,story_source_links(retrieved_sources(title,url,published_at,retrieved_at,content_status,extract,source_registry(name,country_scope,reliability_note,enabled,retrieval_status)))`
  );
  const st = rows[0];
  if (!st) return null;
  const sources = (st.story_source_links ?? [])
    .map((l: any) => l.retrieved_sources)
    .filter(Boolean)
    .filter((s: any) => s.source_registry?.enabled === true && s.source_registry?.retrieval_status === "healthy")
    .map((s: any) => ({
      outlet: s.source_registry?.name ?? "Unknown",
      region: (s.source_registry?.country_scope ?? "").split(" · ")[0] || "Unknown",
      tier: /tier:primary/.test(s.source_registry?.reliability_note ?? "") ? ("primary" as const) : ("reporting" as const),
      url: s.url as string,
      title: (s.title ?? "") as string,
      summary: (s.extract ?? null) as string | null,
      publishedAt: (s.published_at ?? null) as string | null,
      retrievedAt: (s.retrieved_at ?? null) as string | null,
      contentStatus: (s.content_status ?? null) as string | null,
      enabled: typeof s.source_registry?.enabled === "boolean" ? s.source_registry.enabled : undefined,
      retrievalStatus: typeof s.source_registry?.retrieval_status === "string" ? s.source_registry.retrieval_status : null,
    }));
  const story: EvStory = { headline: st.headline, category: st.category, sources };
  const scoringInput: StoryInput = { id: st.id, headline: st.headline, category: st.category, createdAt: st.created_at, sources };
  const verifiedLoaded = await loadStories([storyId]);
  return { story, scoringInput, claimRegister: verifiedLoaded.get(storyId)?.claimRegister ?? [] };
}

async function approvedRules(): Promise<{ rules: StyleRuleIn[]; installed: boolean }> {
  try {
    const rows = await db<any[]>("style_rules?status=eq.APPROVED&select=rule_key,version,category,statement&order=version.desc");
    const best = new Map<string, StyleRuleIn>();
    for (const r of rows) if (!best.has(r.rule_key)) best.set(r.rule_key, r);
    return { rules: [...best.values()], installed: true };
  } catch (e) {
    if (e instanceof DbError && e.upstream === 404) return { rules: [], installed: false };
    throw e;
  }
}

async function currentClaimClearance(storyId: string) {
  try {
    return await editionClaimClearance([storyId]);
  } catch (error) {
    return {
      ready: false,
      blocked: [{
        storyId,
        reason: error instanceof DbError && error.upstream === 404
          ? "Claim-verification records are not installed; factual clearance cannot be confirmed."
          : "The current claim-verification state could not be loaded. Public-facing news output remains blocked.",
      }],
    };
  }
}

function curiosityOf(scoringInput: StoryInput) {
  const s = scoreStory(scoringInput);
  return { score: Math.round(s.curiosity), patterns: s.patterns.map((p) => ({ label: p.label, why: p.why })) };
}

export default async (req: Request) => {
  if (!isAuthenticated(req)) return json({ error: "unauthorized" }, 401);
  if (req.method === "POST" && !hasSameOrigin(req)) return json({ error: "origin_mismatch" }, 403);
  try {
    const url = new URL(req.url);
    if (req.method === "GET") {
      if (url.searchParams.get("history")) return await history();
      const id = url.searchParams.get("id");
      if (id) return await one(id);
      const storyId = url.searchParams.get("storyId");
      if (!storyId || !UUID.test(storyId)) return json({ error: "bad_request" }, 400);
      return await preview(storyId);
    }
    if (req.method === "POST") return await generate(req);
    return json({ error: "method_not_allowed" }, 405);
  } catch (e) {
    if (e instanceof DbError) return json({ error: "database", detail: e.message }, e.status);
    if (e instanceof PackTooLarge || e instanceof PromptTooLarge) return json({ error: "too_large", detail: e.message }, 413);
    return json({ error: "server_error" }, 500);
  }
};

async function preview(storyId: string) {
  const dec = await latestDecision(storyId);
  if (dec?.decision !== "approved") return json({ error: "not_approved", detail: "This story is not currently approved for drafting." }, 409);
  const clearance = await currentClaimClearance(storyId);
  if (!clearance.ready) return json({ error: "verification_blocked", detail: "A public-facing creative prompt cannot be prepared until this story's material claims are verified and its claim register is complete.", blockedClaims: clearance.blocked }, 409);
  const loaded = await loadStory(storyId);
  if (!loaded) return json({ error: "not_found" }, 404);
  if (!loaded.story.sources.length) return json({ error: "no_eligible_sources", detail: "No currently enabled and healthy source remains attached to this story. It cannot be used for public news output." }, 409);
  const rec = recommendTreatment(loaded.story);
  const pack = buildEvidencePack(loaded.story, { decisionNote: dec.notes });
  pack.claim_register = loaded.claimRegister;
  return json({
    storyId,
    headline: loaded.story.headline,
    recommended: { key: rec.treatment.key, label: rec.treatment.label, reason: rec.reason, approach: rec.treatment.approach, roles: rec.treatment.roles, voice: rec.treatment.voice, visual: rec.treatment.visual, hook: rec.treatment.hook },
    alternatives: rec.alternatives,
    allTreatments: TREATMENTS.map((t) => ({ key: t.key, label: t.label })),
    deliverables: DELIVERABLES.map((d) => ({ key: d.key, label: d.label })),
    curiosity: curiosityOf(loaded.scoringInput),
    evidence: { sources: pack.sources.length, omitted: pack.omitted_sources.count, classes: classCounts(pack) },
  });
}

async function generate(req: Request) {
  let b: any;
  try {
    b = JSON.parse(await req.text());
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const storyId = String(b.storyId ?? "");
  if (!UUID.test(storyId)) return json({ error: "bad_request" }, 400);
  const deliverable = DELIVERABLES.some((d) => d.key === b.deliverable) ? (b.deliverable as Deliverable) : "script_storyboard";
  const duration = ([30, 60, 90] as const).includes(b.durationSeconds) ? (b.durationSeconds as 30 | 60 | 90) : 60;
  const parentId = typeof b.parentId === "string" && UUID.test(b.parentId) ? b.parentId : null;

  const dec = await latestDecision(storyId);
  if (dec?.decision !== "approved") return json({ error: "not_approved", detail: "This story is not currently approved for drafting." }, 409);
  const clearance = await currentClaimClearance(storyId);
  if (!clearance.ready) return json({ error: "verification_blocked", detail: "A public-facing creative prompt cannot be prepared until this story's material claims are verified and its claim register is complete.", blockedClaims: clearance.blocked }, 409);
  const loaded = await loadStory(storyId);
  if (!loaded) return json({ error: "not_found" }, 404);
  if (!loaded.story.sources.length) return json({ error: "no_eligible_sources", detail: "No currently enabled and healthy source remains attached to this story. It cannot be used for public news output." }, 409);

  const rec = recommendTreatment(loaded.story);
  const treatment = (typeof b.treatmentKey === "string" && getTreatment(b.treatmentKey)) || rec.treatment;
  const pack = buildEvidencePack(loaded.story, { conflictNote: typeof b.conflictNote === "string" ? b.conflictNote : null, decisionNote: dec.notes });
  pack.claim_register = loaded.claimRegister;
  const { rules, installed: rulesInstalled } = await approvedRules();
  const out = buildArchitectPrompt({
    pack,
    treatmentKey: treatment.key,
    deliverable,
    durationSeconds: duration,
    angle: typeof b.angle === "string" ? b.angle : "",
    curiosity: curiosityOf(loaded.scoringInput),
    approvedRules: rules,
  });
  const reply = {
    treatment: { key: treatment.key, label: treatment.label, recommended: treatment.key === rec.treatment.key },
    roles: treatment.roles,
    rationale: out.rationale,
    tools: out.tools,
    evidenceClasses: classCounts(pack),
    brandChecklist: brandChecklist(),
    brandVersion: BRAND_VERSION,
    prompt: out.prompt,
  };

  // Save to Prompt History (next version). If migration 003 is not installed, still return the prompt, clearly unsaved.
  let version = 1;
  try {
    const last = await db<any[]>(`creative_prompts?story_id=eq.${storyId}&select=version&order=version.desc&limit=1`);
    version = (last[0]?.version ?? 0) + 1;
  } catch (e) {
    if (e instanceof DbError && e.upstream === 404) return json({ ...reply, saved: false, notInstalled: true, note: "Prompt History is not installed yet (migration 003). This prompt was NOT saved." });
    throw e;
  }
  if (version > 50) return json({ error: "version_limit", detail: "This story already has 50 saved prompt versions." }, 409);
  try {
    const rows = await db<any[]>("creative_prompts", {
      method: "POST",
      prefer: "return=representation",
      body: {
        story_id: storyId,
        version,
        parent_id: parentId,
        treatment_key: treatment.key,
        roles: treatment.roles,
        rationale: out.rationale,
        tools: out.tools,
        evidence_snapshot: pack,
        style_rule_ids: [],
        brand_spec_version: BRAND_VERSION,
        prompt_text: out.prompt,
        created_by: "editor",
      },
    });
    const saved = Array.isArray(rows) ? rows[0] : rows;
    await db("audit_events", {
      method: "POST",
      prefer: "return=minimal",
      body: { event_type: "creative_prompt_created", entity_type: "story", entity_id: storyId, actor: "editor", detail: { version, treatment: treatment.key, deliverable, prompt_id: saved?.id ?? null, approved_style_rules: rules.length, rules_installed: rulesInstalled } },
    });
    return json({ ...reply, saved: true, id: saved?.id ?? null, version });
  } catch (e) {
    if (e instanceof DbError && e.upstream === 400) return json({ error: "refused_by_database", detail: "The database refused this record (the approval is no longer current, or the record exceeds a size limit). Nothing was saved." }, 409);
    if (e instanceof DbError && e.upstream === 409) return json({ error: "version_conflict", detail: "Another prompt was saved at the same moment. Please try again." }, 409);
    throw e;
  }
}

async function history() {
  let rows: any[];
  try {
    rows = await db<any[]>("creative_prompts?select=id,story_id,version,treatment_key,created_at,approval_decision_id,created_by&order=created_at.desc&limit=60");
  } catch (e) {
    if (e instanceof DbError && e.upstream === 404) return json({ notInstalled: true, prompts: [] });
    throw e;
  }
  const ids = [...new Set(rows.map((r) => r.story_id))];
  const names = new Map<string, string>();
  const current = new Map<string, string | null>();
  let claimCurrent = new Map<string, { ready: boolean }>();
  try { claimCurrent = await editionClaimClearanceByStory(ids); } catch { /* fail closed: history remains visible but never current */ }
  for (let i = 0; i < ids.length; i += 30) {
    const part = ids.slice(i, i + 30).join(",");
    for (const s of await db<any[]>(`stories?id=in.(${part})&select=id,headline`)) names.set(s.id, s.headline);
    for (const d of await db<any[]>(`editorial_decisions?story_id=in.(${part})&select=id,story_id,decision,created_at&order=created_at.desc,id.desc`)) {
      if (!current.has(d.story_id)) current.set(d.story_id, d.decision === "approved" ? d.id : null);
    }
  }
  return json({
    prompts: rows.map((r) => ({
      id: r.id,
      storyId: r.story_id,
      headline: names.get(r.story_id) ?? "(story removed)",
      version: r.version,
      treatment: r.treatment_key,
      createdAt: r.created_at,
      approvalCurrent: current.get(r.story_id) === r.approval_decision_id && !!r.approval_decision_id && claimCurrent.get(r.story_id)?.ready === true,
    })),
  });
}

async function one(id: string) {
  if (!UUID.test(id)) return json({ error: "bad_request" }, 400);
  const rows = await db<any[]>(`creative_prompts?id=eq.${id}&select=*`);
  const r = rows[0];
  if (!r) return json({ error: "not_found" }, 404);
  const dec = await latestDecision(r.story_id);
  const clearance = await currentClaimClearance(r.story_id);
  const loaded = await loadStory(r.story_id);
  const activeUrls = new Set(loaded?.story.sources.map((source) => source.url) ?? []);
  const snapshotUrls = (r.evidence_snapshot?.sources ?? []).map((source: any) => source.url).filter((url: unknown): url is string => typeof url === "string");
  const evidenceCurrent = clearance.ready && activeUrls.size > 0 && snapshotUrls.length > 0 && snapshotUrls.every((url: string) => activeUrls.has(url));
  const current = dec?.decision === "approved" && dec.id === r.approval_decision_id && evidenceCurrent;
  return json({
    id: r.id,
    storyId: r.story_id,
    version: r.version,
    treatment: r.treatment_key,
    createdAt: r.created_at,
    brandVersion: r.brand_spec_version,
    approvalCurrent: current,
    factualClearanceCurrent: clearance.ready,
    evidenceCurrent,
    roles: r.roles,
    rationale: r.rationale,
    tools: r.tools,
    evidenceClasses: classCounts(r.evidence_snapshot),
    prompt: current ? r.prompt_text : null,
    withheld: current ? undefined : !clearance.ready
      ? "This story no longer has current factual clearance. The saved prompt remains in history but its text is withheld until the material claims are verified again."
      : !evidenceCurrent
        ? "The sources used by this prompt are no longer all currently enabled and healthy. The saved prompt remains in history but cannot be copied."
        : "This story's human editorial approval is no longer current. The saved prompt remains in history but cannot be copied. Re-approve and regenerate.",
  });
}
