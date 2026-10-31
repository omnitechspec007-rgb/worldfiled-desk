// FORMAT BIBLE v1 (draft): the visual and editorial format of the reference videos.
// Built from 4 uploaded reference videos (360x640 copies, 59 to 93 seconds).
// Each entry is tagged: MEASURED (computed from the video files), OBSERVED (read from frames by eye),
// or INFERRED (a reasoned guess to be confirmed). Update this file when more videos are analysed;
// the Prompt Builder reads it, so the whole system follows the format.

export const FORMAT_BIBLE = {
  id: "map-explainer-v1",
  status: "DRAFT: derived from 4 reference videos",
  evidence: {
    videos: 4,
    durationsSeconds: [90, 93, 59, 59], // MEASURED
    resolution: "360x640 at 30 fps (copies); design for 1080x1920", // MEASURED
    notAnalysed: "Spoken words could not be transcribed here, and background music could not be separated from speech.",
  },
  canvas: { aspect: "9:16", designSize: "1080x1920", fps: 30 },
  palette: {
    // MEASURED from one frame; the dark values are after video compression.
    oceanNavy: "#0B161F",
    panelNavy: "#131F2A",
    landGreyRelief: "#4B4842",
    textWhite: "#E1E8EC",
    goldMeasuredOnMap: "#CF9C23",
    // From the project brand spec, to be preferred where the two differ.
    brandNavy: "#0B1F38",
    brandCream: "#F7F4ED",
    brandGold: "#FFC857",
    brandTeal: "#4CC9B0",
  },
  typography: {
    // OBSERVED
    captions: "bold condensed sans, ALL CAPS, white, key words in gold, centred",
    labels: "monospaced, small, ALL CAPS (coordinates, scale bar, source line)",
    suggested: "IBM Plex Sans Condensed (bold) for captions and cards, IBM Plex Mono for labels (both free on Google Fonts)",
  },
  layout: {
    // OBSERVED, as fractions of the screen height from the top
    topRow: "about 14%: left = coordinates, scale bar, tiny source line; right = outlined gold badge with series name, a divider, then the episode topic in gold",
    caption: "about 23%: one short line at a time, centred",
    map: "full-bleed dark map: navy ocean, grey shaded-relief land, the story's country filled gold with a thin outline",
    cards: "gold-outlined rounded rectangles on semi-opaque navy; tiny gold caps label above big white caps text; placed above or below the highlighted area, never covering the caption line",
    marker: "white dot with glow and a mono label for the city",
    logo: "small gold circled mark at the right edge, about 72% down",
    progressBar: "thin gold line along the very top that fills across the full duration",
    outro: "flat dark grid background titled WORLD VIEW with circular country medallion cards",
  },
  motion: {
    // OBSERVED + MEASURED
    captionChangesPerSecond: 2.0, // MEASURED: 1.9 to 2.2 across the four videos
    captionMedianGapSeconds: 0.4, // MEASURED
    captionStyle: "each caption fades or blurs in; the newest word group is brightest; key words turn gold",
    camera: "opens on a rotating globe with a blue atmosphere glow, then flies to the story region with easing; map pans between regions",
    cards: "cards slide or fade in with the line they support and leave when the next beat starts",
    cuts: "no hard cuts: continuous camera move (scene-cut detector found none)", // MEASURED
  },
  audio: {
    // MEASURED
    levelDbfs: -16.4,
    quietShare: "2 to 3 percent of the time (continuous sound)",
    // INFERRED
    voiceover: "continuous voice-over synced to the captions (speech-like rhythm); exact voice and any music unknown",
    wordsPerSecond: [2.2, 3.0], // INFERRED from caption rate; confirm against the real script
  },
  structure: [
    // OBSERVED across the Get Ready episodes. fraction = share of total duration.
    { beat: "hook", fraction: 0.09, content: "globe plus 'In 60 seconds.' then the surprising instruction or claim in one line" },
    { beat: "who said what", fraction: 0.14, content: "official statement card with the speaker and the date" },
    { beat: "the reason", fraction: 0.2, content: "THE REASON card plus forecast or key-fact card with the time frame" },
    { beat: "the pushback", fraction: 0.1, content: "critics, doubts or the official reply, if the facts include any" },
    { beat: "what to do", fraction: 0.2, content: "checklist card and one big-number card, only from the supplied facts" },
    { beat: "reassurance", fraction: 0.07, content: "what officials say about risk, only if present in the facts" },
    { beat: "recap", fraction: 0.1, content: "2 to 4 medallion cards comparing places on one number or word" },
    { beat: "your take", fraction: 0.1, content: "question card (YOUR TAKE) or a vote card: which place next? A / B / C" },
  ],
  sourcing: {
    // OBSERVED: every beat carries its own source line, with the outlet and date
    sourceLine: "a tiny mono line under the scale bar that changes with each beat: SOURCES: OUTLET, OUTLET, DAY MONTH",
    creditLine: "FIRST REPORTED BY <outlet> where one outlet broke the story",
    photos: "reference videos use credited photo cards; this system has no licensed photos, so cards stay text-only unless the editor supplies images with licence details",
  },
  guardrails: [
    "Use only the supplied facts. Never invent numbers, quotes, dates or places.",
    "Calm framing: no panic wording. Preparedness stories must report official reassurance if the facts contain it, and say what is not known.",
    "A story reported by one outlet is labelled 'Reported by <outlet>, not independently confirmed'.",
    "Several outlets are not independent confirmation unless the facts show separate original sources.",
  ],
} as const;
