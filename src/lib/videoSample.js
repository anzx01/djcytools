import { uid } from "./generator.js";

const DEFAULT_VIDEO_SAMPLE_SECONDS = 15;
const shotDurations = [5, 5, 5, 4, 6, 5];

function stripPrefix(value = "") {
  return String(value || "")
    .replace(/^前\s*\d+\s*秒[:：]/, "")
    .replace(/^字幕钩子[:：]/, "")
    .replace(/^口播钩子[:：]/, "")
    .trim();
}

function formatTimecode(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const millis = Math.round((totalSeconds - Math.floor(totalSeconds)) * 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

function pickDialogue(episode = {}, shotIndex = 0) {
  const dialogue = Array.isArray(episode.dialogue) ? episode.dialogue : [];
  return dialogue[shotIndex % Math.max(dialogue.length, 1)] || stripPrefix(episode.hook) || "真相终于露出破绽。";
}

function buildVisualPrompt({ version, board, shot, episode, style, shotIndex }) {
  const characterNames = (version.characters || []).map((item) => item.name).filter(Boolean).slice(0, 2).join("、");
  return [
    "9:16 vertical short drama still",
    style,
    version.marketName || "global market",
    characterNames ? `characters: ${characterNames}` : "",
    `scene: ${shot.frame || episode.script || board.title}`,
    `camera: ${shot.camera || "close-up emotional reaction"}`,
    "cinematic lighting, sharp subtitle-safe composition, mobile-first framing",
    `continuity tag: episode ${board.episodeNumber} shot ${shotIndex + 1}`,
  ]
    .filter(Boolean)
    .join(", ");
}

function normalizeShot({ version, board, shot, episode, style, index, cursor }) {
  const duration = shotDurations[index % shotDurations.length];
  const start = cursor;
  const end = cursor + duration;
  const line = pickDialogue(episode, index);
  return {
    id: uid("shot"),
    position: index + 1,
    episodeNumber: board.episodeNumber,
    episodeTitle: board.title,
    start,
    end,
    duration,
    title: `${board.title} / ${shot.time || `${Math.round(start)}-${Math.round(end)}s`}`,
    frame: shot.frame || episode.script || "主角在关键关系冲突中完成反击。",
    camera: shot.camera || "近景切特写，保留强表情反应。",
    sound: shot.sound || "低频节奏 + 情绪停顿。",
    prop: shot.prop || "手机、合同、录音或身份线索。",
    subtitle: stripPrefix(line).slice(0, 42),
    voiceover: line,
    visualPrompt: buildVisualPrompt({ version, board, shot, episode, style, shotIndex: index }),
    assetStatus: "mock",
  };
}

function toNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeAiShot({ shot, fallbackShot, index, cursor }) {
  const fallbackDuration = fallbackShot?.duration || shotDurations[index % shotDurations.length];
  const duration = Math.max(3, Math.min(toNumber(shot.duration, fallbackDuration), 14));
  const start = toNumber(shot.start, cursor);
  const end = Math.max(start + 1, toNumber(shot.end, start + duration));
  return {
    ...fallbackShot,
    ...shot,
    id: shot.id || fallbackShot?.id || uid("shot"),
    position: toNumber(shot.position, index + 1),
    episodeNumber: toNumber(shot.episodeNumber, fallbackShot?.episodeNumber || 1),
    start,
    end,
    duration: Math.round((end - start) * 10) / 10,
    title: shot.title || fallbackShot?.title || `镜头 ${index + 1}`,
    frame: shot.frame || fallbackShot?.frame || "主角在关键关系冲突中完成反击。",
    camera: shot.camera || fallbackShot?.camera || "竖屏近景，保留强表情反应。",
    sound: shot.sound || fallbackShot?.sound || "低频节奏 + 情绪停顿。",
    prop: shot.prop || fallbackShot?.prop || "手机、合同、录音或身份线索。",
    subtitle: stripPrefix(shot.subtitle || shot.voiceover || fallbackShot?.subtitle || "").slice(0, 42),
    voiceover: shot.voiceover || fallbackShot?.voiceover || shot.subtitle || "",
    visualPrompt: shot.visualPrompt || fallbackShot?.visualPrompt || "",
    assetStatus: shot.assetStatus || "prompt_ready",
  };
}

export function createVideoSample({ project, version, options = {} }) {
  const style = options.style || "竖屏短剧写实风";
  const targetDuration = Number(options.targetDuration || DEFAULT_VIDEO_SAMPLE_SECONDS);
  const boards = Array.isArray(version?.storyboards) ? version.storyboards : [];
  const episodes = Array.isArray(version?.episodes) ? version.episodes : [];
  let cursor = 0;
  const shots = [];

  for (const board of boards.slice(0, 4)) {
    const episode = episodes.find((item) => Number(item.number) === Number(board.episodeNumber)) || episodes[board.episodeNumber - 1] || {};
    for (const shot of board.shots || []) {
      if (cursor >= targetDuration) break;
      const next = normalizeShot({ version, board, shot, episode, style, index: shots.length, cursor });
      shots.push(next);
      cursor = next.end;
    }
    if (cursor >= targetDuration) break;
  }

  if (!shots.length) {
    const fallbackEpisode = episodes[0] || {};
    shots.push(
      normalizeShot({
        version,
        board: { episodeNumber: fallbackEpisode.number || 1, title: fallbackEpisode.title || version?.selectedTitle || "样片开场" },
        shot: { time: "0-8s", frame: fallbackEpisode.hook || version?.logline || "主角遭遇关键误会。", camera: "竖屏近景强钩子" },
        episode: fallbackEpisode,
        style,
        index: 0,
        cursor: 0,
      }),
    );
    cursor = shots[0].end;
  }

  return {
    id: uid("sample"),
    name: options.name || `${version?.selectedTitle || project?.name || "短剧"} ${DEFAULT_VIDEO_SAMPLE_SECONDS}秒样片`,
    status: "preview_ready",
    format: "9:16",
    style,
    voice: options.voice || "情绪旁白女声",
    targetDuration,
    duration: Math.round(cursor),
    versionId: version?.id || "",
    versionName: version?.name || "",
    projectId: project?.id || "",
    createdAt: new Date().toISOString(),
    logline: version?.logline || "",
    shots,
    outputs: {
      preview: "browser_timeline",
      webm: "browser_canvas_ready",
      video: "pending_renderer",
      srt: "ready",
      json: "ready",
    },
  };
}

export function normalizeVideoSamplePayload({ project, version, payload = {}, fallback, meta = {} }) {
  const base = fallback || createVideoSample({ project, version });
  const rawShots = Array.isArray(payload.shots) && payload.shots.length ? payload.shots : base.shots || [];
  let cursor = 0;
  const shots = rawShots.slice(0, 18).map((shot, index) => {
    const normalized = normalizeAiShot({
      shot: shot || {},
      fallbackShot: base.shots?.[index],
      index,
      cursor,
    });
    cursor = normalized.end;
    return normalized;
  });

  return {
    ...base,
    id: payload.id || base.id,
    name: payload.name || base.name,
    status: payload.status || "preview_ready",
    format: payload.format || base.format || "9:16",
    style: payload.style || base.style,
    voice: payload.voice || base.voice,
    targetDuration: toNumber(payload.targetDuration, base.targetDuration || DEFAULT_VIDEO_SAMPLE_SECONDS),
    duration: Math.round(toNumber(payload.duration, cursor || base.duration || 0)),
    versionId: version?.id || base.versionId || "",
    versionName: version?.name || base.versionName || "",
    projectId: project?.id || base.projectId || "",
    createdAt: payload.createdAt || base.createdAt || new Date().toISOString(),
    logline: payload.logline || base.logline || version?.logline || "",
    source: meta.provider || payload.source || "AI",
    model: meta.model || payload.model,
    requestId: meta.requestId || payload.requestId,
    costUsd: meta.costUsd ?? payload.costUsd,
    shots,
    outputs: {
      ...base.outputs,
      ...(payload.outputs || {}),
      preview: "browser_timeline",
      webm: payload.outputs?.webm || "browser_canvas_ready",
      video: payload.outputs?.video || "pending_renderer",
      srt: "ready",
      json: "ready",
    },
  };
}

export function buildVideoSampleSrt(sample = {}) {
  return (sample.shots || [])
    .map((shot, index) =>
      [
        String(index + 1),
        `${formatTimecode(shot.start || 0)} --> ${formatTimecode(shot.end || 0)}`,
        shot.subtitle || shot.voiceover || shot.frame || "",
      ].join("\n"),
    )
    .join("\n\n");
}

export function buildVideoSampleVoiceover(sample = {}) {
  const lines = [
    `${sample.name || "短剧样片"} 配音稿`,
    `声音：${sample.voice || "默认旁白"}`,
    `时长：${sample.duration || 0}s`,
    "",
    ...(sample.shots || []).flatMap((shot, index) => [
      `${index + 1}. ${formatTimecode(shot.start || 0)} - ${formatTimecode(shot.end || 0)}`,
      shot.voiceover || shot.subtitle || shot.frame || "",
      "",
    ]),
  ];
  return lines.join("\n").trim();
}

export function buildVideoRenderManifest(sample = {}) {
  const shots = Array.isArray(sample.shots) ? sample.shots : [];
  const clips = shots.map((shot, index) => ({
    id: shot.id || `shot_${index + 1}`,
    index: index + 1,
    start: toNumber(shot.start, 0),
    end: toNumber(shot.end, toNumber(shot.start, 0) + toNumber(shot.duration, 6)),
    duration: toNumber(shot.duration, 6),
    episodeNumber: shot.episodeNumber || 1,
    title: shot.title || `镜头 ${index + 1}`,
    frame: shot.frame || "",
    camera: shot.camera || "",
    sound: shot.sound || "",
    prop: shot.prop || "",
    subtitle: shot.subtitle || "",
    voiceover: shot.voiceover || shot.subtitle || "",
    visualPrompt: shot.visualPrompt || "",
    assetStatus: shot.assetStatus || "prompt_ready",
  }));

  return {
    schemaVersion: "djcytools.video-render.v1",
    sampleId: sample.id || "",
    sampleName: sample.name || "短剧样片",
    source: sample.source || "AI",
    model: sample.model || "",
    requestId: sample.requestId || "",
    canvas: {
      width: 1080,
      height: 1920,
      fps: 30,
      aspectRatio: sample.format || "9:16",
      subtitleSafeArea: { x: 96, y: 1560, width: 888, height: 240 },
    },
    timeline: {
      duration: toNumber(sample.duration, clips.at(-1)?.end || 0),
      targetDuration: toNumber(sample.targetDuration, DEFAULT_VIDEO_SAMPLE_SECONDS),
      style: sample.style || "竖屏短剧写实风",
      voice: sample.voice || "情绪旁白女声",
    },
    tracks: [
      {
        id: "visual",
        type: "generated_visual",
        clips: clips.map((clip) => ({
          id: clip.id,
          start: clip.start,
          duration: clip.duration,
          prompt: clip.visualPrompt,
          fallbackText: clip.frame,
          camera: clip.camera,
          assetStatus: clip.assetStatus,
        })),
      },
      {
        id: "voiceover",
        type: "tts",
        voice: sample.voice || "情绪旁白女声",
        clips: clips.map((clip) => ({
          id: `${clip.id}_vo`,
          start: clip.start,
          duration: clip.duration,
          text: clip.voiceover,
        })),
      },
      {
        id: "subtitles",
        type: "subtitle",
        format: "srt",
        clips: clips.map((clip) => ({
          id: `${clip.id}_sub`,
          start: clip.start,
          end: clip.end,
          text: clip.subtitle,
        })),
      },
      {
        id: "sound_design",
        type: "sound_notes",
        clips: clips.map((clip) => ({
          id: `${clip.id}_sound`,
          start: clip.start,
          duration: clip.duration,
          note: clip.sound,
          prop: clip.prop,
        })),
      },
    ],
    deliverables: {
      preview: "browser_timeline",
      manifest: "ready",
      srt: "ready",
      voiceover: "ready",
      productionPack: "ready",
      webmPreview: sample.outputs?.webm || "browser_canvas_ready",
      video: sample.outputs?.video || "pending_renderer",
    },
  };
}

export function buildVideoSampleProductionPack(sample = {}) {
  const manifest = buildVideoRenderManifest(sample);
  const lines = [
    "# DJCYTools Video Production Pack",
    "",
    `Sample: ${manifest.sampleName}`,
    `Source: ${manifest.source}${manifest.model ? ` / ${manifest.model}` : ""}`,
    `Format: ${manifest.canvas.aspectRatio}, ${manifest.canvas.width}x${manifest.canvas.height}, ${manifest.canvas.fps}fps`,
    `Duration: ${manifest.timeline.duration}s / target ${manifest.timeline.targetDuration}s`,
    `Style: ${manifest.timeline.style}`,
    `Voice: ${manifest.timeline.voice}`,
    "",
    "## Render Status",
    `Preview: ${manifest.deliverables.preview}`,
    `SRT: ${manifest.deliverables.srt}`,
    `Voiceover: ${manifest.deliverables.voiceover}`,
    `WebM preview: ${manifest.deliverables.webmPreview}`,
    `Video: ${manifest.deliverables.video}`,
    "",
    "## Shot List",
    ...(sample.shots || []).flatMap((shot, index) => [
      "",
      `### ${index + 1}. ${shot.title || `Shot ${index + 1}`}`,
      `Time: ${formatTimecode(shot.start || 0)} - ${formatTimecode(shot.end || 0)} (${shot.duration || 0}s)`,
      `Frame: ${shot.frame || ""}`,
      `Camera: ${shot.camera || ""}`,
      `Subtitle: ${shot.subtitle || ""}`,
      `Voiceover: ${shot.voiceover || shot.subtitle || ""}`,
      `Sound: ${shot.sound || ""}`,
      `Prop: ${shot.prop || ""}`,
      `Visual Prompt: ${shot.visualPrompt || ""}`,
    ]),
    "",
    "## Manifest",
    "See the exported render-manifest JSON for machine-readable tracks.",
  ];
  return lines.join("\n").trim();
}
