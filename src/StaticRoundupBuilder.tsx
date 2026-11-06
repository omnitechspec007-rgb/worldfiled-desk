import { useEffect, useMemo, useRef, useState } from "react";

type RoundupStory = {
  id: string;
  headline: string;
  summary: string;
  location?: string;
  source?: string;
};

type Props = { title: string; stories: RoundupStory[] };

const W = 1080;
const H = 1920;
const DURATION_MS = 6000;

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function linesFor(ctx: CanvasRenderingContext2D, value: string, maxWidth: number, maxLines: number) {
  const words = value.trim().split(/\s+/).filter(Boolean);
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

function renderPoster(canvas: HTMLCanvasElement, title: string, date: string, cards: RoundupStory[], image?: HTMLImageElement | null) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.width = W;
  canvas.height = H;

  const gradient = ctx.createLinearGradient(0, 0, W, H);
  gradient.addColorStop(0, "#0B1F38");
  gradient.addColorStop(0.55, "#122E4D");
  gradient.addColorStop(1, "#071728");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, W, H);

  if (image && image.complete && image.naturalWidth > 0) {
    const scale = Math.max(W / image.naturalWidth, H / image.naturalHeight);
    const sw = W / scale, sh = H / scale;
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.drawImage(image, (image.naturalWidth - sw) / 2, (image.naturalHeight - sh) / 2, sw, sh, 0, 0, W, H);
    ctx.restore();
    ctx.fillStyle = "rgba(5, 19, 34, 0.62)";
    ctx.fillRect(0, 0, W, H);
  }

  // Restrained archival grid and corner marks.
  ctx.strokeStyle = "rgba(247,244,237,0.07)";
  ctx.lineWidth = 1;
  for (let x = 54; x < W; x += 72) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 54; y < H; y += 72) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  ctx.fillStyle = "#FFC857";
  ctx.fillRect(64, 62, 8, 82);
  ctx.fillStyle = "#F7F4ED";
  ctx.font = "700 27px Inter, Arial, sans-serif";
  ctx.fillText("THE WORLD, FILED.", 94, 93);
  ctx.fillStyle = "#4CC9B0";
  ctx.font = "600 18px Inter, Arial, sans-serif";
  ctx.fillText("WHAT HAPPENED. WHAT CHANGED. WHAT MATTERS.", 94, 128);

  ctx.fillStyle = "#FFC857";
  ctx.font = "700 20px Inter, Arial, sans-serif";
  ctx.fillText("INTERNATIONAL NEWS", 64, 218);
  ctx.fillStyle = "#F7F4ED";
  ctx.font = "700 58px Georgia, serif";
  const titleLines = linesFor(ctx, title.toUpperCase(), 950, 2);
  titleLines.forEach((line, i) => ctx.fillText(line, 64, 292 + i * 68));
  ctx.fillStyle = "rgba(247,244,237,0.76)";
  ctx.font = "500 21px Inter, Arial, sans-serif";
  ctx.fillText(date.toUpperCase(), 66, 330 + (titleLines.length - 1) * 68);
  ctx.fillStyle = "#4CC9B0";
  ctx.fillRect(64, 365 + (titleLines.length - 1) * 68, 94, 5);

  const top = 410 + (titleLines.length - 1) * 68;
  const bottom = 1788;
  const gap = cards.length > 8 ? 10 : 13;
  const cardH = (bottom - top - gap * Math.max(0, cards.length - 1)) / Math.max(1, cards.length);
  const compact = cards.length > 8;
  cards.forEach((story, index) => {
    const y = top + index * (cardH + gap);
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.22)";
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 5;
    rounded(ctx, 48, y, 984, cardH, 13);
    ctx.fillStyle = "#F7F4ED";
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = index % 3 === 1 ? "#4CC9B0" : "#FFC857";
    ctx.fillRect(48, y, 12, cardH);

    const padX = 82;
    const labelY = y + (compact ? 28 : 31);
    ctx.fillStyle = "#52677D";
    ctx.font = "700 17px Inter, Arial, sans-serif";
    const label = story.location ? story.location.toUpperCase().slice(0, 34) : "WORLD UPDATE";
    ctx.fillText(String(index + 1).padStart(2, "0") + "  /  " + label, padX, labelY);

    const headlineSize = compact ? 27 : cards.length > 6 ? 29 : 32;
    ctx.fillStyle = "#0B1F38";
    ctx.font = "700 " + headlineSize + "px Inter, Arial, sans-serif";
    const headlineY = y + (compact ? 61 : 68);
    const titleCount = drawText(ctx, story.headline, padX, headlineY, 900, headlineSize * 1.16, compact ? 1 : 2);

    const summarySize = compact ? 21 : 23;
    ctx.fillStyle = "#31465B";
    ctx.font = "500 " + summarySize + "px Inter, Arial, sans-serif";
    const summaryY = headlineY + titleCount * headlineSize * 1.16 + (compact ? 25 : 28);
    const maxSummaryLines = compact ? 1 : 2;
    drawText(ctx, story.summary, padX, summaryY, 900, summarySize * 1.25, maxSummaryLines);
    if (story.source) {
      ctx.fillStyle = "#68798A";
      ctx.font = "500 14px Inter, Arial, sans-serif";
      ctx.fillText("SOURCE: " + story.source.toUpperCase().slice(0, 54), padX, y + cardH - 13);
    }
  });

  ctx.fillStyle = "#FFC857";
  ctx.fillRect(64, 1830, 56, 4);
  ctx.fillStyle = "#F7F4ED";
  ctx.font = "700 20px Inter, Arial, sans-serif";
  ctx.fillText("THE WORLD, FILED.", 64, 1872);
  ctx.fillStyle = "rgba(247,244,237,0.7)";
  ctx.font = "500 17px Inter, Arial, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("WHAT MATTERS, IN CONTEXT.", 1016, 1872);
  ctx.textAlign = "left";
}

export default function StaticRoundupBuilder({ title, stories }: Props) {
  const storySignature = JSON.stringify(stories);
  const initial = useMemo(() => stories.slice(0, 10).map((s) => ({
    ...s,
    headline: s.headline.slice(0, 150),
    summary: (s.summary || s.headline).slice(0, 190),
  })), [storySignature]);
  const [cards, setCards] = useState<RoundupStory[]>(initial);
  const [editionTitle, setEditionTitle] = useState(title || "The World You Probably Missed");
  const [date, setDate] = useState(new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }));
  const [imageUrl, setImageUrl] = useState("");
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [rendering, setRendering] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [notice, setNotice] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileUrlRef = useRef<string | null>(null);

  useEffect(() => { setCards(initial); }, [initial]);
  useEffect(() => {
    if (!imageUrl) { setImage(null); return; }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => setImage(img);
    img.onerror = () => { setImage(null); setNotice("That image could not be loaded. Try a direct image URL or upload a local image."); };
    img.src = imageUrl;
  }, [imageUrl]);

  useEffect(() => {
    if (canvasRef.current) renderPoster(canvasRef.current, editionTitle, date, cards, image);
  }, [editionTitle, date, cards, image]);

  useEffect(() => () => { if (fileUrlRef.current) URL.revokeObjectURL(fileUrlRef.current); }, []);

  const compactLayout = cards.length > 8;
  const textFitWarnings = cards.flatMap((card, index) => {
    const headlineLimit = compactLayout ? 64 : 92;
    const summaryLimit = compactLayout ? 92 : 150;
    const warnings: string[] = [];
    if (card.headline.trim().length > headlineLimit) warnings.push(`Story ${index + 1}: headline may be shortened in the poster preview.`);
    if (card.summary.trim().length > summaryLimit) warnings.push(`Story ${index + 1}: supporting text may be shortened in the poster preview.`);
    return warnings;
  });

  const updateCard = (id: string, key: "headline" | "summary", value: string) => {
    setCards((current) => current.map((c) => c.id === id ? { ...c, [key]: value } : c));
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

  const downloadPoster = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement("a");
    a.download = "the-world-filed-roundup.png";
    try {
      a.href = canvas.toDataURL("image/png");
      a.click();
    } catch {
      setNotice("The background image blocks browser export. Upload the image locally or use an image URL that permits cross-origin access.");
    }
  };

  const exportVideo = async () => {
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
      const destination = soundEnabled ? (audio = new AudioContext()).createMediaStreamDestination() : null;
      const tracks = [...videoStream.getVideoTracks(), ...(destination ? destination.stream.getAudioTracks() : [])];
      const stream = new MediaStream(tracks);
      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 5_000_000, audioBitsPerSecond: 96_000 });
      const finished = new Promise<Blob>((resolve, reject) => {
        recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
        recorder.onerror = () => reject(new Error("The browser video recorder failed."));
        recorder.onstop = () => resolve(new Blob(chunks, { type: mime }));
      });
      if (audio && destination) await audio.resume();
      recorder.start(250);

      // Optional quiet two-note editorial signature; no music bed or narration.
      const playNote = (frequency: number, start: number, length: number) => {
        const oscillator = audio!.createOscillator();
        const gain = audio!.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.012, start + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
        oscillator.connect(gain);
        if (!destination) return;
        gain.connect(destination);
        oscillator.start(start);
        oscillator.stop(start + length + 0.02);
      };
      if (audio && soundEnabled) {
        const startAt = audio.currentTime + 0.08;
        playNote(660, startAt, 0.12);
        playNote(880, startAt + 0.2, 0.16);
      }
      await new Promise((resolve) => window.setTimeout(resolve, DURATION_MS));
      recorder.stop();
      const blob = await finished;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "the-world-filed-six-second-roundup.webm";
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setNotice(soundEnabled ? "Six-second video exported as WebM with the subtle two-note sound signature. The visual remains still throughout." : "Six-second silent WebM exported. The visual remains still throughout.");
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
        <h3>Static six-second news roundup</h3>
        <p className="meta">One vertical editorial composition. It appears immediately, stays completely still for six seconds, and ends. No presenter, voiceover, animation, camera movement or transitions.</p>
        <div className="row">
          <label>Edition headline<input value={editionTitle} onChange={(e) => setEditionTitle(e.target.value)} maxLength={100} /></label>
          <label>Edition date<input value={date} onChange={(e) => setDate(e.target.value)} maxLength={32} /></label>
        </div>
        <label>Optional background photograph URL<input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://… (optional)" /></label>
        <label className="inline">Or use a local photograph<input type="file" accept="image/*" onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          if (fileUrlRef.current) URL.revokeObjectURL(fileUrlRef.current);
          fileUrlRef.current = URL.createObjectURL(file);
          setImageUrl(fileUrlRef.current);
          setNotice("");
        }} /></label>
      </div>

      <label className="inline"><input type="checkbox" checked={soundEnabled} onChange={(e) => setSoundEnabled(e.target.checked)} /> Include subtle two-note sound effect (no music or narration)</label>

      <div className="roundup-preview">
        <div className="roundup-preview-head"><strong>LIVE COMPOSITION PREVIEW</strong><span>9:16 · 1080 × 1920</span></div>
        <canvas ref={canvasRef} aria-label="Static six-second news roundup preview" />
      </div>

      <div className="panel">
        <h3>Story cards ({cards.length})</h3>
        <p className="meta">Edit, reorder or remove stories. Keep each one factual and short; the preview shows the actual final layout. Source names are included where available. A shorter edition is acceptable when fewer stories merit inclusion.</p>
        {textFitWarnings.length > 0 && <p className="caution">Review text fit before export: {textFitWarnings.join(" ")}</p>}
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
            <p className="meta">{card.source ? "Source: " + card.source : "No source label available; verify the evidence in the edition before export."}</p>
          </div>
        ))}
      </div>
      {notice && <p className="status">{notice}</p>}
      <div className="actions">
        <button onClick={downloadPoster}>Download static poster (PNG)</button>
        <button className="primary" disabled={rendering || cards.length === 0} onClick={() => void exportVideo()}>{rendering ? "RENDERING SIX SECONDS…" : "EXPORT SIX-SECOND VIDEO"}</button>
      </div>
      <p className="meta">Export currently uses WebM, supported by modern Chrome and Edge. MP4 conversion is not included in this browser-only release. The poster is the same single frame used for all six seconds. Check the exported file before uploading it to a platform.</p>
    </div>
  );
}
