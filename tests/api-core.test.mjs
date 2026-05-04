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

function createScriptPayload(overrides = {}) {
  return {
    titleCandidates: ["测试短剧"],
    selectedTitle: "测试短剧",
    logline: "女主被误解后反击。",
    sellingPoints: ["强冲突"],
    characters: [],
    outline: [],
    episodes: [],
    adHooks: [],
    ...overrides,
  };
}

function createGenerateScriptBody() {
  return {
    brief: { market: "us", templateId: "test", episodeCount: 24, painPoint: "被误解", audience: "短剧观众" },
    params: {},
    template: { name: "测试模板", beat: "误会后反击" },
    market: { label: "美国", pacing: "快节奏" },
  };
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

test("script generation uses DeepSeek while real video uses Ark", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "djcytools-ai-routes-"));
  const routeEnv = {
    ...env,
    DJCYTOOLS_SCRIPT_API_KEY: "deepseek-test-key",
    DJCYTOOLS_REAL_VIDEO_API_KEY: "ark-test-key",
  };
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : {};
    calls.push({ url: String(url), headers: options.headers || {}, body });
    if (String(url).includes("deepseek")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: "deepseek-chat",
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ...createScriptPayload(),
                }),
              },
            },
          ],
          usage: { prompt_tokens: 12, completion_tokens: 18 },
        }),
      };
    }
    if (String(url).includes("/contents/generations/tasks")) {
      if (options.method === "GET") {
        if (String(url).endsWith("/failed_task")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: "failed_task",
              status: "failed",
              error: {
                code: "SetLimitExceeded",
                message: "Safe Experience Mode limit reached",
              },
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: "task_1",
            status: "succeeded",
            content: { video_url: "https://example.test/video.mp4" },
          }),
        };
      }
      return {
        ok: true,
        status: 202,
        json: async () => ({
          id: "task_1",
          status: "queued",
        }),
      };
    }
    if (String(url) === "https://example.test/video.mp4") {
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => new TextEncoder().encode("fake mp4").buffer,
      };
    }
    throw new Error(`Unexpected fetch call: ${url}`);
  };

  try {
    const session = createSession(rootDir, routeEnv, env.DJCYTOOLS_ADMIN_EMAIL, env.DJCYTOOLS_ADMIN_PASSWORD);
    const cookie = `djcytools_session=${encodeURIComponent(session.token)}`;

    const script = await request(rootDir, {
      method: "POST",
      url: "/api/generate-script",
      headers: { cookie, "content-type": "application/json" },
      body: createGenerateScriptBody(),
    }, routeEnv);
    assert.equal(script.statusCode, 200);
    assert.equal(JSON.parse(script.body).content.selectedTitle, "测试短剧");

    const realVideo = await request(rootDir, {
      method: "POST",
      url: "/api/real-video/tasks",
      headers: { cookie, "content-type": "application/json" },
      body: {
        project: { id: "p1", name: "测试项目" },
        version: {
          id: "v1",
          selectedTitle: "测试短剧",
          logline: "女主被误解后当众反击。",
          characters: [{ role: "女主", name: "林夏", archetype: "被低估的继承人", motive: "夺回话语权" }],
          episodes: [
            {
              number: 1,
              title: "婚礼反击",
              hook: "未婚夫当众羞辱女主。",
              script: "林夏在婚礼现场拿出证据，证明自己才是公司真正控股人。",
              dialogue: ["林夏：轮到我定规则。"],
            },
          ],
        },
        sample: {
          name: "镜头计划",
          style: "写实",
          shots: [
            { start: 0, end: 5, frame: "女主当场反击", subtitle: "轮到我定规则", prop: "证据U盘" },
            { start: 5, end: 10, frame: "好友递来偷拍视频", subtitle: "证据在这里", prop: "手机" },
          ],
        },
        shot: { episodeNumber: 1, duration: 5, frame: "女主当场反击", subtitle: "轮到我定规则", visualPrompt: "vertical drama" },
        ratio: "16:9",
        duration: 11,
        generateAudio: true,
        references: {
          firstFrameImageUrl: "https://example.test/first.jpg",
          endFrameImageUrl: "https://example.test/end.jpg",
          videoUrl: "https://example.test/ref.mp4",
          audioUrl: "https://example.test/ref.mp3",
        },
      },
    }, routeEnv);
    assert.equal(realVideo.statusCode, 202);
    const realVideoCreateBody = JSON.parse(realVideo.body);
    assert.equal(realVideoCreateBody.task.id, "task_1");
    assert.equal(realVideoCreateBody.task.generationTarget.scriptTitle, "测试短剧");
    assert.equal(realVideoCreateBody.task.generationTarget.label, "第1集 婚礼反击 · 镜头 1");

    const realVideoStatus = await request(rootDir, {
      url: "/api/real-video/tasks/task_1",
      headers: { cookie },
    }, routeEnv);
    const realVideoStatusBody = JSON.parse(realVideoStatus.body);
    assert.equal(realVideoStatusBody.task.videoUrl, "https://example.test/video.mp4");
    assert.equal(realVideoStatusBody.task.localVideoUrl, "/api/generated-videos/task_1.mp4");
    assert.equal(realVideoStatusBody.task.title, "测试短剧 · 第1集 婚礼反击");
    assert.equal(realVideoStatusBody.task.generationTarget.label, "第1集 婚礼反击 · 镜头 1");

    const generatedVideos = await request(rootDir, {
      url: "/api/generated-videos",
      headers: { cookie },
    }, routeEnv);
    const generatedVideoList = JSON.parse(generatedVideos.body).videos;
    assert.equal(generatedVideoList[0].taskId, "task_1");
    assert.equal(generatedVideoList[0].title, "测试短剧 · 第1集 婚礼反击");
    assert.equal(generatedVideoList[0].localVideoUrl, "/api/generated-videos/task_1.mp4");
    assert.equal(generatedVideoList[0].generationTarget.label, "第1集 婚礼反击 · 镜头 1");

    const showcaseVideos = await request(rootDir, {
      url: "/api/showcase/generated-videos",
    }, routeEnv);
    assert.equal(showcaseVideos.statusCode, 200);
    const showcaseVideoList = JSON.parse(showcaseVideos.body).videos;
    assert.equal(showcaseVideoList[0].taskId, "task_1");
    assert.equal(showcaseVideoList[0].title, "测试短剧 · 第1集 婚礼反击");
    assert.equal(showcaseVideoList[0].localVideoUrl, "/api/showcase/generated-videos/task_1.mp4");
    assert.equal(showcaseVideoList[0].generationTarget.label, "第1集 婚礼反击 · 镜头 1");

    const showcaseVideoFile = await request(rootDir, {
      url: "/api/showcase/generated-videos/task_1.mp4",
    }, routeEnv);
    assert.equal(showcaseVideoFile.statusCode, 200);

    const failedRealVideoStatus = await request(rootDir, {
      url: "/api/real-video/tasks/failed_task",
      headers: { cookie },
    }, routeEnv);
    const failedTask = JSON.parse(failedRealVideoStatus.body).task;
    assert.equal(failedTask.status, "failed");
    assert.equal(failedTask.errorCode, "SetLimitExceeded");
    assert.match(failedTask.error, /Safe Experience Mode/);
    assert.match(failedTask.errorHint, /Safe Experience Mode/);
    assert.match(failedTask.errorHelpUrl, /openManagement/);

    assert.equal(calls[0].url, "https://api.deepseek.com/chat/completions");
    assert.equal(calls[0].body.model, "deepseek-chat");
    assert.ok(Array.isArray(calls[0].body.messages));
    assert.equal(calls[0].headers.Authorization, "Bearer deepseek-test-key");
    assert.equal(calls[1].url, "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks");
    assert.equal(calls[1].body.model, "doubao-seedance-2-0-260128");
    assert.equal(calls[1].body.ratio, "16:9");
    assert.equal(calls[1].body.duration, 15);
    assert.equal(calls[1].body.generate_audio, true);
    assert.equal(calls[1].body.content[0].type, "text");
    assert.ok(calls[1].body.content[0].text.length > 100);
    assert.equal(calls[1].body.content[1].type, "image_url");
    assert.equal(calls[1].body.content[1].role, "reference_image");
    assert.equal(calls[1].body.content[3].type, "video_url");
    assert.equal(calls[1].body.content[3].role, "reference_video");
    assert.equal(calls[1].body.content[4].type, "audio_url");
    assert.equal(calls[1].body.content[4].role, "reference_audio");
    assert.equal(calls[1].headers.Authorization, "Bearer ark-test-key");
    assert.equal(calls[2].url, "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/task_1");
    assert.equal(calls[3].url, "https://example.test/video.mp4");
    assert.ok(calls.some((call) => call.url === "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks?page_num=1&page_size=30"));
    assert.ok(calls.some((call) => call.url === "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/failed_task"));
  } finally {
    globalThis.fetch = originalFetch;
    closeDatabase(rootDir);
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("script generation accepts fenced, wrapped and lightly malformed DeepSeek JSON", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "djcytools-ai-json-"));
  const routeEnv = {
    ...env,
    DJCYTOOLS_SCRIPT_API_KEY: "deepseek-test-key",
  };
  const originalFetch = globalThis.fetch;
  const responses = [
    `这是结果：\n\`\`\`json\n${JSON.stringify(createScriptPayload({ selectedTitle: "代码块短剧" }), null, 2)}\n\`\`\`\n请查收。`,
    JSON.stringify({ data: createScriptPayload({ selectedTitle: "包装短剧" }) }),
    `json\n{
      "titleCandidates": ["裸换行短剧"],
      "selectedTitle": "裸换行短剧",
      "logline": "第一行
第二行",
      "sellingPoints": ["强冲突",],
      "characters": [],
      "outline": [],
      "episodes": [],
      "adHooks": [],
    }`,
  ];
  let fetchCount = 0;
  globalThis.fetch = async () => {
    const content = responses[fetchCount];
    fetchCount += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        model: "deepseek-chat",
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 12, completion_tokens: 18 },
      }),
    };
  };

  try {
    const session = createSession(rootDir, routeEnv, env.DJCYTOOLS_ADMIN_EMAIL, env.DJCYTOOLS_ADMIN_PASSWORD);
    const cookie = `djcytools_session=${encodeURIComponent(session.token)}`;
    const expectedTitles = ["代码块短剧", "包装短剧", "裸换行短剧"];

    for (const expectedTitle of expectedTitles) {
      const response = await request(rootDir, {
        method: "POST",
        url: "/api/generate-script",
        headers: { cookie, "content-type": "application/json" },
        body: createGenerateScriptBody(),
      }, routeEnv);

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.content.selectedTitle, expectedTitle);
    }

    assert.equal(fetchCount, expectedTitles.length);
  } finally {
    globalThis.fetch = originalFetch;
    closeDatabase(rootDir);
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("script generation repairs invalid DeepSeek JSON before falling back", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "djcytools-ai-repair-"));
  const routeEnv = {
    ...env,
    DJCYTOOLS_SCRIPT_API_KEY: "deepseek-test-key",
  };
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : {};
    calls.push({ url: String(url), body });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        model: "deepseek-chat",
        choices: [
          {
            message: {
              content: calls.length === 1
                ? '{"selectedTitle":"坏 JSON", "episodes": ['
                : JSON.stringify(createScriptPayload({ selectedTitle: "修复后短剧" })),
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      }),
    };
  };

  try {
    const session = createSession(rootDir, routeEnv, env.DJCYTOOLS_ADMIN_EMAIL, env.DJCYTOOLS_ADMIN_PASSWORD);
    const cookie = `djcytools_session=${encodeURIComponent(session.token)}`;
    const response = await request(rootDir, {
      method: "POST",
      url: "/api/generate-script",
      headers: { cookie, "content-type": "application/json" },
      body: createGenerateScriptBody(),
    }, routeEnv);

    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 200);
    assert.equal(body.content.selectedTitle, "修复后短剧");
    assert.equal(body.repaired, true);
    assert.equal(calls.length, 2);
    assert.match(calls[1].body.messages[1].content, /待修复内容/);
  } finally {
    globalThis.fetch = originalFetch;
    closeDatabase(rootDir);
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("script rewrite returns server fallback instead of surfacing invalid JSON errors", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "djcytools-ai-fallback-"));
  const routeEnv = {
    ...env,
    DJCYTOOLS_SCRIPT_API_KEY: "deepseek-test-key",
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      model: "deepseek-chat",
      choices: [{ message: { content: '{"selectedTitle":"仍然坏", "episodes": [' } }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    }),
  });

  try {
    const session = createSession(rootDir, routeEnv, env.DJCYTOOLS_ADMIN_EMAIL, env.DJCYTOOLS_ADMIN_PASSWORD);
    const cookie = `djcytools_session=${encodeURIComponent(session.token)}`;
    const response = await request(rootDir, {
      method: "POST",
      url: "/api/generate-script",
      headers: { cookie, "content-type": "application/json" },
      body: {
        ...createGenerateScriptBody(),
        instruction: "提高冲突",
        currentVersion: {
          selectedTitle: "原始短剧",
          logline: "女主被误解后反击。",
          sellingPoints: ["原始卖点"],
          characters: [{ role: "女主", name: "林夏", archetype: "清洁工", motive: "复仇", secret: "真实继承人" }],
          outline: [{ stage: "阶段 1", summary: "被羞辱后开始反击。" }],
          episodes: [{ number: 1, title: "清洁工反击", hook: "她被当众羞辱。", beat: "受辱后翻盘。", script: "林夏拿出证据。", dialogue: ["林夏：轮到我了。"] }],
          adHooks: ["清洁工被羞辱后反杀。"],
        },
      },
    }, routeEnv);

    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 200);
    assert.equal(body.fallback, "server_fallback");
    assert.equal(body.content.selectedTitle, "原始短剧");
    assert.equal(body.content.episodes[0].title, "清洁工反击");
    assert.match(body.warning, /JSON|valid|content|Unexpected|Expected|terminated/i);
  } finally {
    globalThis.fetch = originalFetch;
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

test("email registration and password reset work in local token mode", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "djcytools-auth-api-"));
  try {
    const register = await request(rootDir, {
      method: "POST",
      url: "/api/auth/register",
      headers: { "content-type": "application/json" },
      body: {
        email: "solo-founder@example.test",
        password: "FounderPassword2026",
        name: "Solo Founder",
        teamName: "Solo Studio",
      },
    });
    assert.equal(register.statusCode, 201);
    const registered = JSON.parse(register.body);
    assert.equal(registered.authenticated, true);
    assert.equal(registered.user.email, "solo-founder@example.test");
    assert.equal(registered.emailDelivery.configured, false);

    const resetRequest = await request(rootDir, {
      method: "POST",
      url: "/api/auth/password-reset/request",
      headers: { "content-type": "application/json" },
      body: { email: "solo-founder@example.test" },
    });
    const resetBody = JSON.parse(resetRequest.body);
    assert.equal(resetRequest.statusCode, 200);
    assert.equal(resetBody.tokenExposed, true);
    assert.ok(resetBody.token);
    assert.equal(resetBody.emailDelivery.configured, false);

    const confirm = await request(rootDir, {
      method: "POST",
      url: "/api/auth/password-reset/confirm",
      headers: { "content-type": "application/json" },
      body: { token: resetBody.token, password: "FounderPasswordReset2026" },
    });
    assert.equal(confirm.statusCode, 200);

    const login = await request(rootDir, {
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/json" },
      body: { email: "solo-founder@example.test", password: "FounderPasswordReset2026" },
    });
    assert.equal(login.statusCode, 200);
    assert.equal(JSON.parse(login.body).user.email, "solo-founder@example.test");
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
