// AI provider interface (NOT used by this version).
// Rule-based logic does all current work. A future provider (any vendor, free or otherwise)
// implements this interface and is switched on through system_settings 'ai_enabled'.
// Contract: AI may only SUGGEST. Verification outcomes, approvals and exports are decided by
// deterministic code and the human editor. Output must be schema-validated, and any quoted
// passage must be found verbatim in the retrieved source text or it is discarded.

export type ClaimSuggestion = { claimText: string; category?: string };
export type EvidenceSuggestion = { claimIndex: number; sourceId: string; passage: string };
export type CuriosityNotes = { question?: string; unexpectedDetail?: string; whyPeopleCare?: string };

export interface AiProvider {
  readonly name: string;
  suggestClaims(storyText: string): Promise<ClaimSuggestion[]>;
  suggestEvidence(claims: ClaimSuggestion[], sourceTexts: { sourceId: string; text: string }[]): Promise<EvidenceSuggestion[]>;
  describeCuriosity(storyText: string): Promise<CuriosityNotes>;
}

export function getAiProvider(): AiProvider | null {
  return null; // disabled: no provider configured
}
