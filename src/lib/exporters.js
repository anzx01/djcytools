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

export function buildProjectText(project, version) {
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
  ];
  return lines.join("\n");
}

export function exportText(project, version) {
  download(`${project.name}-${version.name}.txt`, buildProjectText(project, version), "text/plain;charset=utf-8");
}

export function exportJson(project, version) {
  download(
    `${project.name}-${version.name}.json`,
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
    `${project.name}-${version.name}.doc`,
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
