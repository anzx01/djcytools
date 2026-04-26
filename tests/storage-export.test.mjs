import assert from "node:assert/strict";
import test from "node:test";
import { defaultBrief, templates } from "../src/data/templates.js";
import { buildProjectText, calculateCampaignMetrics, sanitizeFilename } from "../src/lib/exporters.js";
import { createProject } from "../src/lib/generator.js";
import { normalizeWorkspace } from "../src/lib/storage.js";

test("normalizeWorkspace repairs old workspace payloads", () => {
  const workspace = normalizeWorkspace({
    activeProjectId: "missing",
    projects: [{ id: "p1", versions: [], comments: [] }],
    team: { name: "测试团队" },
  });

  assert.equal(workspace.activeProjectId, "p1");
  assert.deepEqual(workspace.projects[0].exports, []);
  assert.deepEqual(workspace.projects[0].campaignResults, []);
  assert.equal(workspace.team.members.length, 3);
  assert.deepEqual(workspace.customTemplates, []);
});

test("calculateCampaignMetrics derives CTR, completion, CPA and ROAS", () => {
  const metrics = calculateCampaignMetrics({
    impressions: 10000,
    clicks: 500,
    completions: 2500,
    conversions: 25,
    spend: 125,
    revenue: 250,
  });

  assert.equal(metrics.ctr, 5);
  assert.equal(metrics.completionRate, 25);
  assert.equal(metrics.conversionRate, 5);
  assert.equal(metrics.cpa, 5);
  assert.equal(metrics.roas, 2);
});

test("buildProjectText includes campaign feedback and export-safe filenames can be generated", () => {
  const project = createProject({ brief: defaultBrief, params: templates[0].defaultParams });
  const version = project.versions[0];
  const projectWithCampaign = {
    ...project,
    campaignResults: [
      {
        channel: "Meta Ads",
        materialName: "测试素材",
        versionName: version.name,
        impressions: 1000,
        clicks: 80,
        completions: 250,
        conversions: 4,
        spend: 40,
        revenue: 88,
        note: "前 3 秒表现较好",
      },
    ],
  };

  const text = buildProjectText(projectWithCampaign, version);
  assert.match(text, /投流结果回流/);
  assert.match(text, /Meta Ads/);
  assert.equal(sanitizeFilename('a/b:c*?"<>|'), "a-b-c------");
});
