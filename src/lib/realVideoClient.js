async function apiFetch(url, options = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs || 90_000);
  try {
    const response = await fetch(url, { credentials: "same-origin", ...options, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const providerError = data.detail?.error || {};
      const code = data.code || providerError.code || "";
      const message = providerError.message || data.error || "真实视频生成请求失败";
      throw new Error(`${message}${code ? `（${code}）` : ""}`);
    }
    return data;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("真实视频生成请求超时，请稍后查看任务状态");
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function createRealVideoTask({ project, version, sample, shot, duration = 15, ratio = "9:16", generateAudio = true, references = {} }) {
  return apiFetch("/api/real-video/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project, version, sample, shot, duration, ratio, generateAudio, references }),
    timeoutMs: 120_000,
  });
}

export async function fetchRealVideoTask(taskId) {
  return apiFetch(`/api/real-video/tasks/${encodeURIComponent(taskId)}`, {
    timeoutMs: 60_000,
  });
}

export async function fetchGeneratedVideos() {
  return apiFetch("/api/generated-videos", {
    timeoutMs: 30_000,
  });
}

export function isRealVideoTaskDone(status = "") {
  return ["succeeded", "success", "completed", "done"].includes(String(status).toLowerCase());
}

export function isRealVideoTaskFailed(status = "") {
  return ["failed", "error", "cancelled", "canceled", "expired"].includes(String(status).toLowerCase());
}
