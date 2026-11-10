// Approved daily content cadence, with quality gates inherited from Editorial Intelligence.
import { buildEditorialIntelligence } from "../../src/editorial-intelligence.ts";

export type ResearchOutputPlan = {
  key: string;
  format: "text_card" | "text_roundup" | "narrated_video";
  title: string;
  storyIds: string[];
  durationSeconds: 60 | 90 | 120 | null;
  angle: string;
};

export type ResearchOutputSelection = {
  eligibleCount: number;
  heldCount: number;
  standaloneCount: number;
  roundupCount: number;
  narratedCount: number;
  packages: ResearchOutputPlan[];
};

export function buildResearchOutputPackages(stories: any[]): ResearchOutputSelection {
  const intelligence = buildEditorialIntelligence(stories);
  const packages: ResearchOutputPlan[] = [];

  // Balanced cadence: at most three separate six-second text cards.
  intelligence.standalonePicks.slice(0, 3).forEach((pick: any, index: number) => {
    packages.push({
      key: "text_card_" + (index + 1),
      format: "text_card",
      title: pick.story.headline,
      storyIds: [pick.story.id],
      durationSeconds: null,
      angle: "Standalone, presenter-free WorldFiled text card. Keep it static for six seconds; use the approved brand layout and subtle sound effects only.",
    });
  });

  // Optional roundup only when at least five stories pass all eligibility gates.
  if (intelligence.roundupPicks.length >= 5) {
    packages.push({
      key: "text_roundup",
      format: "text_roundup",
      title: "The World, Filed — Daily Text Roundup",
      storyIds: intelligence.roundupPicks.slice(0, 7).map((pick: any) => pick.story.id),
      durationSeconds: null,
      angle: "Balanced, presenter-free, static six-second WorldFiled text roundup. Use a varied, evidence-led selection; do not add motion or filler.",
    });
  }

  // One narrated bulletin per daily cycle. Use 90 seconds when four or more candidates qualify;
  // shorten to 60 seconds on a quieter news day. Never invent stories to fill runtime.
  const duration: 60 | 90 = intelligence.eligibleCount >= 4 ? 90 : 60;
  const narratedPlan = intelligence.narrated.find((plan: any) => plan.durationSeconds === duration);
  if (narratedPlan?.stories.length) {
    packages.push({
      key: "daily_narrated",
      format: "narrated_video",
      title: "The World, Filed — Daily Narrated Bulletin",
      storyIds: narratedPlan.stories.map((pick: any) => pick.story.id).slice(0, 5),
      durationSeconds: duration,
      angle: "The fuller daily WorldFiled video: calm, authoritative and curious. Explain what happened, what changed and why it matters; clearly label uncertainty and keep every claim tied to its evidence.",
    });
  }

  return {
    eligibleCount: intelligence.eligibleCount,
    heldCount: intelligence.held.length,
    standaloneCount: intelligence.standalonePicks.length,
    roundupCount: intelligence.roundupPicks.length,
    narratedCount: narratedPlan?.stories.length ?? 0,
    packages,
  };
}
