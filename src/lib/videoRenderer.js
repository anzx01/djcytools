const palette = [
  { bg: "#17140f", hot: "#b43d2f", cool: "#2f5f8f", light: "#f0c34e" },
  { bg: "#12221c", hot: "#c1852e", cool: "#316b57", light: "#fffaf0" },
  { bg: "#1f1b22", hot: "#b43d2f", cool: "#5a6c8f", light: "#f4efe5" },
  { bg: "#201a13", hot: "#2f5f8f", cool: "#8a4d3d", light: "#f0c34e" },
];

function number(value, fallback) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function text(value, fallback = "") {
  return String(value || fallback || "").trim();
}

function shotFingerprint(shot = {}, index = 0) {
  const raw = text(shot.frame || shot.subtitle || shot.title, `shot-${index}`);
  let hash = index + 17;
  for (let i = 0; i < raw.length; i += 1) hash = (hash * 31 + raw.charCodeAt(i)) % 9973;
  return hash;
}

function wrapText(ctx, value, maxWidth, maxLines = 3) {
  const content = text(value);
  const chars = [...content];
  const lines = [];
  let line = "";
  for (const char of chars) {
    const next = `${line}${char}`;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = char;
      if (lines.length >= maxLines) break;
    } else {
      line = next;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && chars.join("").length > lines.join("").length) {
    lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, Math.max(0, lines[maxLines - 1].length - 1))}…`;
  }
  return lines;
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

export function buildVideoPreviewPlan(sample = {}, options = {}) {
  const durationSeconds = Math.max(1, number(sample.duration, 0) || number(sample.targetDuration, 15));
  const shotCount = Array.isArray(sample.shots) ? sample.shots.length : 0;
  const minPreviewSeconds = number(options.minPreviewSeconds, 8);
  const maxPreviewSeconds = number(options.maxPreviewSeconds, 18);
  const naturalPreview = Math.max(minPreviewSeconds, shotCount * 1.35);
  const previewDurationSeconds = Math.min(maxPreviewSeconds, naturalPreview, durationSeconds);
  return {
    width: number(options.width, 540),
    height: number(options.height, 960),
    fps: number(options.fps, 30),
    durationSeconds,
    previewDurationSeconds,
    speed: durationSeconds / Math.max(previewDurationSeconds, 1),
    shotCount,
  };
}

export function getVideoPreviewShotAtTime(sample = {}, timeSeconds = 0) {
  const shots = Array.isArray(sample.shots) ? sample.shots : [];
  if (!shots.length) return { shot: null, index: 0, localProgress: 0 };
  const duration = Math.max(1, number(sample.duration, shots.at(-1)?.end || 1));
  const t = ((number(timeSeconds, 0) % duration) + duration) % duration;
  const foundIndex = shots.findIndex((shot) => t >= number(shot.start, 0) && t < number(shot.end, number(shot.start, 0) + number(shot.duration, 6)));
  const safeIndex = foundIndex === -1 ? shots.length - 1 : Math.max(0, foundIndex);
  const shot = shots[safeIndex];
  const start = number(shot.start, 0);
  const end = number(shot.end, start + number(shot.duration, 6));
  return {
    shot,
    index: safeIndex,
    localProgress: Math.max(0, Math.min(1, (t - start) / Math.max(1, end - start))),
  };
}

export function drawVideoPreviewFrame(ctx, sample = {}, timeSeconds = 0, options = {}) {
  const width = number(options.width, 540);
  const height = number(options.height, 960);
  const { shot, index, localProgress } = getVideoPreviewShotAtTime(sample, timeSeconds);
  const theme = palette[shotFingerprint(shot, index) % palette.length];
  const pulse = Math.sin(localProgress * Math.PI);
  const push = localProgress * 36;

  ctx.save();
  ctx.clearRect(0, 0, width, height);

  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, theme.bg);
  bg.addColorStop(0.45, theme.cool);
  bg.addColorStop(1, theme.bg);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  const heat = ctx.createRadialGradient(width * 0.18, height * (0.22 + localProgress * 0.08), 20, width * 0.18, height * 0.22, height * 0.58);
  heat.addColorStop(0, `${theme.hot}cc`);
  heat.addColorStop(1, `${theme.hot}00`);
  ctx.fillStyle = heat;
  ctx.fillRect(0, 0, width, height);

  ctx.globalAlpha = 0.18;
  ctx.fillStyle = "#fffaf0";
  for (let x = -120; x < width + 80; x += 74) {
    ctx.save();
    ctx.translate(x + push, height * 0.05);
    ctx.rotate(-0.18);
    ctx.fillRect(0, 0, 24, height * 0.9);
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = "rgba(0,0,0,0.24)";
  ctx.fillRect(0, height * 0.58, width, height * 0.26);

  const floor = ctx.createLinearGradient(0, height * 0.72, 0, height);
  floor.addColorStop(0, "rgba(255,250,240,0.08)");
  floor.addColorStop(1, "rgba(0,0,0,0.52)");
  ctx.fillStyle = floor;
  ctx.fillRect(0, height * 0.72, width, height * 0.28);

  const personX = width * (0.3 + pulse * 0.04);
  const opponentX = width * (0.7 - pulse * 0.035);
  [personX, opponentX].forEach((x, personIndex) => {
    const scale = personIndex === 0 ? 1 + pulse * 0.04 : 0.92;
    ctx.fillStyle = personIndex === 0 ? "rgba(255,250,240,0.88)" : "rgba(23,20,15,0.78)";
    ctx.beginPath();
    ctx.arc(x, height * 0.48, 34 * scale, 0, Math.PI * 2);
    ctx.fill();
    roundedRect(ctx, x - 48 * scale, height * 0.525, 96 * scale, 188 * scale, 32);
    ctx.fill();
  });

  ctx.strokeStyle = theme.light;
  ctx.lineWidth = 7;
  ctx.globalAlpha = 0.75;
  ctx.beginPath();
  ctx.moveTo(width * 0.12, height * 0.39 + pulse * 12);
  ctx.lineTo(width * 0.88, height * 0.34 - pulse * 10);
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.fillStyle = "rgba(0,0,0,0.5)";
  roundedRect(ctx, 24, 24, width - 48, 52, 14);
  ctx.fill();
  ctx.fillStyle = "#fffaf0";
  ctx.font = "700 22px 'Noto Sans SC', sans-serif";
  ctx.fillText(text(sample.name, "短剧样片").slice(0, 18), 44, 58);
  ctx.fillStyle = theme.light;
  ctx.font = "800 18px 'Noto Sans SC', sans-serif";
  ctx.fillText(`EP${shot?.episodeNumber || 1} / ${Math.round(timeSeconds)}s`, width - 160, 58);

  const frameBoxY = height * 0.12;
  ctx.fillStyle = "rgba(0,0,0,0.32)";
  roundedRect(ctx, 34, frameBoxY, width - 68, 154, 18);
  ctx.fill();
  ctx.fillStyle = "#fffaf0";
  ctx.font = "800 26px 'Noto Sans SC', sans-serif";
  wrapText(ctx, shot?.frame || sample.logline || "短剧样片预览", width - 106, 3).forEach((line, lineIndex) => {
    ctx.fillText(line, 54, frameBoxY + 44 + lineIndex * 36);
  });

  ctx.fillStyle = "rgba(0,0,0,0.68)";
  roundedRect(ctx, 34, height - 188, width - 68, 126, 18);
  ctx.fill();
  ctx.textAlign = "center";
  ctx.fillStyle = "#fffdf6";
  ctx.font = "900 30px 'Noto Sans SC', sans-serif";
  wrapText(ctx, shot?.subtitle || shot?.voiceover || shot?.frame || "", width - 108, 2).forEach((line, lineIndex) => {
    ctx.fillText(line, width / 2, height - 132 + lineIndex * 42);
  });
  ctx.textAlign = "left";

  const progressWidth = width - 68;
  ctx.fillStyle = "rgba(255,250,240,0.2)";
  roundedRect(ctx, 34, height - 38, progressWidth, 8, 4);
  ctx.fill();
  ctx.fillStyle = theme.light;
  roundedRect(ctx, 34, height - 38, progressWidth * localProgress, 8, 4);
  ctx.fill();

  ctx.restore();
}
