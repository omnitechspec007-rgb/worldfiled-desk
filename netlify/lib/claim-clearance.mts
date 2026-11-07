export const CONTRADICTION_RECONCILIATION_PREFIX = "CONTRADICTION RECONCILIATION:\n";
const EDITOR_NOTES_SEPARATOR = "\n\nEDITOR NOTES:\n";

/** Store a dedicated editor explanation separately from general reviewer notes. */
export function formatReviewerNotes(reconciliation: string, notes: string): string {
  const rationale = reconciliation.trim();
  const general = notes.trim();
  return CONTRADICTION_RECONCILIATION_PREFIX + rationale + (general ? EDITOR_NOTES_SEPARATOR + general : "");
}

/** A generic reviewer note must never count as reconciliation of contrary evidence. */
export function hasContradictionReconciliation(value: unknown): boolean {
  if (typeof value !== "string" || !value.startsWith(CONTRADICTION_RECONCILIATION_PREFIX)) return false;
  const rationale = value.slice(CONTRADICTION_RECONCILIATION_PREFIX.length).split(EDITOR_NOTES_SEPARATOR, 1)[0].trim();
  return rationale.length >= 80;
}
