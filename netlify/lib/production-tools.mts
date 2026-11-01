// Per-story, per-deliverable tool selection. Tools are chosen ONLY when the deliverable genuinely needs them.
// These are guidance for Claude, never dependencies of WorldFiled Desk.

export type Deliverable = "script_storyboard" | "animated_html" | "narrated_video";
export const DELIVERABLES: { key: Deliverable; label: string; text: string }[] = [
  { key: "script_storyboard", label: "Script, storyboard and visual specification (no media files)", text: "a written narration script, a scene-by-scene storyboard, and a visual and voiceover specification. No media files." },
  { key: "animated_html", label: "Animated preview as one HTML file (silent, screen-recordable)", text: "the script and storyboard, plus ONE self-contained HTML file that plays the animation with a master clock (play, pause, restart, scrubber) in a 9:16 stage, so it can be screen-recorded. No narration audio file." },
  { key: "narrated_video", label: "Narrated video file (animation + voiceover audio)", text: "the script and storyboard, the animation, a narration audio file, and a final video file combining them." },
];

export type ToolPick = { name: string; repo: string; why: string; checks: string[] };
export type ToolPlan = {
  deliverable: Deliverable;
  needed: ToolPick[];
  optional: ToolPick[];
  notNeeded: { name: string; reason: string }[];
  note: string;
};

const CHECKS = ["whether it is genuinely needed for this job", "current repository status (recent maintenance, open issues)", "licence of the code and, where relevant, of any model or voice data", "hardware and OS requirements", "installation method and compatibility with the other chosen tools", "that it can be used free, with no paid service, trial or API key"];

const FFMPEG: ToolPick = { name: "FFmpeg", repo: "https://github.com/FFmpeg/FFmpeg", why: "needed to combine the animation frames or recording with the narration audio and encode the final video file", checks: CHECKS };
const PIPER: ToolPick = {
  name: "Piper (free text-to-speech candidate)",
  repo: "https://github.com/rhasspy/piper",
  why: "a narration audio file is required, so a free text-to-speech engine is needed. Piper is one candidate; verify it, or pick another free option you can verify",
  checks: [...CHECKS, "the licence of the specific voice model (some voices restrict commercial use)", "voice quality and language coverage for this script, and pronunciation of the names involved", "any platform rules on disclosing synthetic voices"],
};
const REMOTION: ToolPick = { name: "Remotion", repo: "https://github.com/remotion-dev/remotion", why: "only if you choose to render frames programmatically instead of recording the HTML animation; check its licence terms for this use", checks: CHECKS };

export function selectTools(d: Deliverable, mapNeeded: boolean): ToolPlan {
  if (d === "narrated_video") {
    return {
      deliverable: d,
      needed: [FFMPEG, PIPER],
      optional: [REMOTION],
      notNeeded: [
        { name: "Whisper", reason: "the narration is generated from the script, so its timings are known; transcription is not needed" },
        { name: "OpenCV", reason: "no supplied footage needs to be analysed" },
      ],
      note: "Install nothing that is not listed as needed. Verify each needed tool before relying on it. If a needed tool fails verification, say so and propose a free alternative or reduce the deliverable. Do not substitute a paid service.",
    };
  }
  if (d === "animated_html") {
    return {
      deliverable: d,
      needed: [],
      optional: [],
      notNeeded: [
        { name: "FFmpeg", reason: "no media encoding is requested" },
        { name: "Remotion", reason: "a single HTML file with a master clock is sufficient" },
        { name: "Piper", reason: "no narration audio file is requested" },
        { name: "Whisper", reason: "no audio is processed" },
        { name: "OpenCV", reason: "no footage is analysed" },
      ],
      note: `No additional tool is required: deliver one self-contained HTML/CSS/JavaScript file.${mapNeeded ? " If you draw a map, you may load pinned versions of D3 and TopoJSON world data from a public CDN; confirm they load, and fall back to simple stylised shapes if they do not." : ""} Do not install anything.`,
    };
  }
  return {
    deliverable: d,
    needed: [],
    optional: [],
    notNeeded: [
      { name: "FFmpeg, Remotion, Piper, Whisper, OpenCV", reason: "this deliverable contains no media files, so none of these are needed" },
    ],
    note: "No additional tool is required: this is a written deliverable. Do not install anything.",
  };
}
