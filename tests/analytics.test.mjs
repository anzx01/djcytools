import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildAnalyticsSummary, normalizeAnalyticsStore, recordAnalyticsEvent } from "../server/apiCore.mjs";
import { closeDatabase } from "../server/database.mjs";

test("recordAnalyticsEvent tracks page views and unique visitors by page", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "djcytools-analytics-"));
  try {
    await recordAnalyticsEvent(rootDir, { page: "landing", visitorId: "visitor-alpha-001" });
    await recordAnalyticsEvent(rootDir, { page: "landing", visitorId: "visitor-alpha-001" });
    await recordAnalyticsEvent(rootDir, { page: "workbench", visitorId: "visitor-alpha-001" });
    const summary = await recordAnalyticsEvent(rootDir, { page: "workbench", visitorId: "visitor-beta-002" });

    assert.equal(summary.pages.landing.pageViews, 2);
    assert.equal(summary.pages.landing.uniqueVisitors, 1);
    assert.equal(summary.pages.workbench.pageViews, 2);
    assert.equal(summary.pages.workbench.uniqueVisitors, 2);
    assert.equal(summary.totals.pageViews, 4);
    assert.equal(summary.totals.uniqueVisitors, 2);
    assert.equal(summary.recentEvents[0].page, "workbench");
  } finally {
    closeDatabase(rootDir);
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("analytics summary repairs malformed stores without exposing visitor hashes", () => {
  const store = normalizeAnalyticsStore({
    pages: {
      landing: { pageViews: "3", visitorHashes: ["hash-123456789012", "hash-123456789012"], lastVisitedAt: "2026-04-26T00:00:00.000Z" },
      workbench: { pageViews: "bad", visitorHashes: ["hash-abcdef123456"] },
    },
    visitorHashes: ["hash-123456789012"],
    recentEvents: [{ id: "event-1", page: "landing", createdAt: "2026-04-26T00:00:00.000Z" }],
  });
  const summary = buildAnalyticsSummary(store);

  assert.equal(summary.pages.landing.pageViews, 3);
  assert.equal(summary.pages.workbench.pageViews, 0);
  assert.equal(summary.totals.uniqueVisitors, 2);
  assert.equal(summary.pages.landing.visitorHashes, undefined);
  assert.equal(summary.recentEvents.length, 1);
});
