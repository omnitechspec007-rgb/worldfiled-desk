import { useEffect, useMemo, useRef, useState } from "react";

type RoundupStory = {
  id: string;
  headline: string;
  summary: string;
  location?: string;
  source?: string;
  publishedAt?: string | null;
  sourceUrl?: string;
  reviewed?: boolean;
};

type Props = { title: string; stories: RoundupStory[]; exportReady: boolean; preflightNote: string };

const W = 1080;
const H = 1920;
const DURATION_MS = 6000;
const MAX_BALANCED_STORIES = 7;

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function linesFor(ctx: CanvasRenderingContext2D, value: string, maxWidth: number, maxLines: number) {
  const words = value.trim().split(/\\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? line + " " + word : word;
    if (ctx.measureText(next).width <= maxWidth || !line) line = next;
    else {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  const used = lines.join(" ").length;
  if (used < value.trim().length && lines.length) {
    let last = lines[lines.length - 1];
    while (last.length && ctx.measureText(last + "…").width > maxWidth) last = last.slice(0, -1);
    lines[lines.length - 1] = last.trimEnd() + "…";
  }
  return lines;
}

function drawText(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines: number) {
  const lines = linesFor(ctx, value, maxWidth, maxLines);
  lines.forEach((line, i) => ctx.fillText(line, x, y + i * lineHeight));
  return lines.length;
}

/** Presenter-free WorldFiled editorial poster: all visual information is typographic. */
function renderPoster(canvas: HTMLCanvasElement, title: string, date: string, cards: RoundupStory[]) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.width = W;
  canvas.height = H;

  const gradient = ctx.createLinearGradient(0, 0, W, H);
  gradient.addColorStop(0, "#0B1F38");
  gradient.addColorStop(0.56, "#122E4D");
  gradient.addColorStop(1, "#071728");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, W, H);

  // Quiet archival framing; intentionally lower contrast than the story text.
  ctx.strokeStyle = "rgba(247,244,237,0.055)";
  ctx.lineWidth = 1;
  for (let x = 54; x < W; x += 90) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  ctx.fillStyle = "rgba(76,201,176,0.08)";
  ctx.beginPath();
  ctx.arc(1010, 240, 190, 0, Math.PI * 2);
  ctx.fill();

  // Brand masthead.
  ctx.fillStyle = "#FFC857";
  ctx.fillRect(64, 62, 8, 82);
  ctx.fillStyle = "#F7F4ED";
  ctx.font = "700 27px Inter, Arial, sans-serif";
  ctx.fillText("THE WORLD, FILED.", 94, 93);
  ctx.fillStyle = "#4CC9B0";
  ctx.font = "600 18px Inter, Arial, sans-serif";
  ctx.fillText("WHAT HAPPENED. WHAT CHANGED. WHAT MATTERS.", 94, 128);

  // Edition headline panel.
  rounded(ctx, 48, 178, 984, 248, 18);
  ctx.fillStyle = "#F7F4ED";
  ctx.fill();
  ctx.fillStyle = "#0B1F38";
  ctx.font = "800 19px Inter, Arial, sans-serif";
  ctx.fillText("THE WORLD, IN BRIEF", 82, 222);
  ctx.fillStyle = "#B17A16";
  ctx.fillRect(82, 242, 72, 5);
  ctx.fillStyle = "#0B1F38";
  ctx.font = "700 54px Georgia, serif";
  let titleLines = linesFor(ctx, title.toUpperCase(), 900, 2);
  // Keep a two-line edition title clear of the date baseline inside the fixed masthead panel.
  const titleSize = titleLines.length > 1 ? 44 : 54;
  const titleY = titleLines.length > 1 ? 300 : 330;
  ctx.font = "700 " + titleSize + "px Georgia, serif";
  titleLines = linesFor(ctx, title.toUpperCase(), 900, 2);
  titleLines.forEach((line, i) => ctx.fillText(line, 82, titleY + i * (titleSize + 10)));
  ctx.fillStyle = "#52677D";
  ctx.font = "600 19px Inter, Arial, sans-serif";
  ctx.fillText(date.toUpperCase(), 82, 397);

  // Balanced 5–7 story stack. Story cards retain generous gutters and source labels.
  const top = 456;
  const bottom = 1744;
  const gap = cards.length >= 7 ? 10 : 14;
  const cardH = (bottom - top - gap * Math.max(0, cards.length - 1)) / Math.max(1, cards.length);
  cards.forEach((story, index) => {
    const y = top + index * (cardH + gap);
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.20)";
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 4;
    rounded(ctx, 48, y, 984, cardH, 13);
    ctx.fillStyle = "#F7F4ED";
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = index % 3 === 1 ? "#4CC9B0" : "#FFC857";
    ctx.fillRect(48, y, 11, cardH);

    const padX = 82;
    ctx.fillStyle = "#52677D";
    ctx.font = "700 18px Inter, Arial, sans-serif";
    const label = story.location ? story.location.toUpperCase().slice(0, 38) : "WORLD UPDATE";
    ctx.fillText(String(index + 1).padStart(2, "0") + "  /  " + label, padX, y + 29);

    const dense = cards.length >= 6;
    const headlineSize = cards.length >= 7 ? 30 : cards.length === 6 ? 34 : 38;
    ctx.fillStyle = "#0B1F38";
    ctx.font = "700 " + headlineSize + "px Inter, Arial, sans-serif";
    const headlineY = y + 65;
    const titleCount = drawText(ctx, story.headline, padX, headlineY, 900, headlineSize * 1.12, 2);

    const summarySize = cards.length >= 7 ? 20 : cards.length === 6 ? 22 : 25;
    ctx.fillStyle = "#31465B";
    ctx.font = "500 " + summarySize + "px Inter, Arial, sans-serif";
    const summaryY = headlineY + titleCount * headlineSize * 1.12 + (dense ? 9 : 14);
    drawText(ctx, story.summary, padX, summaryY, 900, summarySize * 1.18, dense ? 1 : 2);

    ctx.fillStyle = "#68798A";
    ctx.font = "600 20px Inter, Arial, sans-serif";
    const dateMatch = story.publishedAt ? /^(\d{4})-(\d{2})-(\d{2})/.exec(story.publishedAt) : null;
    const dateLabel = dateMatch
      ? new Date(Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]))).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).toUpperCase()
      : "DATE UNKNOWN";
    const sourceLabel = story.source
      ? "SOURCE: " + story.source.toUpperCase().slice(0, 42) + "  ·  " + dateLabel
      : "SOURCE NOT PROVIDED  ·  " + dateLabel + "  ·  CHECK BEFORE SHARING";
    ctx.fillText(sourceLabel, padX, y + cardH - 8);
  });

  // Branded close / follow prompt.
  ctx.fillStyle = "#FFC857";
  ctx.fillRect(64, 1802, 58, 5);
  ctx.fillStyle = "#F7F4ED";
  ctx.font = "700 23px Inter, Arial, sans-serif";
  ctx.fillText("FOLLOW THE WORLD, FILED.", 64, 1850);
  ctx.fillStyle = "rgba(247,244,237,0.76)";
  ctx.font = "500 18px Inter, Arial, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("WHAT MATTERS, IN CONTEXT.", 1016, 1850);
  ctx.textAlign = "left";
}

export default function StaticRoundupBuilder({ title, stories, exportReady, preflightNote }: Props) {
  const storySignature = JSON.stringify(stories);
  const initial = useMemo(() => stories.slice(0, MAX_BALANCED_STORIES).map((s) => ({
    ...s,
    headline: s.headline.slice(0, 150),
    summary: (s.summary || s.headline).slice(0, 190),
    reviewed: false,
  })), [storySignature]);
  const omittedCount = Math.max(0, stories.length - MAX_BALANCED_STORIES);
  const [cards, setCards] = useState<RoundupStory[]>(initial);
  const [editionTitle, setEditionTitle] = useState(title || "The World You Probably Missed");
  const [date, setDate] = useState(new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }));
  const [rendering, setRendering] = useState(false);
  const [notice, setNotice] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => { setCards(initial); }, [initial]);
  useEffect(() => {
    if (canvasRef.current) renderPoster(canvasRef.current, editionTitle, date, cards);
  }, [editionTitle, date, cards]);

  const updateCard = (id: string, key: "headline" | "summary", value: string) => {
    setCards((current) => current.map((c) => c.id === id ? { ...c, [key]: value, reviewed: false } : c));
  };
  const moveCard = (index: number, direction: -1 | 1) => {
    setCards((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };
  const removeCard = (id: string) => setCards((current) => current.filter((card) => card.id !== id));
  const reviewCard = (id: string, reviewed: boolean) => setCards((current) => current.map((card) => card.id === id ? { ...card, reviewed } : card));
  const allCardsReviewed = cards.length > 0 && cards.every((card) => card.reviewed === true);
  const canExport = exportReady && allCardsReviewed;

  const downloadPoster = () => {
    if (!exportReady) { setNotice("Export blocked: " + preflightNote); return; }
    if (!allCardsReviewed) { setNotice("Export blocked: review every card's headline and supporting text against its source first."); return; }
    if (!allCardsReviewed) { setNotice("Export blocked: review every card's headline and supporting text against its source first."); return; }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement("a");
    a.download = "worldfiled-news-roundup.png";
    try {
      a.href = canvas.toDataURL("image/png");
      a.click();
    } catch {
      setNotice("The poster could not be exported by this browser. Try the latest Chrome or Edge desktop browser.");
    }
  };

  const exportVideo = async () => {
    if (!exportReady) { setNotice("Export blocked: " + preflightNote); return; }
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!("MediaRecorder" in window) || !canvas.captureStream) {
      setNotice("This browser cannot export a video from the static preview. Use the latest Chrome or Edge desktop browser.");
      return;
    }
    const mime = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((x) => MediaRecorder.isTypeSupported(x));
    if (!mime) { setNotice("This browser does not support WebM video export."); return; }

    setRendering(true);
    setNotice("Rendering a six-second, completely static video…");
    let audio: AudioContext | null = null;
    try {
      const videoStream = canvas.captureStream(30);
      audio = new AudioContext();
      const destination = audio.createMediaStreamDestination();
      const tracks = [...videoStream.getVideoTracks(), ...destination.stream.getAudioTracks()];
      const stream = new MediaStream(tracks);
      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 5_000_000, audioBitsPerSecond: 96_000 });
      const finished = new Promise<Blob>((resolve, reject) => {
        recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
        recorder.onerror = () => reject(new Error("The browser video recorder failed."));
        recorder.onstop = () => resolve(new Blob(chunks, { type: mime }));
      });
      await audio.resume();
      recorder.start(250);

      // Quiet two-note editorial signature; no music bed or narration.
      const playNote = (frequency: number, start: number, length: number) => {
        const oscillator = audio!.createOscillator();
        const gain = audio!.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.012, start + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
        oscillator.connect(gain);
        gain.connect(destination);
        oscillator.start(start);
        oscillator.stop(start + length + 0.02);
      };
      const startAt = audio.currentTime + 0.08;
      playNote(660, startAt, 0.12);
      playNote(880, startAt + 0.2, 0.16);
      await new Promise((resolve) => window.setTimeout(resolve, DURATION_MS));
      recorder.stop();
      const blob = await finished;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "worldfiled-six-second-roundup.webm";
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setNotice("Six-second static video exported as WebM with the subtle WorldFiled sound signature.");
      tracks.forEach((track) => track.stop());
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not export the video.");
    } finally {
      if (audio && audio.state !== "closed") await audio.close().catch(() => undefined);
      setRendering(false);
    }
  };

  return (
    <div className="roundup-builder">
      <div className="confirm">
        <h3>WorldFiled static news roundup</h3>
        <p className="meta">Presenter-free editorial design in WorldFiled navy, archive cream, gold and teal. One vertical composition, completely still for six seconds: no photographs, voiceover, animation, camera movement or transitions.</p>
        <div className="row">
          <label>Edition headline<input value={editionTitle} onChange={(e) => setEditionTitle(e.target.value)} maxLength={100} /></label>
          <label>Edition date<input value={date} onChange={(e) => setDate(e.target.value)} maxLength={32} /></label>
        </div>
        <p className="meta">Balanced layout: 5–6 stories give the clearest mobile reading; 7 are supported with a tighter type scale. Every card keeps its headline, context and source/date label. Fewer stories are preferable to padding an edition.</p>
        {omittedCount > 0 && <p className="state-warning">{omittedCount} additional candidate{omittedCount === 1 ? " remains" : "s remain"} outside this seven-story composition. They have not been deleted; review them in the Edition Desk.</p>}
      </div>

      <div className="roundup-preview">
        <div className="roundup-preview-head"><strong>LIVE WORLD FILED COMPOSITION</strong><span>9:16 · 1080 × 1920</span></div>
        <canvas ref={canvasRef} aria-label="Presenter-free WorldFiled static news roundup preview" />
      </div>

      <div className="panel">
        <h3>Story cards ({cards.length})</h3>
        <p className="meta">Edit, reorder or remove stories. The preview shows the actual final layout. Source names appear on each strip when available; open the linked story to inspect the underlying evidence.</p>
        {cards.map((card, index) => (
          <div className="roundup-card-editor" key={card.id}>
            <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
              <p className="rank">STORY {String(index + 1).padStart(2, "0")} {card.location ? "· " + card.location : ""}</p>
              <div className="actions">
                <button type="button" disabled={index === 0} onClick={() => moveCard(index, -1)} aria-label={`Move story ${index + 1} up`}>↑</button>
                <button type="button" disabled={index === cards.length - 1} onClick={() => moveCard(index, 1)} aria-label={`Move story ${index + 1} down`}>↓</button>
                <button type="button" onClick={() => removeCard(card.id)} aria-label={`Remove story ${index + 1}`}>Remove</button>
              </div>
            </div>
            <label>Headline<input value={card.headline} maxLength={150} onChange={(e) => updateCard(card.id, "headline", e.target.value)} /></label>
            <label>Supporting text<textarea value={card.summary} maxLength={190} rows={2} onChange={(e) => updateCard(card.id, "summary", e.target.value)} /></label>
            <p className="meta">{card.source ? "Source: " + card.source : "No source label available; export will remain blocked."}{card.sourceUrl ? <> · <a href={card.sourceUrl} target="_blank" rel="noreferrer">Open source</a></> : null}</p>
            <label className="inline"><input type="checkbox" checked={card.reviewed === true} onChange={(e) => reviewCard(card.id, e.target.checked)} /> I checked this headline and supporting text against the source.</label>
          </div>
        ))}
      </div>
      {notice && <p className="status">{notice}</p>}
      <p className={canExport ? "status good" : "status bad"}>{!exportReady ? "EXPORT LOCKED: " + preflightNote : !allCardsReviewed ? "EDITOR REVIEW REQUIRED: check every headline and supporting text against its source before export." : "EXPORT CLEARANCE CONFIRMED: " + preflightNote}</p>
      <div className="actions">
        <button disabled={!canExport} onClick={downloadPoster}>Download static poster (PNG)</button>
        <button className="primary" disabled={!canExport || rendering} onClick={() => void exportVideo()}>{rendering ? "RENDERING SIX SECONDS…" : "EXPORT SIX-SECOND VIDEO"}</button>
      </div>
      <p className="meta">Export uses WebM in modern Chrome and Edge. MP4 conversion is not performed in this browser-only release. The same single frame remains visible for all six seconds.</p>
    </div>
  );
}
