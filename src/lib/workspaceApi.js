export async function loadWorkspaceFromServer() {
  const response = await fetch("/api/workspace");
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "读取服务端工作区失败");
  }
  return data.workspace;
}

export async function saveWorkspaceToServer(workspace) {
  const response = await fetch("/api/workspace", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "保存服务端工作区失败");
  }
  return data;
}

export async function fetchAiLogs() {
  const response = await fetch("/api/ai-logs");
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "读取 AI 日志失败");
  }
  return data;
}
