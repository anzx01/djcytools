import { buildRewriteParams, getMarket, getTemplate, normalizeAiVersion } from "./generator.js";

async function callGenerateScript(payload) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 180_000);
  try {
    const response = await fetch("/api/generate-script", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const code = data.code ? `（${data.code}）` : "";
      const requestId = data.requestId ? ` 请求ID：${data.requestId}` : "";
      throw new Error(`${data.error || "AI 生成失败"}${code}${requestId}`);
    }
    return data;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("AI 请求超时，已切换到本地兜底生成");
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function generateVersionWithDeepSeek({ brief, params, templateCatalog }) {
  const data = await callGenerateScript({
    brief,
    params,
    template: getTemplate(brief.templateId, templateCatalog),
    market: getMarket(brief.market),
  });

  return normalizeAiVersion({
    brief,
    params,
    payload: data.content || {},
    usage: data.usage,
    model: data.model,
    source: data.fallback ? "服务端兜底" : data.repaired ? "AI修复" : "AI",
    requestId: data.requestId,
    costUsd: data.costUsd,
    templateCatalog,
  });
}

export async function rewriteVersionWithDeepSeek({ project, activeVersion, instruction, templateCatalog }) {
  const nextParams = buildRewriteParams(activeVersion.parameters, instruction);
  const data = await callGenerateScript({
    brief: project.brief,
    params: nextParams,
    template: getTemplate(project.brief.templateId, templateCatalog),
    market: getMarket(project.brief.market),
    instruction,
    currentVersion: {
      selectedTitle: activeVersion.selectedTitle,
      logline: activeVersion.logline,
      characters: activeVersion.characters,
      outline: activeVersion.outline,
      episodes: activeVersion.episodes,
      adHooks: activeVersion.adHooks,
    },
  });

  const version = normalizeAiVersion({
    brief: project.brief,
    params: nextParams,
    payload: data.content || {},
    usage: data.usage,
    model: data.model,
    source: data.fallback ? "服务端兜底改写" : data.repaired ? "AI修复改写" : "AI改写",
    requestId: data.requestId,
    costUsd: data.costUsd,
    templateCatalog,
  });
  version.name = `${instruction || "AI改写"} ${new Date().toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
  return version;
}
