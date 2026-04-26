import assert from "node:assert/strict";
import test from "node:test";
import { defaultBrief, templates } from "../src/data/templates.js";
import { buildRewriteParams, createProject, rewriteVersion, scoreScript } from "../src/lib/generator.js";

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

  assert.equal(score.dimensions.length, 7);
  assert.ok(score.dimensions.some((item) => item.name === "投流可剪辑"));
});
