import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { PassThrough } from "node:stream";
import test from "node:test";
import { handleApiRequest } from "../server/apiCore.mjs";
import { closeDatabase, createPublicApiToken, createSession, readWorkspaceFromDatabase } from "../server/database.mjs";

const env = {
  DJCYTOOLS_ADMIN_EMAIL: "api-owner@example.test",
  DJCYTOOLS_ADMIN_PASSWORD: "CorrectHorseBatteryStaple",
  DJCYTOOLS_ADMIN_NAME: "API 所有者",
  DJCYTOOLS_TEAM_NAME: "API 测试团队",
  DJCYTOOLS_PUBLIC_API_TOKEN: "public-token-for-tests",
};

function createReq({ method = "GET", url, headers = {}, body = null }) {
  const req = new PassThrough();
  req.method = method;
  req.url = url;
  req.headers = headers;
  req.socket = { remoteAddress: "127.0.0.1" };
  if (body !== null) {
    process.nextTick(() => {
      req.end(typeof body === "string" ? body : JSON.stringify(body));
    });
  }
  return req;
}

function createRes() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value;
    },
    end(value = "") {
      this.body = String(value);
    },
  };
}

async function request(rootDir, options, requestEnv = env) {
  const req = createReq(options);
  const res = createRes();
  const handled = await handleApiRequest({ req, res, env: requestEnv, rootDir });
  assert.equal(handled, true);
  return res;
}

function createWebhookRecorder() {
  const calls = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      calls.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: raw,
      });
      res.statusCode = 204;
      res.end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        calls,
        url: `http://127.0.0.1:${address.port}/webhook`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

test("public API exposes health, OpenAPI and project exports behind a token", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "djcytools-api-"));
  try {
    const session = createSession(rootDir, env, env.DJCYTOOLS_ADMIN_EMAIL, env.DJCYTOOLS_ADMIN_PASSWORD);
    const workspace = readWorkspaceFromDatabase(rootDir, env, session);
    const projectId = workspace.projects[0].id;

    const openapi = await request(rootDir, { url: "/api/public/openapi.json" });
    assert.equal(openapi.statusCode, 200);
    assert.equal(JSON.parse(openapi.body).openapi, "3.1.0");

    const denied = await request(rootDir, { url: "/api/public/health" });
    assert.equal(denied.statusCode, 401);

    const health = await request(rootDir, {
      url: "/api/public/health",
      headers: { "x-djcytools-api-key": env.DJCYTOOLS_PUBLIC_API_TOKEN },
    });
    assert.equal(health.statusCode, 200);
    assert.equal(JSON.parse(health.body).service, "djcytools-public-api");

    const list = await request(rootDir, {
      url: "/api/public/projects",
      headers: { authorization: `Bearer ${env.DJCYTOOLS_PUBLIC_API_TOKEN}` },
    });
    assert.equal(JSON.parse(list.body).projects.some((project) => project.id === projectId), true);

    const exported = await request(rootDir, {
      url: `/api/public/projects/${encodeURIComponent(projectId)}/export`,
      headers: { "x-djcytools-api-key": env.DJCYTOOLS_PUBLIC_API_TOKEN },
    });
    assert.equal(JSON.parse(exported.body).project.id, projectId);

    const campaign = await request(rootDir, {
      method: "POST",
      url: `/api/public/projects/${encodeURIComponent(projectId)}/campaign-results`,
      headers: {
        "content-type": "application/json",
        "x-djcytools-api-key": env.DJCYTOOLS_PUBLIC_API_TOKEN,
      },
      body: {
        channel: "Meta Ads",
        spend: 120,
        impressions: 18000,
        clicks: 720,
        completions: 3200,
        conversions: 24,
        revenue: 360,
      },
    });
    assert.equal(campaign.statusCode, 201);
    assert.equal(JSON.parse(campaign.body).result.metrics.roas, 3);

    const dbToken = createPublicApiToken(rootDir, env, session, { name: "数据库 Token" });
    const dbTokenList = await request(rootDir, {
      url: "/api/public/projects",
      headers: { "x-djcytools-api-key": dbToken.token },
    });
    assert.equal(dbTokenList.statusCode, 200);
    assert.equal(JSON.parse(dbTokenList.body).projects.every((project) => project.teamName === env.DJCYTOOLS_TEAM_NAME), true);
  } finally {
    closeDatabase(rootDir);
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("owner can download a PostgreSQL migration SQL pack", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "djcytools-pg-export-"));
  try {
    const session = createSession(rootDir, env, env.DJCYTOOLS_ADMIN_EMAIL, env.DJCYTOOLS_ADMIN_PASSWORD);
    const res = await request(rootDir, {
      url: "/api/storage/postgres-export",
      headers: { cookie: `djcytools_session=${encodeURIComponent(session.token)}` },
    });

    assert.equal(res.statusCode, 200);
    assert.match(res.body, /CREATE TABLE IF NOT EXISTS projects/);
    assert.match(res.body, /INSERT INTO teams/);
    assert.match(res.headers["content-disposition"], /djcytools-postgres/);
  } finally {
    closeDatabase(rootDir);
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("owner can inspect and update the local notification outbox", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "djcytools-outbox-"));
  try {
    const session = createSession(rootDir, env, env.DJCYTOOLS_ADMIN_EMAIL, env.DJCYTOOLS_ADMIN_PASSWORD);
    const cookie = `djcytools_session=${encodeURIComponent(session.token)}`;
    const invite = await request(rootDir, {
      method: "POST",
      url: "/api/team/invites",
      headers: { cookie, "content-type": "application/json" },
      body: { email: "outbox-writer@example.test", name: "Outbox Writer", role: "editor" },
    });
    assert.equal(invite.statusCode, 201);

    const list = await request(rootDir, {
      url: "/api/notifications/outbox",
      headers: { cookie },
    });
    const notification = JSON.parse(list.body).notifications.find((item) => item.kind === "team_invite");
    assert.ok(notification);
    assert.match(notification.body, /outbox-writer@example\.test/);

    const updated = await request(rootDir, {
      method: "PATCH",
      url: `/api/notifications/outbox/${encodeURIComponent(notification.id)}`,
      headers: { cookie, "content-type": "application/json" },
      body: { status: "sent" },
    });
    assert.equal(JSON.parse(updated.body).notification.status, "sent");
  } finally {
    closeDatabase(rootDir);
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("owner can deliver a notification through the configured webhook", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "djcytools-webhook-"));
  const webhook = await createWebhookRecorder();
  const webhookEnv = {
    ...env,
    DJCYTOOLS_NOTIFICATION_WEBHOOK_URL: webhook.url,
    DJCYTOOLS_NOTIFICATION_WEBHOOK_SECRET: "test-secret",
  };
  try {
    const session = createSession(rootDir, webhookEnv, env.DJCYTOOLS_ADMIN_EMAIL, env.DJCYTOOLS_ADMIN_PASSWORD);
    const cookie = `djcytools_session=${encodeURIComponent(session.token)}`;
    await request(rootDir, {
      method: "POST",
      url: "/api/team/invites",
      headers: { cookie, "content-type": "application/json" },
      body: { email: "webhook-writer@example.test", name: "Webhook Writer", role: "viewer" },
    }, webhookEnv);

    const list = await request(rootDir, {
      url: "/api/notifications/outbox",
      headers: { cookie },
    }, webhookEnv);
    const listBody = JSON.parse(list.body);
    assert.equal(listBody.webhookConfigured, true);
    const notification = listBody.notifications.find((item) => item.kind === "team_invite");
    assert.ok(notification);

    const delivered = await request(rootDir, {
      method: "POST",
      url: `/api/notifications/outbox/${encodeURIComponent(notification.id)}/deliver`,
      headers: { cookie },
    }, webhookEnv);
    const deliveredBody = JSON.parse(delivered.body);
    assert.equal(deliveredBody.ok, true);
    assert.equal(deliveredBody.notification.status, "sent");
    assert.equal(deliveredBody.notification.channel, "webhook");
    assert.equal(webhook.calls.length, 1);
    assert.equal(webhook.calls[0].method, "POST");
    assert.match(webhook.calls[0].headers["x-djcytools-signature"], /^sha256=/);
    assert.match(JSON.parse(webhook.calls[0].body).notification.body, /webhook-writer@example\.test/);
  } finally {
    closeDatabase(rootDir, webhookEnv);
    await webhook.close();
    await rm(rootDir, { recursive: true, force: true });
  }
});
