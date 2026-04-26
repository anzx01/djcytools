import { buildRewriteParams, getMarket, getTemplate, normalizeAiVersion } from "./generator.js";

export async function generateVersionWithDeepSeek({ brief, params }) {
  const response = await fetch("/api/generate-script", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      brief,
      params,
      template: getTemplate(brief.templateId),
      market: getMarket(brief.market),
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "DeepSeek 生成失败");
  }

  return normalizeAiVersion({
    brief,
    params,
    payload: data.content || {},
    usage: data.usage,
    model: data.model,
    source: "DeepSeek",
    requestId: data.requestId,
    costUsd: data.costUsd,
  });
}

export async function rewriteVersionWithDeepSeek({ project, activeVersion, instruction }) {
  const nextParams = buildRewriteParams(activeVersion.parameters, instruction);
  const response = await fetch("/api/generate-script", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      brief: project.brief,
      params: nextParams,
      template: getTemplate(project.brief.templateId),
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
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "DeepSeek 改写失败");
  }

  const version = normalizeAiVersion({
    brief: project.brief,
    params: nextParams,
    payload: data.content || {},
    usage: data.usage,
    model: data.model,
    source: "DeepSeek改写",
    requestId: data.requestId,
    costUsd: data.costUsd,
  });
  version.name = `${instruction || "DeepSeek改写"} ${new Date().toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
  return version;
}
