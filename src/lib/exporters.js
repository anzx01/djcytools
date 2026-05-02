function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function downloadTextFile(filename, content, type = "text/plain;charset=utf-8") {
  download(filename, content, type);
}

export function sanitizeFilename(value) {
  return String(value || "djcytools")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "djcytools";
}

export function calculateCampaignMetrics(result = {}) {
  const impressions = Number(result.impressions || 0);
  const clicks = Number(result.clicks || 0);
  const completions = Number(result.completions || 0);
  const conversions = Number(result.conversions || 0);
  const spend = Number(result.spend || 0);
  const revenue = Number(result.revenue || 0);
  return {
    ctr: impressions ? Number(((clicks / impressions) * 100).toFixed(2)) : 0,
    completionRate: impressions ? Number(((completions / impressions) * 100).toFixed(2)) : 0,
    conversionRate: clicks ? Number(((conversions / clicks) * 100).toFixed(2)) : 0,
    cpa: conversions ? Number((spend / conversions).toFixed(2)) : 0,
    roas: spend ? Number((revenue / spend).toFixed(2)) : 0,
  };
}

export function buildProjectText(project, version) {
  const campaignResults = project.campaignResults || [];
  const lines = [
    `项目：${project.name}`,
    `版本：${version.name}`,
    `市场：${version.marketName}`,
    `模板：${version.templateName}`,
    `评分：${version.score.total}`,
    "",
    "一句话卖点",
    version.logline,
    "",
    "候选剧名",
    ...version.titleCandidates.map((title, index) => `${index + 1}. ${title}`),
    "",
    "人物卡",
    ...version.characters.map((item) => `${item.role}｜${item.name}｜${item.archetype}｜动机：${item.motive}｜秘密：${item.secret}`),
    "",
    "故事大纲",
    ...version.outline.map((arc) => `${arc.stage}：${arc.summary}`),
    "",
    "前 3 集脚本",
    ...version.episodes.flatMap((episode) => [
      `第 ${episode.number} 集：${episode.title}`,
      `钩子：${episode.hook}`,
      `结构：${episode.beat}`,
      `脚本：${episode.script}`,
      `对白：${episode.dialogue.join(" / ")}`,
      "",
    ]),
    "投流开场",
    ...version.adHooks,
    "",
    "分镜建议",
    ...((version.storyboards || []).flatMap((board) => [
      `第 ${board.episodeNumber} 集：${board.title}`,
      ...(board.shots || []).map((shot) => `${shot.time}｜画面：${shot.frame}｜镜头：${shot.camera}｜声音：${shot.sound}｜道具：${shot.prop}`),
      "",
    ])),
    "合规与相似度",
    `合规：${version.complianceReport?.level || "未检测"}｜风险分 ${version.complianceReport?.riskScore ?? "-"}`,
    `相似度：${version.similarityReport?.level || "未检测"}｜最高 ${(version.similarityReport?.maxSimilarity || 0) * 100}%`,
    ...((version.complianceReport?.suggestions || []).map((item) => `建议：${item}`)),
    "",
    "互动短剧体验",
    ...((project.interactiveExperiences || []).length
      ? project.interactiveExperiences.slice(0, 3).flatMap((experience) => [
          `${experience.name}｜${experience.persona}｜${experience.mood}`,
          experience.opening,
          ...(experience.choices || []).map((choice) => `${choice.setup}：${choice.options?.map((option) => option.label).join(" / ")}`),
          "",
        ])
      : ["暂无互动体验。"]),
    "",
    "投流结果回流",
    ...(campaignResults.length
      ? campaignResults.map((result) => {
          const metrics = calculateCampaignMetrics(result);
          return `${result.channel || "未命名渠道"}｜${result.materialName || "未命名素材"}｜版本：${result.versionName || result.versionId || "未记录"}｜CTR ${metrics.ctr}%｜完播 ${metrics.completionRate}%｜CPA $${metrics.cpa}｜ROAS ${metrics.roas}｜备注：${result.note || ""}`;
        })
      : ["暂无投流结果。"]),
  ];
  return lines.join("\n");
}

export function exportText(project, version) {
  download(`${sanitizeFilename(project.name)}-${sanitizeFilename(version.name)}.txt`, buildProjectText(project, version), "text/plain;charset=utf-8");
}

export function exportJson(project, version) {
  download(
    `${sanitizeFilename(project.name)}-${sanitizeFilename(version.name)}.json`,
    JSON.stringify({ project, version }, null, 2),
    "application/json;charset=utf-8",
  );
}

export function exportDoc(project, version) {
  const body = buildProjectText(project, version)
    .split("\n")
    .map((line) => `<p>${line.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;") || "&nbsp;"}</p>`)
    .join("");
  download(
    `${sanitizeFilename(project.name)}-${sanitizeFilename(version.name)}.doc`,
    `<!doctype html><html><head><meta charset="utf-8"><title>${project.name}</title></head><body>${body}</body></html>`,
    "application/msword;charset=utf-8",
  );
}

export function printPdf(project, version) {
  const text = buildProjectText(project, version)
    .split("\n")
    .map((line) => `<p>${line.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;") || "&nbsp;"}</p>`)
    .join("");
  const printWindow = window.open("", "_blank", "width=900,height=720");
  if (!printWindow) return;
  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${project.name}</title>
        <style>
          body { font-family: "Noto Sans SC", "Microsoft YaHei", sans-serif; padding: 32px; color: #171717; line-height: 1.65; }
          p { margin: 0 0 8px; }
        </style>
      </head>
      <body>${text}</body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}
