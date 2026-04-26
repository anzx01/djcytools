import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  appendAiLogToDatabase,
  canRole,
  createProjectInDatabase,
  createSession,
  deleteProjectFromDatabase,
  destroySession,
  getProjectFromDatabase,
  listProjectsFromDatabase,
  readAiLogsFromDatabase,
  readAnalyticsSummaryFromDatabase,
  readSession,
  readWorkspaceFromDatabase,
  registerUser,
  recordAnalyticsEventToDatabase,
  writeWorkspaceToDatabase,
  updateProjectInDatabase,
} from "./database.mjs";

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_AI_TIMEOUT_MS = 70_000;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_MAX = 80;
const rateBuckets = new Map();
const analyticsWriteQueues = new Map();
const trackedAnalyticsPages = ["landing", "workbench"];
const SESSION_COOKIE = "djcytools_session";

function createHttpError(statusCode, message, code = "BAD_REQUEST") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function readRequestBody(req, { maxBytes = DEFAULT_MAX_BODY_BYTES, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let received = 0;
    const timeout = setTimeout(() => {
      reject(createHttpError(408, "请求读取超时，请重试。", "REQUEST_TIMEOUT"));
      req.destroy();
    }, timeoutMs);
    req.on("data", (chunk) => {
      received += chunk.length;
      if (received > maxBytes) {
        clearTimeout(timeout);
        reject(createHttpError(413, "请求体过大，请缩小工作区或使用备份文件导入。", "PAYLOAD_TOO_LARGE"));
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on("end", () => {
      clearTimeout(timeout);
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(createHttpError(400, "请求 JSON 格式不正确。", "INVALID_JSON"));
      }
    });
    req.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function sendJson(res, statusCode, data, headers = {}) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
  res.end(JSON.stringify(data));
}

function parseCookies(cookieHeader = "") {
  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const index = item.indexOf("=");
        if (index === -1) return [item, ""];
        return [decodeURIComponent(item.slice(0, index)), decodeURIComponent(item.slice(index + 1))];
      }),
  );
}

function getSessionToken(req) {
  return parseCookies(req.headers.cookie || "")[SESSION_COOKIE] || "";
}

function setSessionCookie(res, token, expiresAt) {
  const maxAge = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}`);
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

function authPayload(session) {
  return {
    authenticated: true,
    user: session.user,
    team: session.team,
    membership: session.membership,
    expiresAt: session.expiresAt,
  };
}

function sendAuthRequired(res) {
  sendJson(res, 401, { error: "请先登录后再访问工作台接口。", code: "AUTH_REQUIRED" });
}

function ensureRole(res, session, requiredRole) {
  if (canRole(session.membership.role, requiredRole)) return true;
  sendJson(res, 403, { error: "当前角色没有执行该操作的权限。", code: "FORBIDDEN", requiredRole });
  return false;
}

function getClientKey(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "local";
}

function applyRateLimit(req, res, env) {
  const windowMs = Number(env.DJCYTOOLS_RATE_LIMIT_WINDOW_MS || DEFAULT_RATE_LIMIT_WINDOW_MS);
  const maxRequests = Number(env.DJCYTOOLS_RATE_LIMIT_MAX || DEFAULT_RATE_LIMIT_MAX);
  if (!Number.isFinite(windowMs) || !Number.isFinite(maxRequests) || maxRequests <= 0) return false;

  const key = `${getClientKey(req)}:${new URL(req.url || "/", "http://localhost").pathname}`;
  const now = Date.now();
  const bucket = rateBuckets.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + windowMs;
  }
  bucket.count += 1;
  rateBuckets.set(key, bucket);

  res.setHeader("X-RateLimit-Limit", String(maxRequests));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(maxRequests - bucket.count, 0)));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

  if (bucket.count > maxRequests) {
    sendJson(res, 429, {
      error: "请求过于频繁，请稍后重试。",
      code: "RATE_LIMITED",
      retryAfterMs: Math.max(bucket.resetAt - now, 0),
    });
    return true;
  }
  return false;
}

async function readWorkspace(rootDir, env, session) {
  return readWorkspaceFromDatabase(rootDir, env, session);
}

async function writeWorkspace(rootDir, env, session, workspace) {
  return writeWorkspaceToDatabase(rootDir, env, session, workspace);
}

async function appendAiLog(rootDir, logItem, env = {}, session = null) {
  appendAiLogToDatabase(rootDir, env, logItem, session);
}

function createEmptyAnalyticsPage() {
  return {
    pageViews: 0,
    visitorHashes: [],
    lastVisitedAt: null,
  };
}

function createEmptyAnalyticsStore() {
  return {
    version: 1,
    pages: Object.fromEntries(trackedAnalyticsPages.map((page) => [page, createEmptyAnalyticsPage()])),
    visitorHashes: [],
    recentEvents: [],
  };
}

function normalizeHashList(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item) => typeof item === "string" && item.length >= 12))).slice(0, 100_000);
}

function normalizePositiveInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

export function normalizeAnalyticsStore(value) {
  const store = createEmptyAnalyticsStore();
  const sourcePages = value && typeof value === "object" ? value.pages || {} : {};
  for (const page of trackedAnalyticsPages) {
    const source = sourcePages[page] || {};
    store.pages[page] = {
      pageViews: normalizePositiveInteger(source.pageViews),
      visitorHashes: normalizeHashList(source.visitorHashes),
      lastVisitedAt: typeof source.lastVisitedAt === "string" ? source.lastVisitedAt : null,
    };
  }
  store.visitorHashes = normalizeHashList(value?.visitorHashes);
  for (const page of trackedAnalyticsPages) {
    for (const hash of store.pages[page].visitorHashes) {
      if (!store.visitorHashes.includes(hash)) store.visitorHashes.push(hash);
    }
  }
  store.recentEvents = Array.isArray(value?.recentEvents)
    ? value.recentEvents
        .filter((item) => trackedAnalyticsPages.includes(item?.page) && typeof item?.createdAt === "string")
        .map((item) => ({ id: String(item.id || ""), page: item.page, createdAt: item.createdAt }))
        .slice(0, 200)
    : [];
  return store;
}

export function buildAnalyticsSummary(storeValue) {
  const store = normalizeAnalyticsStore(storeValue);
  const pages = Object.fromEntries(
    trackedAnalyticsPages.map((page) => [
      page,
      {
        pageViews: store.pages[page].pageViews,
        uniqueVisitors: store.pages[page].visitorHashes.length,
        lastVisitedAt: store.pages[page].lastVisitedAt,
      },
    ]),
  );
  return {
    totals: {
      pageViews: trackedAnalyticsPages.reduce((sum, page) => sum + pages[page].pageViews, 0),
      uniqueVisitors: store.visitorHashes.length,
    },
    pages,
    recentEvents: store.recentEvents.slice(0, 10),
  };
}

async function recordAnalyticsEventNow(rootDir, event, env = {}) {
  return recordAnalyticsEventToDatabase(rootDir, env, event);
}

export async function recordAnalyticsEvent(rootDir, event, env = {}) {
  const queueKey = path.resolve(rootDir);
  const previous = analyticsWriteQueues.get(queueKey) || Promise.resolve();
  const next = previous.catch(() => {}).then(() => recordAnalyticsEventNow(rootDir, event, env));
  analyticsWriteQueues.set(queueKey, next);
  try {
    return await next;
  } finally {
    if (analyticsWriteQueues.get(queueKey) === next) analyticsWriteQueues.delete(queueKey);
  }
}

async function readAnalyticsSummary(rootDir, env = {}) {
  return readAnalyticsSummaryFromDatabase(rootDir, env);
}

function estimateCost(usage = {}) {
  const inputTokens = Number(usage.prompt_tokens || 0);
  const outputTokens = Number(usage.completion_tokens || 0);
  // Development estimate only. Keep the rate table configurable in a real billing module.
  const inputRatePerMillion = 0.28;
  const outputRatePerMillion = 0.42;
  return Number(((inputTokens / 1_000_000) * inputRatePerMillion + (outputTokens / 1_000_000) * outputRatePerMillion).toFixed(6));
}

function buildPrompt({ brief, params, template, market, instruction, currentVersion }) {
  const rewriteLines = instruction
    ? [
        "这是一次基于现有版本的定向改写，不是从零生成。",
        `改写指令：${instruction}`,
        "请保留原项目的核心人物关系和主线，只强化指令要求的部分，并输出完整 JSON。",
        `当前版本：${JSON.stringify(currentVersion || {})}`,
      ]
    : ["这是一次新项目生成，请从 brief 和模板出发生成完整初版。"];

  return [
    "请基于以下输入生成一个出海短剧项目，必须输出严格 JSON，不要输出 Markdown。",
    "所有字段内容必须使用简体中文，即使目标市场是海外，也只做剧情和文化适配，不要把正文翻译成英文、西语、日语或其他语言。",
    "JSON 字段：titleCandidates(string[]), selectedTitle(string), logline(string), sellingPoints(string[]), characters(array), outline(array), episodes(array), adHooks(string[])。",
    "characters 每项字段：role,name,archetype,motive,secret。",
    "outline 每项字段：stage,summary。",
    "episodes 只生成前 3 集，每项字段：number,title,hook,beat,script,dialogue(string[])。",
    "内容要求：短剧节奏、前 10 秒钩子、30 秒冲突、90 秒留悬念；避免违法、仇恨、未成年人伤害和露骨暴力。",
    "输出语言：简体中文。",
    ...rewriteLines,
    `目标市场：${market?.label || brief?.market}`,
    `市场策略：${market?.pacing || ""}`,
    `模板：${template?.name || brief?.templateId}`,
    `模板主线：${template?.beat || ""}`,
    `情绪痛点：${brief?.painPoint || ""}`,
    `目标观众：${brief?.audience || ""}`,
    `集数：${brief?.episodeCount || 24}`,
    `禁忌内容：${brief?.forbidden || ""}`,
    `参数：${JSON.stringify(params || {})}`,
  ].join("\n");
}

async function handleGenerateScript({ req, res, env, rootDir, session }) {
  const apiKey = env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    sendJson(res, 500, { error: "DEEPSEEK_API_KEY is not configured", code: "AI_KEY_MISSING" });
    return true;
  }

  const startedAt = Date.now();
  const body = await readRequestBody(req, {
    maxBytes: Number(env.DJCYTOOLS_MAX_BODY_BYTES || DEFAULT_MAX_BODY_BYTES),
    timeoutMs: Number(env.DJCYTOOLS_REQUEST_TIMEOUT_MS || DEFAULT_REQUEST_TIMEOUT_MS),
  });
  const prompt = buildPrompt(body);
  const model = env.DEEPSEEK_MODEL || "deepseek-v4-flash";
  const requestId = `ai_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const controller = new AbortController();
  const timeoutMs = Number(env.DEEPSEEK_TIMEOUT_MS || DEFAULT_AI_TIMEOUT_MS);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${env.DEEPSEEK_BASE_URL || "https://api.deepseek.com"}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.82,
        max_tokens: 3600,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "你是短剧出海内容工厂的资深编剧和投流脚本策划，擅长把市场情绪、爆款模板和剧集结构转成可拍摄脚本。无论目标市场是什么，最终输出都必须是简体中文 JSON。",
          },
          { role: "user", content: prompt },
        ],
      }),
    });
    clearTimeout(timeout);

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      await appendAiLog(rootDir, {
        id: requestId,
        status: "error",
        model,
        instruction: body.instruction || "generate",
        error: data?.error?.message || "DeepSeek request failed",
        durationMs: Date.now() - startedAt,
        createdAt: new Date().toISOString(),
      }, env, session);
      sendJson(res, response.status, {
        error: data?.error?.message || "DeepSeek request failed",
        code: "AI_PROVIDER_ERROR",
        requestId,
        detail: data,
      });
      return true;
    }

    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      sendJson(res, 502, { error: "DeepSeek returned empty content", code: "AI_EMPTY_CONTENT", requestId, detail: data });
      return true;
    }

    let parsedContent;
    try {
      parsedContent = JSON.parse(content);
    } catch {
      await appendAiLog(rootDir, {
        id: requestId,
        status: "error",
        model: data.model || model,
        instruction: body.instruction || "generate",
        error: "DeepSeek returned non-JSON content",
        durationMs: Date.now() - startedAt,
        createdAt: new Date().toISOString(),
      }, env, session);
      sendJson(res, 502, {
        error: "DeepSeek 返回内容不是合法 JSON，已触发前端本地兜底。",
        code: "AI_INVALID_JSON",
        requestId,
      });
      return true;
    }

    const usage = data.usage || {};
    const costUsd = estimateCost(usage);
    await appendAiLog(rootDir, {
      id: requestId,
      status: "success",
      model: data.model || model,
      instruction: body.instruction || "generate",
      market: body.market?.label || body.brief?.market,
      template: body.template?.name || body.brief?.templateId,
      usage,
      costUsd,
      durationMs: Date.now() - startedAt,
      createdAt: new Date().toISOString(),
    }, env, session);

    sendJson(res, 200, {
      requestId,
      content: parsedContent,
      usage,
      model: data.model,
      costUsd,
    });
    return true;
  } catch (error) {
    clearTimeout(timeout);
    await appendAiLog(rootDir, {
      id: requestId,
      status: "error",
      model,
      instruction: body.instruction || "generate",
      error: error instanceof Error ? error.message : "Unknown DeepSeek API error",
      durationMs: Date.now() - startedAt,
      createdAt: new Date().toISOString(),
    }, env, session);
    const isAbort = error?.name === "AbortError";
    sendJson(res, isAbort ? 504 : 500, {
      error: isAbort ? "DeepSeek 请求超时，请稍后重试。" : error instanceof Error ? error.message : "Unknown DeepSeek API error",
      code: isAbort ? "AI_TIMEOUT" : "AI_REQUEST_FAILED",
      requestId,
    });
    return true;
  }
}

export async function handleApiRequest({ req, res, env, rootDir = process.cwd() }) {
  const url = new URL(req.url || "/", "http://localhost");
  const pathname = url.pathname;
  const maxBytes = Number(env.DJCYTOOLS_MAX_BODY_BYTES || DEFAULT_MAX_BODY_BYTES);
  const requestTimeoutMs = Number(env.DJCYTOOLS_REQUEST_TIMEOUT_MS || DEFAULT_REQUEST_TIMEOUT_MS);

  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method || "") && applyRateLimit(req, res, env)) {
    return true;
  }

  if (pathname === "/api/health" && req.method === "GET") {
    sendJson(res, 200, {
      ok: true,
      time: new Date().toISOString(),
      aiConfigured: Boolean(env.DEEPSEEK_API_KEY),
      model: env.DEEPSEEK_MODEL || "deepseek-v4-flash",
      storage: "sqlite",
    });
    return true;
  }

  if (pathname === "/api/auth/session" && req.method === "GET") {
    const session = readSession(rootDir, env, getSessionToken(req));
    sendJson(res, 200, session ? authPayload(session) : { authenticated: false });
    return true;
  }

  if (pathname === "/api/auth/login" && req.method === "POST") {
    const body = await readRequestBody(req, { maxBytes: Math.min(maxBytes, 16 * 1024), timeoutMs: requestTimeoutMs });
    const session = createSession(rootDir, env, body.email, body.password);
    setSessionCookie(res, session.token, session.expiresAt);
    sendJson(res, 200, authPayload(session));
    return true;
  }

  if (pathname === "/api/auth/register" && req.method === "POST") {
    const body = await readRequestBody(req, { maxBytes: Math.min(maxBytes, 16 * 1024), timeoutMs: requestTimeoutMs });
    const session = registerUser(rootDir, env, {
      email: body.email,
      password: body.password,
      name: body.name,
      teamName: body.teamName,
    });
    setSessionCookie(res, session.token, session.expiresAt);
    sendJson(res, 201, authPayload(session));
    return true;
  }

  if (pathname === "/api/auth/logout" && req.method === "POST") {
    destroySession(rootDir, env, getSessionToken(req));
    clearSessionCookie(res);
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (pathname === "/api/analytics/event" && req.method === "POST") {
    const body = await readRequestBody(req, { maxBytes: Math.min(maxBytes, 16 * 1024), timeoutMs: requestTimeoutMs });
    const summary = await recordAnalyticsEvent(rootDir, {
      page: body.page,
      visitorId: body.visitorId,
    }, env);
    sendJson(res, 200, { ok: true, summary });
    return true;
  }

  const session = readSession(rootDir, env, getSessionToken(req));
  if (!session) {
    sendAuthRequired(res);
    return true;
  }

  if (pathname === "/api/workspace" && req.method === "GET") {
    if (!ensureRole(res, session, "viewer")) return true;
    sendJson(res, 200, { workspace: await readWorkspace(rootDir, env, session) });
    return true;
  }

  if (pathname === "/api/workspace" && (req.method === "PUT" || req.method === "POST")) {
    if (!ensureRole(res, session, "editor")) return true;
    const body = await readRequestBody(req, { maxBytes, timeoutMs: requestTimeoutMs });
    const workspace = body.workspace || body;
    await writeWorkspace(rootDir, env, session, workspace);
    sendJson(res, 200, { ok: true, savedAt: new Date().toISOString() });
    return true;
  }

  if (pathname === "/api/projects" && req.method === "GET") {
    if (!ensureRole(res, session, "viewer")) return true;
    sendJson(res, 200, { projects: listProjectsFromDatabase(rootDir, env, session) });
    return true;
  }

  if (pathname === "/api/projects" && req.method === "POST") {
    if (!ensureRole(res, session, "editor")) return true;
    const body = await readRequestBody(req, { maxBytes, timeoutMs: requestTimeoutMs });
    const project = createProjectInDatabase(rootDir, env, session, body.project || body);
    sendJson(res, 201, { project, savedAt: new Date().toISOString() });
    return true;
  }

  const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (projectMatch && req.method === "GET") {
    if (!ensureRole(res, session, "viewer")) return true;
    sendJson(res, 200, { project: getProjectFromDatabase(rootDir, env, session, decodeURIComponent(projectMatch[1])) });
    return true;
  }

  if (projectMatch && req.method === "PATCH") {
    if (!ensureRole(res, session, "editor")) return true;
    const body = await readRequestBody(req, { maxBytes, timeoutMs: requestTimeoutMs });
    const project = updateProjectInDatabase(rootDir, env, session, decodeURIComponent(projectMatch[1]), body);
    sendJson(res, 200, { project, savedAt: new Date().toISOString() });
    return true;
  }

  if (projectMatch && req.method === "DELETE") {
    if (!ensureRole(res, session, "editor")) return true;
    const workspace = deleteProjectFromDatabase(rootDir, env, session, decodeURIComponent(projectMatch[1]));
    sendJson(res, 200, { ok: true, workspace, savedAt: new Date().toISOString() });
    return true;
  }

  if (pathname === "/api/ai-logs" && req.method === "GET") {
    if (!ensureRole(res, session, "viewer")) return true;
    sendJson(res, 200, readAiLogsFromDatabase(rootDir, env, session));
    return true;
  }

  if (pathname === "/api/analytics/summary" && req.method === "GET") {
    if (!ensureRole(res, session, "viewer")) return true;
    sendJson(res, 200, await readAnalyticsSummary(rootDir, env));
    return true;
  }

  if (pathname === "/api/generate-script" && req.method === "POST") {
    if (!ensureRole(res, session, "editor")) return true;
    return handleGenerateScript({ req, res, env, rootDir, session });
  }

  return false;
}

export function loadDotEnv(rootDir = process.cwd()) {
  return readFile(path.join(rootDir, ".env"), "utf8")
    .then((raw) => {
      const parsed = {};
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const index = trimmed.indexOf("=");
        if (index === -1) continue;
        parsed[trimmed.slice(0, index)] = trimmed.slice(index + 1);
      }
      return { ...parsed, ...process.env };
    })
    .catch(() => ({ ...process.env }));
}
