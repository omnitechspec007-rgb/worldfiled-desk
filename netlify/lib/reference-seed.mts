// Reference Library seed. EVERY rule is loaded as PROPOSED and only the editor can approve it.
// Only two kinds of evidence are used:
//   file_probe          re-verified by running ffprobe / ffmpeg on the files (commands in the note)
//   visual_observation  seen by eye in sampled frames of 360x640 copies. NOT verified for every video.
// Deliberately NOT seeded (could not be verified): caption-change rate, exact colours, fonts, spoken words,
// presence of music, who made the videos, and whether the editor owns them.

export const SEED_VIDEOS = [
  { label: "Reference video 1", original_filename: "187bd758-AQMyMvHOj7cFGOtND5OjjVXMAbHgkCbZ56BnPLG5i22VlNzZ5T0dfNzrNKtG2QUo_8PKx7cYL0NoqqXteOV9mqg-jamr94zJvz-vkcVZFg.mp4", duration_seconds: 89.98, mean_db: -16.5 },
  { label: "Reference video 2", original_filename: "522b8351-AQMcxo-ZGNXMUTrEDnQyWYG792dRucr8MfzmS5NrnbxPzeO3ZuHgBx9YF2-vzBNtMB6QGAio4aCU0To-ntBw7jwsXLPB6LmA5bTQVA9ZgA.mp4", duration_seconds: 93.04, mean_db: -16.3 },
  { label: "Reference video 3", original_filename: "74ae48e7-AQOa766qVFl3WWJBr5JBOyw360a71gjeVHjgIfy_DazX5dXcX92N-3V0Z4uxavNZ36eS0sxBqKm0XEQa_9o-OZikeebXIxCi4gd4W93uzw.mp4", duration_seconds: 59.24, mean_db: -16.3 },
  { label: "Reference video 4", original_filename: "f2076a6c-AQNntI9riBdeONTQj0Be9n-pCNTFwbNfnJ59NeVArRi5PBPVSfI-JI4a7GhP-vY3x7VMfXS4hSaGfeP_yhQZmeC06n_YcP7Cs09TekBOww.mp4", duration_seconds: 58.88, mean_db: -16.3 },
].map((v) => ({
  label: v.label,
  original_filename: v.original_filename,
  duration_seconds: v.duration_seconds,
  width: 360,
  height: 640,
  fps: 30,
  inspection_level: "partially_inspected" as const,
  inspection_notes: `File facts verified with ffprobe/ffmpeg (length, size, 30 fps, no hard cuts, mean audio level ${v.mean_db} dB). Layout seen by eye in sampled frames only. Spoken words were not transcribed.`,
  unknowns: ["spoken words", "music present or not", "voice or tool used", "exact fonts and colours", "who made the video and whether the editor owns it"],
}));

type Seed = { rule_key: string; category: string; statement: string; evidence_basis: "file_probe" | "visual_observation" | "user_stated"; evidence_note: string };
export const SEED_RULES: Seed[] = [
  { rule_key: "format.vertical", category: "format", statement: "Vertical 9:16 format, roughly 60 to 90 seconds.", evidence_basis: "file_probe", evidence_note: "All four files are 360x640 and 58.9 to 93.0 seconds long (ffprobe)." },
  { rule_key: "motion.no_hard_cuts", category: "motion", statement: "Continuous motion with no hard cuts: scenes flow into each other through camera movement and transitions.", evidence_basis: "file_probe", evidence_note: "ffmpeg scene detector (threshold 0.4) found 0 cuts in all four files. A detector can miss soft cuts." },
  { rule_key: "audio.continuous_narration_level", category: "audio", statement: "Narration or audio runs continuously at a steady, moderate level.", evidence_basis: "file_probe", evidence_note: "Mean volume -16.3 to -16.5 dB in all four (ffmpeg volumedetect). Whether it is speech, music or both was not determined." },
  { rule_key: "visual.dark_map_gold_highlight", category: "visual", statement: "Dark map-based visuals with the story's location highlighted in a warm accent colour.", evidence_basis: "visual_observation", evidence_note: "Seen in sampled frames of 360 px copies; not checked frame by frame in every video. WorldFiled uses its own approved palette instead of the references' colours." },
  { rule_key: "visual.centred_caption", category: "typography", statement: "One short caption line at a time, centred, with key words emphasised.", evidence_basis: "visual_observation", evidence_note: "Seen in sampled frames; the caption rhythm was not measured reliably and is not included." },
  { rule_key: "visual.info_cards", category: "layout", statement: "Compact outlined information cards with a small label and large text for the key fact.", evidence_basis: "visual_observation", evidence_note: "Seen in sampled frames; not verified for every video." },
  { rule_key: "structure.recap_and_question", category: "structure", statement: "Open with a clear hook and close with a short recap and a question for the audience.", evidence_basis: "visual_observation", evidence_note: "Seen by eye in contact sheets of the opening and closing frames; not verified for every video." },
  { rule_key: "constraint.original_identity", category: "constraint", statement: "Use the references only for general principles. Do not copy their series name, logo, wording or layout: WorldFiled's brand governs.", evidence_basis: "user_stated", evidence_note: "From the editor's instruction that the goal is an original WorldFiled visual identity." },
];
