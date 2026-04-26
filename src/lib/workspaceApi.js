async function apiFetch(url, options = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs || 15_000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data.code ? `${data.error || "请求失败"}（${data.code}）` : data.error || "请求失败";
      throw new Error(detail);
    }
    return data;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("请求超时，请检查本地服务或稍后重试");
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

const VISITOR_ID_KEY = "djcytools.visitorId.v1";
const PAGE_VIEW_DEDUPE_KEY = "djcytools.lastPageView.v1";

function createVisitorId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `visitor_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function getVisitorId() {
  try {
    const existing = window.localStorage.getItem(VISITOR_ID_KEY);
    if (existing) return existing;
    const next = createVisitorId();
    window.localStorage.setItem(VISITOR_ID_KEY, next);
    return next;
  } catch {
    return createVisitorId();
  }
}

function shouldSendPageView(page) {
  try {
    const raw = window.sessionStorage.getItem(PAGE_VIEW_DEDUPE_KEY);
    const last = raw ? JSON.parse(raw) : null;
    const now = Date.now();
    if (last?.page === page && now - Number(last.at || 0) < 1500) return false;
    window.sessionStorage.setItem(PAGE_VIEW_DEDUPE_KEY, JSON.stringify({ page, at: now }));
  } catch {
    return true;
  }
  return true;
}

export async function loadWorkspaceFromServer() {
  const data = await apiFetch("/api/workspace");
  return data.workspace;
}

export async function saveWorkspaceToServer(workspace) {
  return apiFetch("/api/workspace", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace }),
  });
}

export async function fetchAiLogs() {
  return apiFetch("/api/ai-logs");
}

export async function fetchAnalyticsSummary() {
  return apiFetch("/api/analytics/summary");
}

export async function trackPageView(page) {
  if (!shouldSendPageView(page)) return null;
  return apiFetch("/api/analytics/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      page,
      visitorId: getVisitorId(),
    }),
    timeoutMs: 5000,
  });
}
