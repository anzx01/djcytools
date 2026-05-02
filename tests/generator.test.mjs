import assert from "node:assert/strict";
import test from "node:test";
import { defaultBrief, templates } from "../src/data/templates.js";
import {
  analyzeCompliance,
  analyzeSimilarity,
  buildRewriteParams,
  createInteractiveExperience,
  createProject,
  rewriteVersion,
  scoreScript,
} from "../src/lib/generator.js";
import {
  buildVideoRenderManifest,
  buildVideoSampleProductionPack,
  buildVideoSampleSrt,
  buildVideoSampleVoiceover,
  createVideoSample,
  normalizeVideoSamplePayload,
} from "../src/lib/videoSample.js";
import { buildVideoPreviewPlan, getVideoPreviewShotAtTime } from "../src/lib/videoRenderer.js";

test("createProject generates a scored editable short drama project", () => {
  const project = createProject({
    brief: {
      ...defaultBrief,
      title: "测试项目",
      painPoint: "女主被误解后反杀。",
    },
    params: templates[0].defaultParams,
  });

  assert.equal(project.name, project.versions[0].selectedTitle);
  assert.equal(project.versions.length, 1);
  assert.equal(project.campaignResults.length, 0);
  assert.ok(project.versions[0].episodes.length >= 3);
  assert.ok(project.versions[0].score.total > 0);
});

test("rewriteVersion keeps history and activates the new version", () => {
  const project = createProject({ brief: defaultBrief, params: templates[0].defaultParams });
  const rewritten = rewriteVersion(project, "生成投流钩子");

  assert.equal(rewritten.versions.length, 2);
  assert.equal(rewritten.activeVersionId, rewritten.versions[0].id);
  assert.notEqual(rewritten.activeVersionId, project.activeVersionId);
});

test("buildRewriteParams pushes hook density for ad-hook instructions", () => {
  const next = buildRewriteParams({ conflict: 50, hookDensity: 50, humiliation: 50, reversal: 50, sweet: 50 }, "生成投流钩子");

  assert.equal(next.hookDensity, 60);
  assert.equal(next.reversal, 54);
});

test("scoreScript returns all production dimensions", () => {
  const project = createProject({ brief: defaultBrief, params: templates[0].defaultParams });
  const score = scoreScript(project.versions[0]);

  assert.equal(score.dimensions.length, 8);
  assert.ok(score.dimensions.some((item) => item.name === "投流可剪辑"));
  assert.ok(score.dimensions.some((item) => item.name === "相似度"));
});

test("production readiness adds storyboard, compliance and similarity signals", () => {
  const project = createProject({ brief: defaultBrief, params: templates[0].defaultParams });
  const version = project.versions[0];

  assert.ok(version.storyboards.length >= 3);
  assert.equal(version.complianceReport.level, "低风险");

  const risky = { ...version, logline: `${version.logline} 未成年 自杀 毒品` };
  assert.equal(analyzeCompliance(risky).level, "高风险");
  assert.equal(analyzeSimilarity(version, [version]).maxSimilarity, 0);
});

test("interactive experience creates C-side choice points", () => {
  const project = createProject({ brief: defaultBrief, params: templates[0].defaultParams });
  const experience = createInteractiveExperience({
    project,
    version: project.versions[0],
    mood: "想看反击",
    persona: "测试观众",
  });

  assert.equal(experience.persona, "测试观众");
  assert.ok(experience.choices.length >= 1);
  assert.equal(experience.choices[0].options.length, 3);
});

test("video sample creates a 9:16 shot package with SRT export", () => {
  const project = createProject({ brief: defaultBrief, params: templates[0].defaultParams });
  const sample = createVideoSample({ project, version: project.versions[0] });
  const srt = buildVideoSampleSrt(sample);

  assert.equal(sample.format, "9:16");
  assert.ok(sample.duration > 0);
  assert.ok(sample.duration <= 96);
  assert.ok(sample.shots.length >= 1);
  assert.equal(sample.outputs.srt, "ready");
  assert.match(srt, /00:00:00,000 --> 00:00:/);
});

test("Doubao video sample payload is normalized against local fallback", () => {
  const project = createProject({ brief: defaultBrief, params: templates[0].defaultParams });
  const version = project.versions[0];
  const fallback = createVideoSample({ project, version });
  const sample = normalizeVideoSamplePayload({
    project,
    version,
    fallback,
    meta: { provider: "Doubao-Seed-2.0", model: "doubao-seed-2-0-mini-260215", requestId: "video_1" },
    payload: {
      name: "Doubao 样片",
      shots: [
        {
          duration: 5,
          frame: "女主看到收购合同，决定当场反击。",
          subtitle: "今天开始，轮到我定规则。",
          visualPrompt: "9:16 vertical short drama, office confrontation, cinematic light",
        },
      ],
    },
  });

  assert.equal(sample.source, "Doubao-Seed-2.0");
  assert.equal(sample.model, "doubao-seed-2-0-mini-260215");
  assert.equal(sample.requestId, "video_1");
  assert.equal(sample.shots[0].assetStatus, "prompt_ready");
  assert.equal(sample.shots[0].start, 0);
  assert.equal(sample.shots[0].end, 5);
});

test("video sample exports voiceover, production pack and render manifest", () => {
  const project = createProject({ brief: defaultBrief, params: templates[0].defaultParams });
  const sample = createVideoSample({ project, version: project.versions[0] });
  const voiceover = buildVideoSampleVoiceover(sample);
  const productionPack = buildVideoSampleProductionPack(sample);
  const manifest = buildVideoRenderManifest(sample);

  assert.match(voiceover, /配音稿/);
  assert.match(productionPack, /DJCYTools Video Production Pack/);
  assert.equal(manifest.schemaVersion, "djcytools.video-render.v1");
  assert.equal(manifest.canvas.width, 1080);
  assert.equal(manifest.canvas.height, 1920);
  assert.equal(manifest.tracks.some((track) => track.id === "visual"), true);
  assert.equal(manifest.deliverables.productionPack, "ready");
  assert.equal(manifest.deliverables.webmPreview, "browser_canvas_ready");
});

test("browser video preview plan maps timeline time to shots", () => {
  const project = createProject({ brief: defaultBrief, params: templates[0].defaultParams });
  const sample = createVideoSample({ project, version: project.versions[0] });
  const plan = buildVideoPreviewPlan(sample, { maxPreviewSeconds: 12 });
  const first = getVideoPreviewShotAtTime(sample, 0);
  const second = getVideoPreviewShotAtTime(sample, sample.shots[1]?.start || 1);

  assert.equal(plan.width, 540);
  assert.equal(plan.height, 960);
  assert.ok(plan.previewDurationSeconds <= 12);
  assert.equal(first.index, 0);
  assert.ok(second.index >= 0);
});
