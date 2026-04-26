import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createSeedWorkspace } from "../src/lib/workspaceSeed.js";

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function getDataPaths(rootDir) {
  const dataDir = path.join(rootDir, "data");
  return {
    dataDir,
    workspaceFile: path.join(dataDir, "workspace.json"),
    logsFile: path.join(dataDir, "ai-logs.json"),
  };
}

async function readJson(filePath, fallback) {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

async function readWorkspace(rootDir) {
  const { workspaceFile } = getDataPaths(rootDir);
  const workspace = await readJson(workspaceFile, null);
  if (workspace) return workspace;
  const seed = createSeedWorkspace();
  await writeJson(workspaceFile, seed);
  return seed;
}

async function writeWorkspace(rootDir, workspace) {
  const { workspaceFile } = getDataPaths(rootDir);
  await writeJson(workspaceFile, {
    ...workspace,
    savedAt: new Date().toISOString(),
  });
}

async function appendAiLog(rootDir, logItem) {
  const { logsFile } = getDataPaths(rootDir);
  const logs = await readJson(logsFile, []);
  const nextLogs = [logItem, ...logs].slice(0, 300);
  await writeJson(logsFile, nextLogs);
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

async function handleGenerateScript({ req, res, env, rootDir }) {
  const apiKey = env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    sendJson(res, 500, { error: "DEEPSEEK_API_KEY is not configured" });
    return true;
  }

  const startedAt = Date.now();
  const body = await readRequestBody(req);
  const prompt = buildPrompt(body);
  const model = env.DEEPSEEK_MODEL || "deepseek-v4-flash";
  const requestId = `ai_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    const response = await fetch(`${env.DEEPSEEK_BASE_URL || "https://api.deepseek.com"}/chat/completions`, {
      method: "POST",
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

    const data = await response.json();
    if (!response.ok) {
      await appendAiLog(rootDir, {
        id: requestId,
        status: "error",
        model,
        instruction: body.instruction || "generate",
        error: data?.error?.message || "DeepSeek request failed",
        durationMs: Date.now() - startedAt,
        createdAt: new Date().toISOString(),
      });
      sendJson(res, response.status, { error: data?.error?.message || "DeepSeek request failed", detail: data });
      return true;
    }

    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      sendJson(res, 502, { error: "DeepSeek returned empty content", detail: data });
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
    });

    sendJson(res, 200, {
      requestId,
      content: JSON.parse(content),
      usage,
      model: data.model,
      costUsd,
    });
    return true;
  } catch (error) {
    await appendAiLog(rootDir, {
      id: requestId,
      status: "error",
      model,
      instruction: body.instruction || "generate",
      error: error instanceof Error ? error.message : "Unknown DeepSeek API error",
      durationMs: Date.now() - startedAt,
      createdAt: new Date().toISOString(),
    });
    sendJson(res, 500, { error: error instanceof Error ? error.message : "Unknown DeepSeek API error" });
    return true;
  }
}

export async function handleApiRequest({ req, res, env, rootDir = process.cwd() }) {
  const url = new URL(req.url || "/", "http://localhost");
  const pathname = url.pathname;

  if (pathname === "/api/health" && req.method === "GET") {
    sendJson(res, 200, { ok: true, time: new Date().toISOString() });
    return true;
  }

  if (pathname === "/api/workspace" && req.method === "GET") {
    sendJson(res, 200, { workspace: await readWorkspace(rootDir) });
    return true;
  }

  if (pathname === "/api/workspace" && (req.method === "PUT" || req.method === "POST")) {
    const body = await readRequestBody(req);
    const workspace = body.workspace || body;
    await writeWorkspace(rootDir, workspace);
    sendJson(res, 200, { ok: true, savedAt: new Date().toISOString() });
    return true;
  }

  if (pathname === "/api/ai-logs" && req.method === "GET") {
    const { logsFile } = getDataPaths(rootDir);
    const logs = await readJson(logsFile, []);
    const totals = logs.reduce(
      (acc, item) => {
        acc.count += 1;
        acc.success += item.status === "success" ? 1 : 0;
        acc.tokens += Number(item.usage?.total_tokens || 0);
        acc.costUsd += Number(item.costUsd || 0);
        return acc;
      },
      { count: 0, success: 0, tokens: 0, costUsd: 0 },
    );
    sendJson(res, 200, { logs, totals: { ...totals, costUsd: Number(totals.costUsd.toFixed(6)) } });
    return true;
  }

  if (pathname === "/api/generate-script" && req.method === "POST") {
    return handleGenerateScript({ req, res, env, rootDir });
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
