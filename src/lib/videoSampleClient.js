import { createVideoSample, normalizeVideoSamplePayload } from "./videoSample.js";

async function callGenerateVideoSample(payload) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetch("/api/generate-video-sample", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const code = data.code ? `（${data.code}）` : "";
      const requestId = data.requestId ? ` 请求ID：${data.requestId}` : "";
      throw new Error(`${data.error || "Doubao-Seed-2.0 生成视频样片失败"}${code}${requestId}`);
    }
    return data;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Doubao-Seed-2.0 视频样片请求超时，已切换到本地镜头包兜底");
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function generateVideoSampleWithDoubao({ project, version }) {
  const fallback = createVideoSample({ project, version });
  const data = await callGenerateVideoSample({
    project,
    version,
    draftSample: fallback,
  });

  return normalizeVideoSamplePayload({
    project,
    version,
    payload: data.content || {},
    fallback,
    meta: {
      provider: data.provider || "Doubao-Seed-2.0",
      model: data.model,
      requestId: data.requestId,
      costUsd: data.costUsd,
    },
  });
}
