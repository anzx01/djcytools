import crypto from "node:crypto";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  appendAiLogToDatabase,
  appendCampaignResultFromPublicApi,
  acceptTeamInvite,
  appendAuditLogToDatabase,
  canRole,
  changePassword,
  createPublicApiToken,
  createTrendSnapshotInDatabase,
  createTeamInvite,
  createProjectInDatabase,
  createSession,
  deleteProjectFromDatabase,
  destroySession,
  exportPostgresMigrationSql,
  getProjectFromDatabase,
  listPublicApiTokens,
  listTeamInvites,
  listPublicProjects,
  listProjectsFromDatabase,
  readAuditLogsFromDatabase,
  readAiLogsFromDatabase,
  readAnalyticsSummaryFromDatabase,
  readLatestTrendSnapshotFromDatabase,
  readNotificationOutboxEntryFromDatabase,
  readNotificationOutboxFromDatabase,
  readPublicProjectExport,
  readSession,
  readTemplateInsightsFromDatabase,
  readTrendSnapshotsFromDatabase,
  readWorkspaceFromDatabase,
  removeTeamMemberFromDatabase,
  requestPasswordReset,
  registerUser,
  recordAnalyticsEventToDatabase,
  resolvePublicApiToken,
  revokePublicApiToken,
  resetPassword,
  updateNotificationDeliveryStatus,
  updateTeamMemberInDatabase,
  writeWorkspaceToDatabase,
  updateProjectInDatabase,
} from "./database.mjs";
import { lastTrendUpdated, marketNotes, templateSignals, trendTags } from "../src/data/trends.js";

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_SCRIPT_AI_TIMEOUT_MS = 70_000;
const DEFAULT_SCRIPT_AI_MODEL = "deepseek-chat";
const DEFAULT_SCRIPT_AI_PROVIDER = "DeepSeek";
const DEFAULT_SCRIPT_AI_BASE_URL = "https://api.deepseek.com";
const DEFAULT_VIDEO_AI_TIMEOUT_MS = 90_000;
const DEFAULT_VIDEO_SAMPLE_SECONDS = 15;
const SEEDANCE_2_MAX_DURATION_SECONDS = 15;
const DEFAULT_VIDEO_AI_MODEL = "doubao-seed-2-0-mini-260215";
const DEFAULT_VIDEO_AI_PROVIDER = "Doubao-Seed-2.0";
const DEFAULT_VIDEO_AI_RESPONSES_URL = "https://ark.cn-beijing.volces.com/api/v3/responses";
const DEFAULT_VIDEO_AI_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const DEFAULT_REAL_VIDEO_MODEL = "doubao-seedance-2-0-260128";
const DEFAULT_REAL_VIDEO_PROVIDER = "Doubao-Seedance-2.0";
const DEFAULT_REAL_VIDEO_TASKS_URL = "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks";
const DEFAULT_REAL_VIDEO_SYNC_PAGE_SIZE = 30;
const DEFAULT_REAL_VIDEO_SYNC_TIMEOUT_MS = 15_000;
const ARK_MODEL_ACTIVATION_URL = "https://console.volcengine.com/ark/region:ark+cn-beijing/openManagement?LLM=%7B%7D&OpenTokenDrawer=false";
const DEFAULT_NOTIFICATION_TIMEOUT_MS = 10_000;
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

function sendText(res, statusCode, text, headers = {}) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
  res.end(text);
}

function sendBuffer(res, statusCode, buffer, headers = {}) {
  res.statusCode = statusCode;
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Length", buffer.length);
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
  res.end(buffer);
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

function appendAudit(rootDir, env, session, action, detail = {}) {
  appendAuditLogToDatabase(rootDir, env, session, {
    action,
    targetType: detail.targetType || "",
    targetId: detail.targetId || "",
    detail,
  });
}

function getPublicApiToken(req) {
  const auth = req.headers.authorization || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return req.headers["x-djcytools-api-key"] || "";
}

function resolvePublicApiAccess(req, env, rootDir) {
  return resolvePublicApiToken(rootDir, env, getPublicApiToken(req));
}

function sendPublicApiRequired(res) {
  sendJson(res, 401, { error: "第三方 API Token 未配置或不正确。", code: "PUBLIC_API_AUTH_REQUIRED" });
}

function buildTrendSummary(insights = [], snapshot = null) {
  const insightByName = new Map(insights.map((item) => [item.templateName, item]));
  const baseTags = snapshot?.tags?.length ? snapshot.tags : trendTags;
  const baseSignals = snapshot?.templateSignals?.length ? snapshot.templateSignals : templateSignals;
  const baseNotes = snapshot?.marketNotes?.length ? snapshot.marketNotes : marketNotes;
  const enrichedSignals = baseSignals.map((signal) => {
    const insight = insightByName.get(signal.name);
    if (!insight) return signal;
    return {
      ...signal,
      campaigns: insight.campaigns,
      avgRoas: insight.avgRoas,
      avgCtr: insight.avgCtr,
      avgCompletionRate: insight.avgCompletionRate,
      score: Math.min(100, Math.round(signal.score * 0.7 + Math.min(insight.avgRoas * 18, 30))),
    };
  });
  return {
    lastUpdated: new Date().toISOString(),
    sourceUpdatedAt: snapshot?.createdAt || lastTrendUpdated,
    source: snapshot?.source || "static-seed",
    snapshotId: snapshot?.id || "",
    tags: baseTags,
    templateSignals: enrichedSignals,
    marketNotes: baseNotes,
    teamInsights: insights,
  };
}

function buildStorageMigrationPlan(env = {}) {
  const databaseUrl = String(env.DJCYTOOLS_DATABASE_URL || "");
  const target = databaseUrl.startsWith("postgres://") || databaseUrl.startsWith("postgresql://") ? "postgresql" : "sqlite";
  return {
    current: "sqlite",
    target,
    readyForMultiInstance: target === "postgresql",
    tables: [
      "users",
      "teams",
      "team_members",
      "sessions",
      "projects",
      "versions",
      "comments",
      "exports",
      "campaign_results",
      "custom_templates",
      "ai_logs",
      "analytics_events",
      "team_invites",
      "password_reset_tokens",
      "notification_outbox",
      "public_api_tokens",
      "trend_snapshots",
      "audit_logs",
    ],
    steps: [
      "设置 DJCYTOOLS_DATABASE_URL 为 PostgreSQL 连接串。",
      "将 SQLite 中的业务表按主键导出为 JSON/CSV。",
      "在 PostgreSQL 中创建同名表和索引，保持 id 与 created_at 字段不变。",
      "先导入 teams/users/team_members，再导入 projects/versions/comments/exports/campaign_results/custom_templates。",
      "切流前冻结写入，完成增量校验后再开启多实例服务。",
    ],
  };
}

function getNotificationWebhookUrl(env = {}) {
  const value = String(env.DJCYTOOLS_NOTIFICATION_WEBHOOK_URL || "").trim();
  if (!value) return "";
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function redactWebhookUrl(value = "") {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "";
  }
}

function createWebhookHeaders(env, body, timestamp) {
  const headers = {
    "Content-Type": "application/json",
    "X-DJCYTools-Event": "notification.delivery",
    "X-DJCYTools-Timestamp": timestamp,
  };
  const secret = String(env.DJCYTOOLS_NOTIFICATION_WEBHOOK_SECRET || "").trim();
  if (secret) {
    const signature = crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
    headers["X-DJCYTools-Signature"] = `sha256=${signature}`;
  }
  return headers;
}

function summarizeResponseText(text = "") {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 500);
}

async function deliverNotificationWebhook(rootDir, env, session, notificationId) {
  const webhookUrl = getNotificationWebhookUrl(env);
  if (!webhookUrl) {
    throw createHttpError(400, "未配置 DJCYTOOLS_NOTIFICATION_WEBHOOK_URL，无法自动投递通知。", "NOTIFICATION_WEBHOOK_NOT_CONFIGURED");
  }

  const notification = readNotificationOutboxEntryFromDatabase(rootDir, env, session, notificationId);
  if (["sent", "expired"].includes(notification.status)) {
    throw createHttpError(409, "该通知已发送或已失效，不能重复自动投递。", "NOTIFICATION_NOT_DELIVERABLE");
  }

  const timestamp = new Date().toISOString();
  const payload = {
    event: "djcytools.notification",
    sentAt: timestamp,
    team: {
      id: session.team.id,
      name: session.team.name,
    },
    actor: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
    },
    notification: {
      id: notification.id,
      kind: notification.kind,
      recipient: notification.recipient,
      subject: notification.subject,
      body: notification.body,
      targetType: notification.targetType,
      targetId: notification.targetId,
      createdAt: notification.createdAt,
    },
  };
  const body = JSON.stringify(payload);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(env.DJCYTOOLS_NOTIFICATION_TIMEOUT_MS || DEFAULT_NOTIFICATION_TIMEOUT_MS));

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      signal: controller.signal,
      headers: createWebhookHeaders(env, body, timestamp),
      body,
    });
    const responseText = summarizeResponseText(await response.text().catch(() => ""));
    clearTimeout(timeout);
    const updated = updateNotificationDeliveryStatus(rootDir, env, session, notificationId, {
      status: response.ok ? "sent" : "failed",
      channel: "webhook",
      delivery: {
        ok: response.ok,
        httpStatus: response.status,
        webhook: redactWebhookUrl(webhookUrl),
        response: responseText,
      },
    });
    appendAudit(rootDir, env, session, response.ok ? "notification.webhook_delivered" : "notification.webhook_failed", {
      targetType: "notification",
      targetId: notificationId,
      recipient: notification.recipient,
      httpStatus: response.status,
    });
    return { ok: response.ok, notification: updated, httpStatus: response.status, response: responseText };
  } catch (error) {
    clearTimeout(timeout);
    const isAbort = error?.name === "AbortError";
    const updated = updateNotificationDeliveryStatus(rootDir, env, session, notificationId, {
      status: "failed",
      channel: "webhook",
      delivery: {
        ok: false,
        webhook: redactWebhookUrl(webhookUrl),
        error: isAbort ? "Webhook 请求超时" : error instanceof Error ? error.message : "Webhook 请求失败",
      },
    });
    appendAudit(rootDir, env, session, "notification.webhook_failed", {
      targetType: "notification",
      targetId: notificationId,
      recipient: notification.recipient,
      error: isAbort ? "timeout" : error instanceof Error ? error.message : "unknown",
    });
    return {
      ok: false,
      notification: updated,
      error: isAbort ? "Webhook 请求超时" : error instanceof Error ? error.message : "Webhook 请求失败",
    };
  }
}

function buildPublicOpenApiSpec(env = {}) {
  const serverUrl = env.DJCYTOOLS_PUBLIC_API_BASE_URL || "http://127.0.0.1:4173";
  return {
    openapi: "3.1.0",
    info: {
      title: "DJCYTools Public Delivery API",
      version: "0.1.0",
      description: "面向内部制作流程和第三方系统的只读交付接口。",
    },
    servers: [{ url: serverUrl }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
        apiKeyHeader: { type: "apiKey", in: "header", name: "X-DJCYTOOLS-API-KEY" },
      },
    },
    security: [{ bearerAuth: [] }, { apiKeyHeader: [] }],
    paths: {
      "/api/public/health": {
        get: {
          summary: "检查公开交付 API 状态",
          responses: {
            200: { description: "服务可用" },
            401: { description: "Token 未配置或不正确" },
          },
        },
      },
      "/api/public/projects": {
        get: {
          summary: "列出可交付项目摘要",
          responses: {
            200: { description: "项目摘要列表" },
            401: { description: "Token 未配置或不正确" },
          },
        },
      },
      "/api/public/projects/{id}/export": {
        get: {
          summary: "导出单个项目完整 JSON",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            200: { description: "项目、版本、评论、导出、投流和互动体验数据" },
            401: { description: "Token 未配置或不正确" },
            404: { description: "项目不存在" },
          },
        },
      },
      "/api/public/projects/{id}/campaign-results": {
        post: {
          summary: "回写单个项目的投流结果",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    channel: { type: "string" },
                    materialName: { type: "string" },
                    spend: { type: "number" },
                    impressions: { type: "number" },
                    clicks: { type: "number" },
                    completions: { type: "number" },
                    conversions: { type: "number" },
                    revenue: { type: "number" },
                    materialUrl: { type: "string" },
                    note: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: "投流结果已写入项目" },
            401: { description: "Token 未配置或不正确" },
            404: { description: "项目不存在" },
          },
        },
      },
    },
  };
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
  const inputTokens = Number(usage.prompt_tokens || usage.input_tokens || 0);
  const outputTokens = Number(usage.completion_tokens || usage.output_tokens || 0);
  // Development estimate only. Keep the rate table configurable in a real billing module.
  const inputRatePerMillion = 0.28;
  const outputRatePerMillion = 0.42;
  return Number(((inputTokens / 1_000_000) * inputRatePerMillion + (outputTokens / 1_000_000) * outputRatePerMillion).toFixed(6));
}

function getScriptAiProviderConfig(env = {}) {
  const endpoint = env.DJCYTOOLS_SCRIPT_ENDPOINT || env.DEEPSEEK_ENDPOINT || "";
  const genericProvider = String(env.DJCYTOOLS_AI_PROVIDER || "").toLowerCase();
  const allowGenericAiKey = genericProvider.includes("deepseek");
  return {
    apiKey: env.DJCYTOOLS_SCRIPT_API_KEY || env.DEEPSEEK_API_KEY || (allowGenericAiKey ? env.DJCYTOOLS_AI_API_KEY : "") || "",
    baseUrl: env.DJCYTOOLS_SCRIPT_BASE_URL || env.DEEPSEEK_BASE_URL || DEFAULT_SCRIPT_AI_BASE_URL,
    endpoint,
    model: env.DJCYTOOLS_SCRIPT_MODEL || env.DEEPSEEK_MODEL || DEFAULT_SCRIPT_AI_MODEL,
    providerName: env.DJCYTOOLS_SCRIPT_PROVIDER || env.DEEPSEEK_PROVIDER || DEFAULT_SCRIPT_AI_PROVIDER,
    protocol: "chat_completions",
    timeoutMs: Number(env.DJCYTOOLS_SCRIPT_TIMEOUT_MS || env.DEEPSEEK_TIMEOUT_MS || DEFAULT_SCRIPT_AI_TIMEOUT_MS),
  };
}

function getVideoAiProviderConfig(env = {}) {
  const endpoint = env.DJCYTOOLS_VIDEO_ENDPOINT || env.DOUBAO_RESPONSES_URL || env.ARK_RESPONSES_URL || env.DJCYTOOLS_AI_ENDPOINT || "";
  return {
    apiKey: env.DJCYTOOLS_VIDEO_API_KEY || env.DOUBAO_API_KEY || env.ARK_API_KEY || env.DJCYTOOLS_AI_API_KEY || "",
    baseUrl: env.DJCYTOOLS_VIDEO_BASE_URL || env.DOUBAO_BASE_URL || env.ARK_BASE_URL || env.DJCYTOOLS_AI_BASE_URL || DEFAULT_VIDEO_AI_BASE_URL,
    endpoint: endpoint || DEFAULT_VIDEO_AI_RESPONSES_URL,
    model: env.DJCYTOOLS_VIDEO_MODEL || env.DOUBAO_MODEL || env.ARK_MODEL || env.DJCYTOOLS_AI_MODEL || DEFAULT_VIDEO_AI_MODEL,
    providerName: env.DJCYTOOLS_VIDEO_PROVIDER || env.DOUBAO_PROVIDER || env.ARK_PROVIDER || DEFAULT_VIDEO_AI_PROVIDER,
    protocol: "responses",
    timeoutMs: Number(env.DJCYTOOLS_VIDEO_TIMEOUT_MS || env.DOUBAO_TIMEOUT_MS || env.ARK_TIMEOUT_MS || DEFAULT_VIDEO_AI_TIMEOUT_MS),
  };
}

function getRealVideoProviderConfig(env = {}) {
  return {
    apiKey: env.DJCYTOOLS_REAL_VIDEO_API_KEY || env.DJCYTOOLS_VIDEO_API_KEY || env.DOUBAO_API_KEY || env.ARK_API_KEY || env.DJCYTOOLS_AI_API_KEY || "",
    endpoint: env.DJCYTOOLS_REAL_VIDEO_ENDPOINT || env.ARK_VIDEO_TASKS_URL || DEFAULT_REAL_VIDEO_TASKS_URL,
    model: env.DJCYTOOLS_REAL_VIDEO_MODEL || env.SEEDANCE_MODEL || DEFAULT_REAL_VIDEO_MODEL,
    providerName: env.DJCYTOOLS_REAL_VIDEO_PROVIDER || DEFAULT_REAL_VIDEO_PROVIDER,
    timeoutMs: Number(env.DJCYTOOLS_REAL_VIDEO_TIMEOUT_MS || env.DJCYTOOLS_VIDEO_TIMEOUT_MS || DEFAULT_VIDEO_AI_TIMEOUT_MS),
  };
}

function chatCompletionsUrl(config = {}) {
  const endpoint = String(config.endpoint || "").trim();
  if (endpoint) return endpoint;
  const trimmed = String(config.baseUrl || DEFAULT_SCRIPT_AI_BASE_URL).replace(/\/$/, "");
  return trimmed.endsWith("/chat/completions") ? trimmed : `${trimmed}/chat/completions`;
}

function responsesUrl(config = {}) {
  const endpoint = String(config.endpoint || "").trim();
  if (endpoint) return endpoint;
  const base = String(config.baseUrl || DEFAULT_VIDEO_AI_BASE_URL).replace(/\/$/, "");
  return base.endsWith("/responses") ? base : `${base}/responses`;
}

function aiEndpointUrl(config = {}) {
  return config.protocol === "chat_completions" ? chatCompletionsUrl(config) : responsesUrl(config);
}

function buildAiRequestBody(config, prompt) {
  if (config.protocol === "chat_completions") {
    return {
      model: config.model,
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
    };
  }

  return {
    model: config.model,
    temperature: 0.82,
    max_output_tokens: 3600,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              "系统要求：你是短剧出海内容工厂的资深编剧和投流脚本策划，擅长把市场情绪、爆款模板和剧集结构转成可拍摄脚本。",
              "无论目标市场是什么，最终输出都必须是简体中文 JSON，不要输出 Markdown。",
              "",
              prompt,
            ].join("\n"),
          },
        ],
      },
    ],
  };
}

function extractAiText(data = {}) {
  if (typeof data.output_text === "string") return data.output_text;
  const choiceText = data.choices?.[0]?.message?.content;
  if (typeof choiceText === "string") return choiceText;
  const output = Array.isArray(data.output) ? data.output : [];
  for (const item of output) {
    const content = Array.isArray(item.content) ? item.content : [];
    for (const part of content) {
      if (typeof part.text === "string") return part.text;
      if (typeof part.output_text === "string") return part.output_text;
    }
  }
  return "";
}

function parseAiJsonContent(content = "") {
  const text = String(content || "").trim();
  try {
    return JSON.parse(text);
  } catch {
    const withoutFence = text.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
    try {
      return JSON.parse(withoutFence);
    } catch {
      const start = withoutFence.indexOf("{");
      const end = withoutFence.lastIndexOf("}");
      if (start >= 0 && end > start) {
        return JSON.parse(withoutFence.slice(start, end + 1));
      }
      throw new Error("AI content is not valid JSON");
    }
  }
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

function buildVideoSamplePrompt({ project = {}, version = {}, draftSample = {} }) {
  const compactInput = {
    project: {
      id: project.id,
      name: project.name,
      brief: project.brief,
    },
    version: {
      id: version.id,
      name: version.name,
      selectedTitle: version.selectedTitle,
      logline: version.logline,
      marketName: version.marketName,
      templateName: version.templateName,
      characters: version.characters,
      episodes: version.episodes,
      storyboards: version.storyboards,
      adHooks: version.adHooks,
    },
    draftSample: {
      format: draftSample.format,
      targetDuration: draftSample.targetDuration,
      style: draftSample.style,
      voice: draftSample.voice,
      shots: (draftSample.shots || []).slice(0, 14),
    },
  };

  return [
    "你是短剧出海制作团队的视频导演、分镜师和投流素材剪辑策划。",
    `请基于已完成的短剧剧本，生成 ${DEFAULT_VIDEO_SAMPLE_SECONDS} 秒 9:16 竖屏短剧样片镜头包。这里的“生成视频”先输出可交给渲染器/剪辑师执行的结构化制作包，不要输出 Markdown。`,
    "必须只输出严格 JSON，字段：name,status,format,style,voice,targetDuration,duration,logline,shots。",
    "shots 每项字段：position,episodeNumber,episodeTitle,start,end,duration,title,frame,camera,sound,prop,subtitle,voiceover,visualPrompt,assetStatus。",
    `要求：总时长接近 ${DEFAULT_VIDEO_SAMPLE_SECONDS} 秒；每个镜头 3-8 秒；字幕不超过 42 个中文字；visualPrompt 用英文描述竖屏短剧画面，包含人物、场景、镜头、光线和 mobile-first framing；assetStatus 固定为 prompt_ready。`,
    "风格：高密度、可拍、强钩子、前 5 秒有冲突，避免违法、仇恨、露骨暴力和未成年人伤害。",
    `输入：${JSON.stringify(compactInput)}`,
  ].join("\n");
}

function buildVideoSampleRequestBody(config, prompt) {
  return {
    model: config.model,
    temperature: 0.72,
    max_output_tokens: 4200,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: prompt,
          },
        ],
      },
    ],
  };
}

function clampVideoDuration(value) {
  return SEEDANCE_2_MAX_DURATION_SECONDS;
}

function normalizeRatio(value, fallback = "9:16") {
  const ratio = String(value || fallback).trim();
  return ["9:16", "16:9", "1:1", "4:3", "3:4", "21:9"].includes(ratio) ? ratio : fallback;
}

function cleanUrl(value = "") {
  const url = String(value || "").trim();
  if (!url) return "";
  return /^https?:\/\//i.test(url) ? url : "";
}

function compactText(value = "", limit = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function pickEpisodeForShot(version = {}, shot = {}) {
  const episodes = Array.isArray(version.episodes) ? version.episodes : [];
  if (!episodes.length) return {};
  const episodeNumber = Number(shot.episodeNumber || shot.episode || 1);
  return episodes.find((item) => Number(item.number) === episodeNumber) || episodes[0] || {};
}

function buildCharacterLine(version = {}) {
  const characters = Array.isArray(version.characters) ? version.characters : [];
  return characters
    .slice(0, 4)
    .map((item) => [item.role, item.name, item.archetype, item.motive].filter(Boolean).join(" / "))
    .filter(Boolean)
    .join("；");
}

function buildDialogueLine(episode = {}, shot = {}) {
  const dialogue = Array.isArray(episode.dialogue) ? episode.dialogue : [];
  return [
    shot.voiceover,
    shot.subtitle,
    ...dialogue.slice(0, 4),
  ]
    .map((item) => compactText(item, 90))
    .filter(Boolean)
    .join("；");
}

function buildShotPlanLine(sample = {}, selectedShot = {}) {
  const shots = Array.isArray(sample.shots) && sample.shots.length ? sample.shots : [selectedShot];
  return shots
    .slice(0, 4)
    .map((shot, index) => {
      const start = Number.isFinite(Number(shot.start)) ? Math.round(Number(shot.start)) : index * Math.round(Number(shot.duration || 5));
      const end = Number.isFinite(Number(shot.end)) ? Math.round(Number(shot.end)) : start + Math.round(Number(shot.duration || 5));
      const frame = compactText(shot.frame || shot.title || shot.visualPrompt, 70);
      const line = compactText(shot.subtitle || shot.voiceover || shot.sound, 45);
      const prop = compactText(shot.prop, 30);
      return `${start}-${end}秒：${[frame, line ? `台词/字幕：${line}` : "", prop ? `道具：${prop}` : ""].filter(Boolean).join("；")}`;
    })
    .filter(Boolean)
    .join("；");
}

function buildRealVideoPrompt({ project = {}, version = {}, sample = {}, shot = {}, duration = SEEDANCE_2_MAX_DURATION_SECONDS, ratio = "9:16", generateAudio = true }) {
  const episode = pickEpisodeForShot(version, shot);
  const characterLine = buildCharacterLine(version);
  const dialogueLine = buildDialogueLine(episode, shot);
  const shotPlanLine = buildShotPlanLine(sample, shot);
  const title = version.selectedTitle || version.name || project.name || sample.name || "短剧片段";
  const textParts = [
    `请严格根据以下短剧剧本生成 ${duration} 秒真实短剧视频，不要生成广告、果茶、产品宣传或任何与剧本无关的内容。`,
    `视频比例：${ratio}；风格：${sample.style || "写实短剧，电影感光线，强情绪冲突，移动端优先构图"}。`,
    `剧名：${compactText(title, 80)}。`,
    version.logline ? `一句话梗概：${compactText(version.logline, 100)}。` : "",
    characterLine ? `主要人物：${characterLine}。` : "",
    episode.title || episode.hook || episode.script
      ? `当前分集：第 ${episode.number || shot.episodeNumber || 1} 集《${episode.title || ""}》。钩子：${compactText(episode.hook, 80)}。剧情：${compactText(episode.script || episode.beat, 130)}。`
      : "",
    shotPlanLine ? `${duration}秒镜头脚本：${shotPlanLine}。` : "",
    shot.frame ? `本镜头画面：${compactText(shot.frame, 90)}。` : "",
    shot.camera ? `镜头调度：${compactText(shot.camera, 70)}。` : "",
    shot.prop ? `关键道具：${compactText(shot.prop, 50)}。` : "",
    dialogueLine ? `必须优先保留的台词/字幕：${dialogueLine}。` : "",
    shot.visualPrompt ? `视觉提示：${compactText(shot.visualPrompt, 140)}。` : "",
    "要求：人物关系、冲突和场景必须服务于上述剧本；开头 3 秒给出明确冲突；表演真实克制；不要出现血腥、露骨暴力、未成年人伤害、违法引导。",
    generateAudio ? "生成与画面同步的人声、环境声和短剧氛围音乐；对白需贴合上述台词。" : "生成无声视频。",
  ];
  return textParts.filter(Boolean).join(", ");
}

function buildReferenceContent(references = {}) {
  const content = [];
  const imageUrls = (Array.isArray(references.imageUrls) ? references.imageUrls : [references.firstFrameImageUrl, references.endFrameImageUrl])
    .map(cleanUrl)
    .filter(Boolean)
    .slice(0, 4);
  const videoUrl = cleanUrl(references.videoUrl);
  const audioUrl = cleanUrl(references.audioUrl);
  const usesReferenceMedia = Boolean(videoUrl || audioUrl);
  imageUrls
    .forEach((url, index) => {
      content.push({
        type: "image_url",
        image_url: { url },
        role: usesReferenceMedia ? "reference_image" : imageUrls.length > 1 && index === 1 ? "last_frame" : "first_frame",
      });
    });

  if (videoUrl) {
    content.push({
      type: "video_url",
      video_url: { url: videoUrl },
      role: "reference_video",
    });
  }

  if (audioUrl && (imageUrls.length || videoUrl)) {
    content.push({
      type: "audio_url",
      audio_url: { url: audioUrl },
      role: "reference_audio",
    });
  }

  return content;
}

function buildRealVideoTaskBody(config, body = {}) {
  const shot = body.shot || body.sample?.shots?.[0] || {};
  const duration = clampVideoDuration(body.duration || shot.duration || 5);
  const ratio = normalizeRatio(body.ratio, body.sample?.format || "9:16");
  const generateAudio = body.generateAudio ?? body.generate_audio ?? true;
  if (Array.isArray(body.content) && body.content.length) {
    return {
      model: config.model,
      content: body.content,
      generate_audio: generateAudio !== false,
      ratio,
      duration,
      watermark: Boolean(body.watermark || false),
    };
  }
  const prompt = body.prompt || buildRealVideoPrompt({ project: body.project || {}, version: body.version || {}, sample: body.sample || {}, shot, duration, ratio, generateAudio });
  const references = {
    ...(body.references || {}),
    firstFrameImageUrl: body.references?.firstFrameImageUrl || body.firstFrameImageUrl,
    endFrameImageUrl: body.references?.endFrameImageUrl || body.endFrameImageUrl,
    videoUrl: body.references?.videoUrl || body.referenceVideoUrl,
    audioUrl: body.references?.audioUrl || body.referenceAudioUrl,
  };
  return {
    model: config.model,
    content: [
      {
        type: "text",
        text: prompt,
      },
      ...buildReferenceContent(references),
    ],
    generate_audio: generateAudio !== false,
    ratio,
    resolution: body.resolution || "720p",
    duration,
    watermark: Boolean(body.watermark || false),
  };
}

function findVideoUrl(value) {
  if (!value || typeof value !== "object") return "";
  if (typeof value.video_url === "string") return value.video_url;
  if (typeof value.videoUrl === "string") return value.videoUrl;
  if (typeof value.url === "string" && /\.(mp4|mov|webm)(\?|$)/i.test(value.url)) return value.url;
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = findVideoUrl(item);
      if (url) return url;
    }
    return "";
  }
  for (const item of Object.values(value)) {
    const url = findVideoUrl(item);
    if (url) return url;
  }
  return "";
}

function findRealVideoError(value) {
  if (!value || typeof value !== "object") return "";
  const providerError = value.error || value.last_error || value.failure_reason || value.failed_reason;
  if (typeof providerError === "string") return providerError;
  if (providerError && typeof providerError === "object") {
    return [providerError.code, providerError.message || providerError.msg || providerError.reason].filter(Boolean).join(": ");
  }
  if (typeof value.message === "string" && String(value.status || "").toLowerCase() === "failed") return value.message;
  return "";
}

function findRealVideoErrorCode(value) {
  if (!value || typeof value !== "object") return "";
  const providerError = value.error || value.last_error || value.failure_reason || value.failed_reason;
  if (providerError && typeof providerError === "object") return providerError.code || "";
  return "";
}

function realVideoErrorHint(errorCode = "", error = "") {
  const code = String(errorCode || "");
  const message = String(error || "");
  if (code === "SetLimitExceeded" || /Safe Experience Mode|set inference limit/i.test(message)) {
    return {
      message:
        "火山方舟账号已触发 doubao-seedance-2-0 的推理额度或安全体验模式限制，模型服务暂停。请到模型开通页调整或关闭 Safe Experience Mode，并确认账户余额不少于 200 元或已购买资源包。",
      url: ARK_MODEL_ACTIVATION_URL,
    };
  }
  return null;
}

function normalizeRealVideoTask(data = {}) {
  const task = data.data || data.task || data;
  const id = task.id || task.task_id || task.taskId || data.id || data.task_id || data.taskId || "";
  const status = task.status || task.state || data.status || data.state || "submitted";
  const error = findRealVideoError(task) || findRealVideoError(data);
  const errorCode = findRealVideoErrorCode(task) || findRealVideoErrorCode(data);
  const hint = realVideoErrorHint(errorCode, error);
  return {
    id,
    status,
    videoUrl: findVideoUrl(task) || findVideoUrl(data),
    error,
    errorCode,
    errorHint: hint?.message || "",
    errorHelpUrl: hint?.url || "",
    raw: data,
  };
}

function isFinalRealVideoStatus(status = "") {
  return ["succeeded", "success", "completed", "done", "failed", "error", "cancelled", "canceled", "expired"].includes(String(status).toLowerCase());
}

function isSuccessfulRealVideoStatus(status = "") {
  return ["succeeded", "success", "completed", "done"].includes(String(status).toLowerCase());
}

function realVideoTaskUrl(config = {}, taskId = "") {
  const endpoint = String(config.endpoint || DEFAULT_REAL_VIDEO_TASKS_URL).replace(/\/$/, "");
  return taskId ? `${endpoint}/${encodeURIComponent(taskId)}` : endpoint;
}

function realVideoTaskListUrl(config = {}, pageSize = DEFAULT_REAL_VIDEO_SYNC_PAGE_SIZE) {
  const url = new URL(realVideoTaskUrl(config));
  url.searchParams.set("page_num", "1");
  url.searchParams.set("page_size", String(pageSize));
  return url.toString();
}

function generatedVideoApiPath(taskId = "", extension = "mp4") {
  const safeId = String(taskId || "").replace(/[^a-zA-Z0-9_-]/g, "");
  return safeId ? `/api/generated-videos/${safeId}.${extension}` : "";
}

function normalizeRealVideoTaskItems(data = {}) {
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.tasks)) return data.tasks;
  if (Array.isArray(data.data?.items)) return data.data.items;
  if (Array.isArray(data.data?.tasks)) return data.data.tasks;
  if (Array.isArray(data.data)) return data.data;
  return [];
}

async function syncGeneratedVideosFromProvider({ rootDir, env = {}, pageSize = DEFAULT_REAL_VIDEO_SYNC_PAGE_SIZE }) {
  if (String(env.DJCYTOOLS_DISABLE_REAL_VIDEO_SYNC || "").trim() === "1") return { synced: 0, skipped: true };
  const config = getRealVideoProviderConfig(env);
  if (!config.apiKey) return { synced: 0, skipped: true };

  const controller = new AbortController();
  const timeoutMs = Number(env.DJCYTOOLS_REAL_VIDEO_SYNC_TIMEOUT_MS || DEFAULT_REAL_VIDEO_SYNC_TIMEOUT_MS);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(realVideoTaskListUrl(config, pageSize), {
      method: "GET",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
    });
    clearTimeout(timeout);
    if (!response.ok) return { synced: 0, skipped: false };
    const data = await response.json().catch(() => ({}));
    let synced = 0;
    for (const rawTask of normalizeRealVideoTaskItems(data)) {
      const task = normalizeRealVideoTask(rawTask);
      if (!task.model && rawTask?.model) task.raw = { ...task.raw, model: rawTask.model };
      const localVideoUrl = await persistGeneratedVideo({ rootDir, task, provider: config.providerName, model: rawTask?.model || config.model });
      if (localVideoUrl) synced += 1;
    }
    return { synced, skipped: false };
  } catch {
    clearTimeout(timeout);
    return { synced: 0, skipped: false };
  }
}

async function listGeneratedVideos({ rootDir }) {
  const dir = path.join(rootDir, "data", "generated-videos");
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const videos = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const taskId = entry.name.replace(/\.json$/i, "").replace(/[^a-zA-Z0-9_-]/g, "");
    if (!taskId) continue;
    try {
      const meta = JSON.parse(await readFile(path.join(dir, entry.name), "utf8"));
      videos.push({
        taskId,
        id: taskId,
        status: meta.status || "",
        provider: meta.provider || "",
        model: meta.model || "",
        localVideoUrl: meta.localVideoUrl || generatedVideoApiPath(taskId),
        sourceVideoUrl: meta.sourceVideoUrl || "",
        duration: meta.duration || SEEDANCE_2_MAX_DURATION_SECONDS,
        ratio: meta.ratio || "",
        resolution: meta.resolution || "",
        downloadedAt: meta.downloadedAt || "",
        title: meta.title || "",
      });
    } catch {
      // Metadata can be rewritten while a task finishes; skip partial files.
    }
  }

  return videos.sort((a, b) => String(b.downloadedAt || b.taskId).localeCompare(String(a.downloadedAt || a.taskId)));
}

async function persistGeneratedVideo({ rootDir, task = {}, provider = "", model = "" }) {
  if (!isSuccessfulRealVideoStatus(task.status) || !task.id || !task.videoUrl) return "";
  const safeId = String(task.id).replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeId) return "";
  const dir = path.join(rootDir, "data", "generated-videos");
  const videoPath = path.join(dir, `${safeId}.mp4`);
  const metaPath = path.join(dir, `${safeId}.json`);
  await mkdir(dir, { recursive: true });
  let existingMeta = {};
  try {
    existingMeta = JSON.parse(await readFile(metaPath, "utf8"));
  } catch {
    existingMeta = {};
  }
  try {
    await access(videoPath);
  } catch {
    const response = await fetch(task.videoUrl);
    if (!response.ok) return "";
    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(videoPath, buffer);
  }
  const raw = task.raw && typeof task.raw === "object" ? task.raw : {};
  await writeFile(metaPath, JSON.stringify({
    taskId: safeId,
    status: task.status,
    provider,
    model,
    localVideoUrl: generatedVideoApiPath(safeId),
    sourceVideoUrl: task.videoUrl,
    downloadedAt: existingMeta.downloadedAt || new Date().toISOString(),
    duration: raw.duration || SEEDANCE_2_MAX_DURATION_SECONDS,
    ratio: raw.ratio || "",
    resolution: raw.resolution || "",
    title: existingMeta.title || raw.title || "",
  }, null, 2), "utf8");
  return generatedVideoApiPath(safeId);
}

async function handleGenerateScript({ req, res, env, rootDir, session }) {
  const aiConfig = getScriptAiProviderConfig(env);
  if (!aiConfig.apiKey) {
    sendJson(res, 500, { error: "DJCYTOOLS_SCRIPT_API_KEY or DEEPSEEK_API_KEY is not configured", code: "AI_KEY_MISSING" });
    return true;
  }

  const startedAt = Date.now();
  const body = await readRequestBody(req, {
    maxBytes: Number(env.DJCYTOOLS_MAX_BODY_BYTES || DEFAULT_MAX_BODY_BYTES),
    timeoutMs: Number(env.DJCYTOOLS_REQUEST_TIMEOUT_MS || DEFAULT_REQUEST_TIMEOUT_MS),
  });
  const prompt = buildPrompt(body);
  const model = aiConfig.model;
  const requestId = `ai_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), aiConfig.timeoutMs);

  try {
    const response = await fetch(aiEndpointUrl(aiConfig), {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${aiConfig.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildAiRequestBody(aiConfig, prompt)),
    });
    clearTimeout(timeout);

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      await appendAiLog(rootDir, {
        id: requestId,
        status: "error",
        model,
        instruction: body.instruction || "generate",
        error: data?.error?.message || `${aiConfig.providerName} request failed`,
        durationMs: Date.now() - startedAt,
        createdAt: new Date().toISOString(),
      }, env, session);
      sendJson(res, response.status, {
        error: data?.error?.message || `${aiConfig.providerName} request failed`,
        code: "AI_PROVIDER_ERROR",
        requestId,
        detail: data,
      });
      return true;
    }

    const content = extractAiText(data);
    if (!content) {
      sendJson(res, 502, { error: `${aiConfig.providerName} returned empty content`, code: "AI_EMPTY_CONTENT", requestId, detail: data });
      return true;
    }

    let parsedContent;
    try {
      parsedContent = parseAiJsonContent(content);
    } catch {
      await appendAiLog(rootDir, {
        id: requestId,
        status: "error",
        model: data.model || model,
        instruction: body.instruction || "generate",
        error: `${aiConfig.providerName} returned non-JSON content`,
        durationMs: Date.now() - startedAt,
        createdAt: new Date().toISOString(),
      }, env, session);
      sendJson(res, 502, {
        error: `${aiConfig.providerName} 返回内容不是合法 JSON，已触发前端本地兜底。`,
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
      model: data.model || model,
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
      error: error instanceof Error ? error.message : `Unknown ${aiConfig.providerName} API error`,
      durationMs: Date.now() - startedAt,
      createdAt: new Date().toISOString(),
    }, env, session);
    const isAbort = error?.name === "AbortError";
    sendJson(res, isAbort ? 504 : 500, {
      error: isAbort ? `${aiConfig.providerName} 请求超时，请稍后重试。` : error instanceof Error ? error.message : `Unknown ${aiConfig.providerName} API error`,
      code: isAbort ? "AI_TIMEOUT" : "AI_REQUEST_FAILED",
      requestId,
    });
    return true;
  }
}

async function handleGenerateVideoSample({ req, res, env, rootDir, session }) {
  const aiConfig = getVideoAiProviderConfig(env);
  if (!aiConfig.apiKey) {
    sendJson(res, 500, { error: "DJCYTOOLS_VIDEO_API_KEY or ARK_API_KEY is not configured", code: "VIDEO_AI_KEY_MISSING" });
    return true;
  }

  const startedAt = Date.now();
  const body = await readRequestBody(req, {
    maxBytes: Number(env.DJCYTOOLS_MAX_BODY_BYTES || DEFAULT_MAX_BODY_BYTES),
    timeoutMs: Number(env.DJCYTOOLS_REQUEST_TIMEOUT_MS || DEFAULT_REQUEST_TIMEOUT_MS),
  });
  const prompt = buildVideoSamplePrompt(body);
  const model = aiConfig.model;
  const requestId = `video_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), aiConfig.timeoutMs);

  try {
    const response = await fetch(aiEndpointUrl(aiConfig), {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${aiConfig.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildVideoSampleRequestBody(aiConfig, prompt)),
    });
    clearTimeout(timeout);

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      await appendAiLog(rootDir, {
        id: requestId,
        status: "error",
        model,
        instruction: "video_sample",
        error: data?.error?.message || `${aiConfig.providerName} video sample request failed`,
        durationMs: Date.now() - startedAt,
        createdAt: new Date().toISOString(),
      }, env, session);
      sendJson(res, response.status, {
        error: data?.error?.message || `${aiConfig.providerName} video sample request failed`,
        code: "VIDEO_AI_PROVIDER_ERROR",
        requestId,
        detail: data,
      });
      return true;
    }

    const content = extractAiText(data);
    if (!content) {
      sendJson(res, 502, { error: `${aiConfig.providerName} returned empty video sample content`, code: "VIDEO_AI_EMPTY_CONTENT", requestId, detail: data });
      return true;
    }

    let parsedContent;
    try {
      parsedContent = parseAiJsonContent(content);
    } catch {
      await appendAiLog(rootDir, {
        id: requestId,
        status: "error",
        model: data.model || model,
        instruction: "video_sample",
        error: `${aiConfig.providerName} returned non-JSON video sample content`,
        durationMs: Date.now() - startedAt,
        createdAt: new Date().toISOString(),
      }, env, session);
      sendJson(res, 502, {
        error: `${aiConfig.providerName} 返回的视频样片不是合法 JSON，已触发前端本地镜头包兜底。`,
        code: "VIDEO_AI_INVALID_JSON",
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
      instruction: "video_sample",
      market: body.version?.marketName || body.project?.brief?.market,
      template: body.version?.templateName || body.project?.brief?.templateId,
      usage,
      costUsd,
      durationMs: Date.now() - startedAt,
      createdAt: new Date().toISOString(),
    }, env, session);

    sendJson(res, 200, {
      requestId,
      content: parsedContent,
      usage,
      model: data.model || model,
      provider: aiConfig.providerName,
      costUsd,
    });
    return true;
  } catch (error) {
    clearTimeout(timeout);
    await appendAiLog(rootDir, {
      id: requestId,
      status: "error",
      model,
      instruction: "video_sample",
      error: error instanceof Error ? error.message : `Unknown ${aiConfig.providerName} video sample API error`,
      durationMs: Date.now() - startedAt,
      createdAt: new Date().toISOString(),
    }, env, session);
    const isAbort = error?.name === "AbortError";
    sendJson(res, isAbort ? 504 : 500, {
      error: isAbort ? `${aiConfig.providerName} 视频样片请求超时，请稍后重试。` : error instanceof Error ? error.message : `Unknown ${aiConfig.providerName} video sample API error`,
      code: isAbort ? "VIDEO_AI_TIMEOUT" : "VIDEO_AI_REQUEST_FAILED",
      requestId,
    });
    return true;
  }
}

async function handleCreateRealVideoTask({ req, res, env, rootDir, session }) {
  const config = getRealVideoProviderConfig(env);
  if (!config.apiKey) {
    sendJson(res, 500, { error: "DJCYTOOLS_REAL_VIDEO_API_KEY or ARK_API_KEY is not configured", code: "REAL_VIDEO_KEY_MISSING" });
    return true;
  }

  const body = await readRequestBody(req, {
    maxBytes: Number(env.DJCYTOOLS_MAX_BODY_BYTES || DEFAULT_MAX_BODY_BYTES),
    timeoutMs: Number(env.DJCYTOOLS_REQUEST_TIMEOUT_MS || DEFAULT_REQUEST_TIMEOUT_MS),
  });
  const requestBody = buildRealVideoTaskBody(config, body);
  const startedAt = Date.now();
  const requestId = `real_video_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(realVideoTaskUrl(config), {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });
    clearTimeout(timeout);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      await appendAiLog(rootDir, {
        id: requestId,
        status: "error",
        model: config.model,
        instruction: "real_video_task",
        error: data?.error?.message || `${config.providerName} real video task failed`,
        durationMs: Date.now() - startedAt,
        createdAt: new Date().toISOString(),
      }, env, session);
      sendJson(res, response.status, {
        error: data?.error?.message || `${config.providerName} real video task failed`,
        code: "REAL_VIDEO_PROVIDER_ERROR",
        requestId,
        detail: data,
      });
      return true;
    }

    const task = normalizeRealVideoTask(data);
    await appendAiLog(rootDir, {
      id: requestId,
      status: "success",
      model: config.model,
      instruction: "real_video_task",
      taskId: task.id,
      providerStatus: task.status,
      promptPreview: compactText(requestBody.content?.[0]?.text || "", 220),
      durationMs: Date.now() - startedAt,
      createdAt: new Date().toISOString(),
    }, env, session);
    sendJson(res, 202, {
      requestId,
      provider: config.providerName,
      model: config.model,
      prompt: requestBody.content?.[0]?.text || "",
      task,
    });
    return true;
  } catch (error) {
    clearTimeout(timeout);
    await appendAiLog(rootDir, {
      id: requestId,
      status: "error",
      model: config.model,
      instruction: "real_video_task",
      error: error instanceof Error ? error.message : `Unknown ${config.providerName} real video task error`,
      durationMs: Date.now() - startedAt,
      createdAt: new Date().toISOString(),
    }, env, session);
    sendJson(res, error?.name === "AbortError" ? 504 : 500, {
      error: error?.name === "AbortError" ? `${config.providerName} 视频任务提交超时。` : error instanceof Error ? error.message : "Real video task failed",
      code: error?.name === "AbortError" ? "REAL_VIDEO_TIMEOUT" : "REAL_VIDEO_REQUEST_FAILED",
      requestId,
    });
    return true;
  }
}

async function handleReadRealVideoTask({ req, res, env, rootDir, taskId }) {
  const config = getRealVideoProviderConfig(env);
  if (!config.apiKey) {
    sendJson(res, 500, { error: "DJCYTOOLS_REAL_VIDEO_API_KEY or ARK_API_KEY is not configured", code: "REAL_VIDEO_KEY_MISSING" });
    return true;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(realVideoTaskUrl(config, taskId), {
      method: "GET",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
    });
    clearTimeout(timeout);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      sendJson(res, response.status, {
        error: data?.error?.message || `${config.providerName} video task query failed`,
        code: "REAL_VIDEO_TASK_QUERY_FAILED",
        detail: data,
      });
      return true;
    }
    const task = normalizeRealVideoTask(data);
    const localVideoUrl = await persistGeneratedVideo({ rootDir, task, provider: config.providerName, model: config.model });
    if (localVideoUrl) task.localVideoUrl = localVideoUrl;
    sendJson(res, 200, {
      provider: config.providerName,
      model: config.model,
      task,
    });
    return true;
  } catch (error) {
    clearTimeout(timeout);
    sendJson(res, error?.name === "AbortError" ? 504 : 500, {
      error: error?.name === "AbortError" ? `${config.providerName} 视频任务查询超时。` : error instanceof Error ? error.message : "Real video task query failed",
      code: error?.name === "AbortError" ? "REAL_VIDEO_QUERY_TIMEOUT" : "REAL_VIDEO_QUERY_REQUEST_FAILED",
    });
    return true;
  }
}

async function handleReadGeneratedVideo({ res, rootDir, filename }) {
  const safeName = String(filename || "");
  if (!/^[a-zA-Z0-9_-]+\.(?:mp4|json)$/.test(safeName)) {
    sendJson(res, 400, { error: "Invalid generated video filename", code: "INVALID_GENERATED_VIDEO_FILENAME" });
    return true;
  }
  try {
    const filePath = path.join(rootDir, "data", "generated-videos", safeName);
    const buffer = await readFile(filePath);
    sendBuffer(res, 200, buffer, {
      "Content-Type": safeName.endsWith(".mp4") ? "video/mp4" : "application/json; charset=utf-8",
      "Content-Disposition": `inline; filename="${safeName}"`,
    });
  } catch {
    sendJson(res, 404, { error: "Generated video not found", code: "GENERATED_VIDEO_NOT_FOUND" });
  }
  return true;
}

async function handleListGeneratedVideos({ res, rootDir, env }) {
  const sync = await syncGeneratedVideosFromProvider({ rootDir, env });
  sendJson(res, 200, { videos: await listGeneratedVideos({ rootDir }), sync });
  return true;
}

async function handleListGeneratedVideoShowcase({ res, rootDir, env }) {
  await syncGeneratedVideosFromProvider({ rootDir, env });
  const videos = (await listGeneratedVideos({ rootDir })).map((video) => ({
    taskId: video.taskId,
    id: video.id,
    status: video.status,
    provider: video.provider,
    model: video.model,
    localVideoUrl: generatedVideoApiPath(video.taskId).replace("/api/generated-videos/", "/api/showcase/generated-videos/"),
    duration: video.duration,
    ratio: video.ratio,
    resolution: video.resolution,
    downloadedAt: video.downloadedAt,
    title: video.title,
  }));
  sendJson(res, 200, { videos });
  return true;
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
    const scriptAiConfig = getScriptAiProviderConfig(env);
    const videoAiConfig = getVideoAiProviderConfig(env);
    const realVideoConfig = getRealVideoProviderConfig(env);
    sendJson(res, 200, {
      ok: true,
      time: new Date().toISOString(),
      aiConfigured: Boolean(scriptAiConfig.apiKey),
      publicApiConfigured: Boolean(env.DJCYTOOLS_PUBLIC_API_TOKEN),
      model: scriptAiConfig.model,
      aiProvider: scriptAiConfig.providerName,
      scriptAiConfigured: Boolean(scriptAiConfig.apiKey),
      scriptModel: scriptAiConfig.model,
      scriptAiProvider: scriptAiConfig.providerName,
      videoAiConfigured: Boolean(videoAiConfig.apiKey),
      videoModel: videoAiConfig.model,
      videoAiProvider: videoAiConfig.providerName,
      realVideoConfigured: Boolean(realVideoConfig.apiKey),
      realVideoModel: realVideoConfig.model,
      realVideoProvider: realVideoConfig.providerName,
      storage: "sqlite",
    });
    return true;
  }

  if (pathname === "/api/public/openapi.json" && req.method === "GET") {
    sendJson(res, 200, buildPublicOpenApiSpec(env));
    return true;
  }

  if (pathname === "/api/public/health" && req.method === "GET") {
    const publicAccess = resolvePublicApiAccess(req, env, rootDir);
    if (!publicAccess) {
      sendPublicApiRequired(res);
      return true;
    }
    sendJson(res, 200, {
      ok: true,
      time: new Date().toISOString(),
      service: "djcytools-public-api",
      tokenSource: publicAccess.source,
      formats: ["json"],
    });
    return true;
  }

  if (pathname === "/api/public/projects" && req.method === "GET") {
    const publicAccess = resolvePublicApiAccess(req, env, rootDir);
    if (!publicAccess) {
      sendPublicApiRequired(res);
      return true;
    }
    sendJson(res, 200, { projects: listPublicProjects(rootDir, env, publicAccess.teamId), exportedAt: new Date().toISOString() });
    return true;
  }

  const publicExportMatch = pathname.match(/^\/api\/public\/projects\/([^/]+)\/export$/);
  if (publicExportMatch && req.method === "GET") {
    const publicAccess = resolvePublicApiAccess(req, env, rootDir);
    if (!publicAccess) {
      sendPublicApiRequired(res);
      return true;
    }
    const project = readPublicProjectExport(rootDir, env, decodeURIComponent(publicExportMatch[1]), publicAccess.teamId);
    appendAudit(rootDir, env, null, "public.project.exported", {
      targetType: "project",
      targetId: project.id,
      projectName: project.name,
      tokenSource: publicAccess.source,
    });
    sendJson(res, 200, { project, exportedAt: new Date().toISOString() });
    return true;
  }

  const publicCampaignMatch = pathname.match(/^\/api\/public\/projects\/([^/]+)\/campaign-results$/);
  if (publicCampaignMatch && req.method === "POST") {
    const publicAccess = resolvePublicApiAccess(req, env, rootDir);
    if (!publicAccess) {
      sendPublicApiRequired(res);
      return true;
    }
    const body = await readRequestBody(req, { maxBytes: Math.min(Number(env.DJCYTOOLS_MAX_BODY_BYTES || DEFAULT_MAX_BODY_BYTES), 64 * 1024), timeoutMs: Number(env.DJCYTOOLS_REQUEST_TIMEOUT_MS || DEFAULT_REQUEST_TIMEOUT_MS) });
    const result = appendCampaignResultFromPublicApi(rootDir, env, decodeURIComponent(publicCampaignMatch[1]), body, publicAccess.teamId);
    sendJson(res, 201, { result, savedAt: new Date().toISOString() });
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
    appendAudit(rootDir, env, session, "auth.login", { targetType: "user", targetId: session.user.id });
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
    appendAudit(rootDir, env, session, "auth.register", { targetType: "team", targetId: session.team.id });
    sendJson(res, 201, authPayload(session));
    return true;
  }

  if (pathname === "/api/auth/invite/accept" && req.method === "POST") {
    const body = await readRequestBody(req, { maxBytes: Math.min(maxBytes, 16 * 1024), timeoutMs: requestTimeoutMs });
    const session = acceptTeamInvite(rootDir, env, body);
    setSessionCookie(res, session.token, session.expiresAt);
    sendJson(res, 200, authPayload(session));
    return true;
  }

  if (pathname === "/api/auth/password-reset/request" && req.method === "POST") {
    const body = await readRequestBody(req, { maxBytes: Math.min(maxBytes, 16 * 1024), timeoutMs: requestTimeoutMs });
    const result = requestPasswordReset(rootDir, env, body);
    sendJson(res, 200, result);
    return true;
  }

  if (pathname === "/api/auth/password-reset/confirm" && req.method === "POST") {
    const body = await readRequestBody(req, { maxBytes: Math.min(maxBytes, 16 * 1024), timeoutMs: requestTimeoutMs });
    sendJson(res, 200, resetPassword(rootDir, env, body));
    return true;
  }

  if (pathname === "/api/auth/logout" && req.method === "POST") {
    const session = readSession(rootDir, env, getSessionToken(req));
    destroySession(rootDir, env, getSessionToken(req));
    clearSessionCookie(res);
    if (session) appendAudit(rootDir, env, session, "auth.logout", { targetType: "user", targetId: session.user.id });
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

  if (pathname === "/api/showcase/generated-videos" && req.method === "GET") {
    return handleListGeneratedVideoShowcase({ res, rootDir, env });
  }

  const showcaseVideoMatch = pathname.match(/^\/api\/showcase\/generated-videos\/([a-zA-Z0-9_-]+\.mp4)$/);
  if (showcaseVideoMatch && req.method === "GET") {
    return handleReadGeneratedVideo({ res, rootDir, filename: showcaseVideoMatch[1] });
  }

  const session = readSession(rootDir, env, getSessionToken(req));
  if (!session) {
    sendAuthRequired(res);
    return true;
  }

  if (pathname === "/api/account/password" && req.method === "PATCH") {
    const body = await readRequestBody(req, { maxBytes: Math.min(maxBytes, 16 * 1024), timeoutMs: requestTimeoutMs });
    sendJson(res, 200, changePassword(rootDir, env, session, body, getSessionToken(req)));
    return true;
  }

  if (pathname === "/api/generated-videos" && req.method === "GET") {
    if (!ensureRole(res, session, "viewer")) return true;
    return handleListGeneratedVideos({ res, rootDir, env });
  }

  const generatedVideoMatch = pathname.match(/^\/api\/generated-videos\/([a-zA-Z0-9_-]+\.(?:mp4|json))$/);
  if (generatedVideoMatch && req.method === "GET") {
    if (!ensureRole(res, session, "viewer")) return true;
    return handleReadGeneratedVideo({ res, rootDir, filename: generatedVideoMatch[1] });
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
    appendAudit(rootDir, env, session, "project.created", { targetType: "project", targetId: project.id, name: project.name });
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
    appendAudit(rootDir, env, session, "project.updated", { targetType: "project", targetId: project.id, name: project.name });
    sendJson(res, 200, { project, savedAt: new Date().toISOString() });
    return true;
  }

  if (projectMatch && req.method === "DELETE") {
    if (!ensureRole(res, session, "editor")) return true;
    const projectId = decodeURIComponent(projectMatch[1]);
    const workspace = deleteProjectFromDatabase(rootDir, env, session, projectId);
    appendAudit(rootDir, env, session, "project.deleted", { targetType: "project", targetId: projectId });
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

  if (pathname === "/api/audit-logs" && req.method === "GET") {
    if (!ensureRole(res, session, "owner")) return true;
    sendJson(res, 200, { logs: readAuditLogsFromDatabase(rootDir, env, session) });
    return true;
  }

  if (pathname === "/api/notifications/outbox" && req.method === "GET") {
    if (!ensureRole(res, session, "owner")) return true;
    sendJson(res, 200, {
      notifications: readNotificationOutboxFromDatabase(rootDir, env, session),
      webhookConfigured: Boolean(getNotificationWebhookUrl(env)),
    });
    return true;
  }

  const notificationDeliverMatch = pathname.match(/^\/api\/notifications\/outbox\/([^/]+)\/deliver$/);
  if (notificationDeliverMatch && req.method === "POST") {
    if (!ensureRole(res, session, "owner")) return true;
    const result = await deliverNotificationWebhook(rootDir, env, session, decodeURIComponent(notificationDeliverMatch[1]));
    sendJson(res, 200, result);
    return true;
  }

  const notificationMatch = pathname.match(/^\/api\/notifications\/outbox\/([^/]+)$/);
  if (notificationMatch && req.method === "PATCH") {
    if (!ensureRole(res, session, "owner")) return true;
    const body = await readRequestBody(req, { maxBytes: Math.min(maxBytes, 16 * 1024), timeoutMs: requestTimeoutMs });
    const notification = updateNotificationDeliveryStatus(rootDir, env, session, decodeURIComponent(notificationMatch[1]), body);
    sendJson(res, 200, { notification });
    return true;
  }

  if (pathname === "/api/team/invites" && req.method === "GET") {
    if (!ensureRole(res, session, "owner")) return true;
    sendJson(res, 200, { invites: listTeamInvites(rootDir, env, session) });
    return true;
  }

  if (pathname === "/api/team/invites" && req.method === "POST") {
    if (!ensureRole(res, session, "owner")) return true;
    const body = await readRequestBody(req, { maxBytes: Math.min(maxBytes, 16 * 1024), timeoutMs: requestTimeoutMs });
    const invite = createTeamInvite(rootDir, env, session, body);
    sendJson(res, 201, { invite });
    return true;
  }

  if (pathname === "/api/api-tokens" && req.method === "GET") {
    if (!ensureRole(res, session, "owner")) return true;
    sendJson(res, 200, { tokens: listPublicApiTokens(rootDir, env, session), envTokenConfigured: Boolean(env.DJCYTOOLS_PUBLIC_API_TOKEN) });
    return true;
  }

  if (pathname === "/api/api-tokens" && req.method === "POST") {
    if (!ensureRole(res, session, "owner")) return true;
    const body = await readRequestBody(req, { maxBytes: Math.min(maxBytes, 16 * 1024), timeoutMs: requestTimeoutMs });
    const token = createPublicApiToken(rootDir, env, session, body);
    sendJson(res, 201, { token });
    return true;
  }

  const apiTokenMatch = pathname.match(/^\/api\/api-tokens\/([^/]+)$/);
  if (apiTokenMatch && req.method === "DELETE") {
    if (!ensureRole(res, session, "owner")) return true;
    sendJson(res, 200, revokePublicApiToken(rootDir, env, session, decodeURIComponent(apiTokenMatch[1])));
    return true;
  }

  const teamMemberMatch = pathname.match(/^\/api\/team\/members\/([^/]+)$/);
  if (teamMemberMatch && req.method === "PATCH") {
    if (!ensureRole(res, session, "owner")) return true;
    const body = await readRequestBody(req, { maxBytes: Math.min(maxBytes, 16 * 1024), timeoutMs: requestTimeoutMs });
    const workspace = updateTeamMemberInDatabase(rootDir, env, session, decodeURIComponent(teamMemberMatch[1]), body);
    sendJson(res, 200, { workspace, savedAt: new Date().toISOString() });
    return true;
  }

  if (teamMemberMatch && req.method === "DELETE") {
    if (!ensureRole(res, session, "owner")) return true;
    const workspace = removeTeamMemberFromDatabase(rootDir, env, session, decodeURIComponent(teamMemberMatch[1]));
    sendJson(res, 200, { workspace, savedAt: new Date().toISOString() });
    return true;
  }

  if (pathname === "/api/templates/insights" && req.method === "GET") {
    if (!ensureRole(res, session, "viewer")) return true;
    sendJson(res, 200, { insights: readTemplateInsightsFromDatabase(rootDir, env, session) });
    return true;
  }

  if (pathname === "/api/trends/summary" && req.method === "GET") {
    if (!ensureRole(res, session, "viewer")) return true;
    sendJson(res, 200, buildTrendSummary(readTemplateInsightsFromDatabase(rootDir, env, session), readLatestTrendSnapshotFromDatabase(rootDir, env, session)));
    return true;
  }

  if (pathname === "/api/trends/snapshots" && req.method === "GET") {
    if (!ensureRole(res, session, "viewer")) return true;
    sendJson(res, 200, { snapshots: readTrendSnapshotsFromDatabase(rootDir, env, session) });
    return true;
  }

  if (pathname === "/api/trends/snapshots" && req.method === "POST") {
    if (!ensureRole(res, session, "editor")) return true;
    const body = await readRequestBody(req, { maxBytes: Math.min(maxBytes, 256 * 1024), timeoutMs: requestTimeoutMs });
    const snapshot = createTrendSnapshotInDatabase(rootDir, env, session, body);
    sendJson(res, 201, { snapshot });
    return true;
  }

  if (pathname === "/api/storage/migration-plan" && req.method === "GET") {
    if (!ensureRole(res, session, "owner")) return true;
    sendJson(res, 200, buildStorageMigrationPlan(env));
    return true;
  }

  if (pathname === "/api/storage/postgres-export" && req.method === "GET") {
    if (!ensureRole(res, session, "owner")) return true;
    const sql = exportPostgresMigrationSql(rootDir, env, session);
    appendAudit(rootDir, env, session, "storage.postgres_exported", { targetType: "team", targetId: session.team.id });
    sendText(res, 200, sql, {
      "Content-Disposition": `attachment; filename="djcytools-postgres-${new Date().toISOString().slice(0, 10)}.sql"`,
    });
    return true;
  }

  if (pathname === "/api/generate-script" && req.method === "POST") {
    if (!ensureRole(res, session, "editor")) return true;
    const handled = await handleGenerateScript({ req, res, env, rootDir, session });
    appendAudit(rootDir, env, session, "ai.generate_script", { targetType: "ai_request" });
    return handled;
  }

  if (pathname === "/api/generate-video-sample" && req.method === "POST") {
    if (!ensureRole(res, session, "editor")) return true;
    const handled = await handleGenerateVideoSample({ req, res, env, rootDir, session });
    appendAudit(rootDir, env, session, "ai.generate_video_sample", { targetType: "ai_request" });
    return handled;
  }

  if (pathname === "/api/real-video/tasks" && req.method === "POST") {
    if (!ensureRole(res, session, "editor")) return true;
    const handled = await handleCreateRealVideoTask({ req, res, env, rootDir, session });
    appendAudit(rootDir, env, session, "ai.real_video_task_created", { targetType: "ai_request" });
    return handled;
  }

  const realVideoTaskMatch = pathname.match(/^\/api\/real-video\/tasks\/([^/]+)$/);
  if (realVideoTaskMatch && req.method === "GET") {
    if (!ensureRole(res, session, "viewer")) return true;
    return handleReadRealVideoTask({ req, res, env, rootDir, taskId: decodeURIComponent(realVideoTaskMatch[1]) });
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
