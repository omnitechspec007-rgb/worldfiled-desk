export type Score = { dimension: string; score: number; max: number; reason: string; detail?: { components?: Record<string, { points: number; max: number; why: string }> } };

const LABEL: Record<string, string> = {
  editorial_significance: "Editorial significance",
  evidence_quality: "Evidence quality",
  source_independence: "Source independence",
  novelty: "Novelty",
  recency: "Recency",
  human_relevance: "Human relevance",
  geographic_spread: "Geographic spread",
  curiosity: "Curiosity (editorial hypothesis)",
};
const ORDER = ["editorial_significance", "evidence_quality", "source_independence", "novelty", "recency", "human_relevance", "geographic_spread", "curiosity"];

export function Scores({ scores, compact }: { scores: Score[]; compact?: boolean }) {
  if (!scores?.length) return <p className="meta">Not scored yet.</p>;
  const sorted = [...scores].sort((a, b) => ORDER.indexOf(a.dimension) - ORDER.indexOf(b.dimension));
  return (
    <details open={!compact}>
      <summary>{compact ? "Scores and reasons" : "Scores"}</summary>
      <table className="scores">
        <tbody>
          {sorted.map((s) => (
            <tr key={s.dimension}>
              <td className="dim">{LABEL[s.dimension] ?? s.dimension}</td>
              <td className="num">{s.score}/{s.max}</td>
              <td>
                {s.reason}
                {s.dimension === "curiosity" && s.detail?.components && (
                  <ul className="comps">
                    {Object.entries(s.detail.components).map(([k, c]) => (
                      <li key={k}>{k.replace(/_/g, " ")}: {c.points}/{c.max} — {c.why}</li>
                    ))}
                  </ul>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
