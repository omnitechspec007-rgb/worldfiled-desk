// Fixed, explainable theme taxonomy. A theme is a CANDIDATE connection signal only: a development needs
// at least two distinct matched terms (or one "strong" term) before it carries the theme. Shared keywords never
// prove a real connection; the edition engine combines this with other evidence and the editor decides.

export type Theme = { id: string; label: string; question: string; terms: RegExp; strong?: RegExp };
const T = (t: Theme) => t;
export const THEMES: Theme[] = [
  T({ id: "preparedness", label: "Preparing for disruption", question: "Why are governments changing how they prepare for disruption?", terms: /\b(emergency|preparedness|resilience|disaster|evacuat\w+|stockpil\w+|civil defen[cs]e|contingency|early warning|shelters?|readiness|crisis plan)\b/gi, strong: /\b(preparedness|civil defen[cs]e|resilience plan)\b/i }),
  T({ id: "ai_governance", label: "Governing artificial intelligence", question: "How are governments starting to regulate artificial intelligence?", terms: /\b(artificial intelligence|ai|algorithm\w*|machine learning|chatbots?|deepfakes?|automated decision\w*|generative)\b/gi, strong: /\b(artificial intelligence|deepfakes?)\b/i }),
  T({ id: "data_privacy", label: "Data and privacy rules", question: "Why are countries rewriting the rules on personal data?", terms: /\b(data protection|privacy|personal data|surveillance|biometric\w*|facial recognition|cookies|data breach\w*|gdpr)\b/gi, strong: /\b(data protection|privacy law|biometric\w*)\b/i }),
  T({ id: "energy_transition", label: "Energy transition", question: "How are countries changing where their energy comes from?", terms: /\b(renewable\w*|solar|wind (farm|power|energy)|coal|nuclear|grid|electricity|hydrogen|fossil|battery|storage|emissions?|carbon)\b/gi, strong: /\b(renewable\w*|energy transition|net[- ]zero)\b/i }),
  T({ id: "food_water", label: "Food and water security", question: "What is changing in how countries secure food and water?", terms: /\b(food (security|prices?|supply)|harvest|crop\w*|fertili[sz]er|drought|irrigation|water (shortage|supply|scarcity)|famine|grain|aquifer)\b/gi, strong: /\b(food security|water scarcity|famine)\b/i }),
  T({ id: "public_health", label: "Public health policy", question: "How are health systems changing their response?", terms: /\b(vaccin\w+|outbreak|hospital\w*|disease|health (ministry|system|policy)|clinic\w*|epidemic|pandemic|screening|antibiotic\w*|public health)\b/gi, strong: /\b(outbreak|vaccination programme|public health)\b/i }),
  T({ id: "trade_economy", label: "Trade and economic shocks", question: "How are countries responding to shifts in trade and prices?", terms: /\b(tariffs?|trade (deal|war|barriers?)|exports?|imports?|inflation|interest rates?|currency|central bank|subsid\w+|supply chains?|sanctions?)\b/gi, strong: /\b(tariffs?|trade war|central bank)\b/i }),
  T({ id: "cost_of_living", label: "Cost of living", question: "Why are governments stepping in on the cost of everyday life?", terms: /\b(cost of living|rent|housing|mortgage|wages?|minimum wage|pensions?|prices?|subsid\w+|welfare|benefits?)\b/gi, strong: /\b(cost of living|minimum wage|housing crisis)\b/i }),
  T({ id: "migration", label: "Migration and borders", question: "How are countries changing who can cross their borders?", terms: /\b(migra\w+|asylum|refugees?|visas?|border (control|crossing|policy)|deport\w+|citizenship|residency)\b/gi, strong: /\b(asylum|refugees?|visa policy)\b/i }),
  T({ id: "cyber_security", label: "Cyber security", question: "Why are governments tightening digital security?", terms: /\b(cyber\w*|hack\w*|ransomware|malware|data breach\w*|critical infrastructure|digital security)\b/gi, strong: /\b(cyber ?attacks?|ransomware|cyber ?security)\b/i }),
  T({ id: "climate_extremes", label: "Extreme weather and climate", question: "How are countries adapting to more extreme weather?", terms: /\b(flood\w*|wildfires?|heatwave|storm|cyclone|hurricane|typhoon|drought|sea level|glacier\w*|climate|coastal)\b/gi, strong: /\b(climate adaptation|sea level rise|heatwave)\b/i }),
  T({ id: "biodiversity", label: "Nature and biodiversity", question: "What is changing in how countries protect nature?", terms: /\b(biodiversity|species|conservation|forest\w*|wildlife|deforest\w*|coral|protected areas?|extinction|marine reserve)\b/gi, strong: /\b(biodiversity|extinction|deforestation)\b/i }),
  T({ id: "space_science", label: "Space and frontier science", question: "What are new discoveries changing about what we know?", terms: /\b(space|satellite\w*|telescope|asteroid|orbit|astronom\w+|lunar|mars|rocket|exoplanet|particle|quantum)\b/gi, strong: /\b(telescope|exoplanet|asteroid)\b/i }),
  T({ id: "medical_research", label: "Medical research", question: "Which new findings could change treatment?", terms: /\b(trial|therapy|treatment|cancer|researchers|study|clinical|gene\w*|drug|diagnos\w+|breakthrough)\b/gi, strong: /\b(clinical trial|gene therapy)\b/i }),
  T({ id: "labour_education", label: "Work and education", question: "How are countries changing work and schooling?", terms: /\b(workers?|unions?|strike\w*|labou?r|schools?|students?|universit\w+|curriculum|teachers?|employment|apprentice\w*)\b/gi, strong: /\b(labou?r law|curriculum reform|union)\b/i }),
  T({ id: "justice_rights", label: "Rights and the courts", question: "How are courts and lawmakers redefining rights?", terms: /\b(court|ruling|rights|constitution\w*|judges?|tribunal|supreme|verdict|appeal|ban|equality|discriminat\w+)\b/gi, strong: /\b(supreme court|constitutional court|human rights)\b/i }),
  T({ id: "transport_infrastructure", label: "Infrastructure and transport", question: "Why are countries rebuilding how people and goods move?", terms: /\b(railway\w*|rail|metro|bridge|road|port|airport|infrastructure|high-speed|shipping|highway|tunnel)\b/gi, strong: /\b(infrastructure|high-speed rail)\b/i }),
];

export type ThemeHit = { id: string; label: string; question: string; matched: string[]; strength: number };
export function themesOf(text: string): ThemeHit[] {
  const out: ThemeHit[] = [];
  for (const t of THEMES) {
    const matched = [...new Set((text.match(t.terms) ?? []).map((w) => w.toLowerCase()))];
    const strong = t.strong ? t.strong.test(text) : false;
    if (matched.length >= 2 || strong) out.push({ id: t.id, label: t.label, question: t.question, matched: matched.slice(0, 6), strength: Math.min(1, matched.length / 4 + (strong ? 0.35 : 0)) });
  }
  return out.sort((a, b) => b.strength - a.strength).slice(0, 3);
}
export const themeById = (id: string) => THEMES.find((t) => t.id === id);

// Named event / catalyst detection: a shared proper noun is a candidate catalyst only if it is not a country,
// an outlet name or a generic institution word. This is a signal, never proof.
const GENERIC = new Set("The This That These Those New Government Ministry Minister President Prime Parliament Court Council Union Commission Bank Agency Office Department Authority Officials Police Army Report Reports Statement Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September October November December Reuters Associated Press Breaking Live Update Updates Study Researchers Scientists Law Bill Act National International Global World News Public Federal State Local Senate House Supreme High Central Foreign Trade Health Energy Climate Water Food".split(" "));
export const EVENT_TYPES = /\b(earthquake|hurricane|typhoon|cyclone|tsunami|flood\w*|wildfires?|heatwave|drought|pandemic|outbreak|summit|election|war|ceasefire|blackout|cyber ?attack|strike|recession|crash|shortage)\b/gi;

export function properNouns(text: string, exclude: Set<string>): string[] {
  const out = new Set<string>();
  for (const seg of text.split(/[.!?:;|]\s+|\s[-–—]\s/)) {
    const words = seg.trim().split(/\s+/);
    words.forEach((w, i) => {
      const c = w.replace(/^[("'“]+/, "").replace(/(['’]s)?[)"'”.,;:!?]*$/, "");
      if (i === 0 || c.length < 4 || !/^[A-Z][a-z]+$/.test(c)) return;
      if (GENERIC.has(c) || exclude.has(c) || new RegExp(`^(?:${EVENT_TYPES.source.replace(/^\\b\(|\)\\b$/g, "")})$`, "i").test(c)) return;
      out.add(c);
    });
  }
  return [...out];
}
