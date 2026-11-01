// The World, Filed. permanent brand specification (source of truth for every Claude production prompt).
// Wording follows the user's approved brand specification. Do not invent alternatives.

export const BRAND_VERSION = "brand-1";

export const BRAND = {
  name: "THE WORLD, FILED.",
  tagline: "What happened. What changed. What matters.",
  palette: [
    { name: "Midnight Navy", hex: "#0B1F38", use: "Primary background, geographic visualisations, editorial panels and major surfaces." },
    { name: "Archive Cream", hex: "#F7F4ED", use: "Main text, readable information panels, captions and supporting backgrounds." },
    { name: "Archival Gold", hex: "#FFC857", use: "Important highlights, geographic markers, key figures, timelines, emphasis and selected accents." },
    { name: "Signal Teal", hex: "#4CC9B0", use: "Sparingly: meaningful distinctions, verification-related cues and selected editorial highlights." },
  ],
  logoFile: "TWF_final_logo.svg",
  logoPublicPath: "/brand/TWF_final_logo.svg",
} as const;

const LINES = {
  personality: [
    "International, intelligent, editorial, premium, geographically aware, evidence-driven.",
    "Modern but timeless, curious without sensationalism, visually sophisticated, calm and authoritative.",
    "Combine premium international documentary graphics, modern information design, sophisticated cartography and contemporary editorial journalism.",
  ],
  typography: [
    "Strong, elegant editorial headlines; highly legible sans-serif supporting text.",
    "Clear numerical emphasis, deliberate spacing, restrained uppercase labels, consistent alignment and grid.",
    "Avoid: many font combinations, decorative typefaces, tiny text, long all-caps paragraphs, unnecessary text animation, clutter.",
    "Typography supports the story and never competes with it.",
  ],
  voice: [
    "Informed, precise, curious, clear, intelligent, confident, internationally understandable.",
    "Human without being sentimental. Engaging without exaggeration.",
    "Must NOT sound like: a sensationalist breaking-news account, a political propaganda channel, a generic AI-generated news page, an entertainment gossip account, or an alarmist disaster channel.",
    "Editorial promise: explain what happened, what changed and what matters.",
  ],
  logo: [
    `Use the official logo file ${BRAND.logoFile} exactly as supplied. Do not redesign, distort, recolour, crop, stretch or recreate it. Preserve its proportions and give it clear space.`,
    "Keep the placement small and unobtrusive unless a format requires otherwise.",
    `If you (Claude) do not have the file, ask the user to attach ${BRAND.logoFile}. Until then, use a clearly labelled temporary text placeholder reading "[LOGO PLACEHOLDER: official logo to be inserted]", state where the official logo goes, and do NOT invent or present any replacement as the real logo.`,
    "Do not generate a competing logo or alternative identity.",
  ],
  mobile: [
    "Design for a phone screen held at arm's length: large, high-contrast text, generous margins, one idea per frame.",
    "Keep captions and labels readable at small sizes; avoid dense paragraphs and fine detail.",
  ],
  prohibited: [
    "Do not invent another brand name, tagline or abbreviation.",
    'Do not add the descriptor "LAWS · DISCOVERIES · DECISIONS · CONSEQUENCES" to the master logo or cover image.',
    "Do not use all four colours with equal intensity. Do not recolour the official logo.",
    "Do not use a generic social-media news template, breaking-news styling, alarm red banners, clickbait phrasing or outrage framing.",
    "Do not create a new brand direction without the user's explicit approval.",
  ],
  adaptation: [
    "Geographic stories: palette in maps, location highlights, labels and information panels.",
    "Scientific stories: palette in illustrations, diagrams, labels and explanatory graphics.",
    "Policy and legal stories: restrained editorial typography, timelines, document-inspired layouts, clear comparison graphics.",
    "Human-interest stories: documentary visual language that keeps the brand's colour, typography and restraint.",
    "Environmental stories: relevant geographical and environmental imagery within the approved identity.",
    "International affairs: sophisticated cartography, geographic connections, restrained information graphics.",
    "Brand consistency does not mean visual repetition: do not force every story into the same background, composition or map.",
  ],
  checklist: [
    "Is the official brand identity preserved?",
    "Are the approved colours used correctly (not at equal intensity)?",
    "Is the typography consistent and readable on a phone?",
    "Is the logo used correctly, if the official file is available?",
    "Does it feel like The World, Filed. and not a generic news template?",
    "Does the presentation adapt to the story without losing brand recognition?",
    "Is the voice consistent with the brand voice?",
    "Are all factual claims supported by the evidence section (checked separately from brand)?",
  ],
};

const bullets = (a: string[]) => a.map((x) => `- ${x}`).join("\n");

/** The complete brand section inserted into every generated production prompt. */
export function brandBlock(): string {
  return [
    `BRAND SPECIFICATION (${BRAND_VERSION}) - apply throughout the whole production, not only the first and last frame`,
    `Brand name: ${BRAND.name}`,
    `Permanent tagline: "${BRAND.tagline}"`,
    "",
    "Approved palette:",
    ...BRAND.palette.map((c) => `- ${c.name} ${c.hex}: ${c.use}`),
    "",
    "Visual personality:",
    bullets(LINES.personality),
    "Typography and hierarchy:",
    bullets(LINES.typography),
    "Logo placement and asset requirements:",
    bullets(LINES.logo),
    "Brand voice (narration and written text):",
    bullets(LINES.voice),
    "Story-specific visual adaptation:",
    bullets(LINES.adaptation),
    "Mobile readability:",
    bullets(LINES.mobile),
    "Prohibited treatments:",
    bullets(LINES.prohibited),
  ].join("\n");
}

/** Brand compliance checklist, kept separate from factual verification. */
export function brandChecklist(): string[] {
  return LINES.checklist;
}
