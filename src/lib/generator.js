import { markets, templates } from "../data/templates";

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export function uid(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function getTemplate(templateId) {
  return templates.find((template) => template.id === templateId) || templates[0];
}

export function getMarket(marketId) {
  return markets[marketId] || markets.us;
}

export function mergeParams(template, params = {}) {
  return {
    ...template.defaultParams,
    ...params,
  };
}

export function scoreScript(version) {
  const params = version.parameters;
  const hookScore = clamp(Math.round((params.hookDensity + params.conflict) / 2 + 7), 0, 100);
  const emotionScore = clamp(Math.round((params.humiliation + params.sweet + params.conflict) / 3 + 4), 0, 100);
  const reversalScore = clamp(Math.round(params.reversal + params.hookDensity * 0.12), 0, 100);
  const characterScore = clamp(76 + (version.characters?.length || 0) * 3, 0, 100);
  const localizationScore = clamp(82 - (params.humiliation > 88 ? 6 : 0), 0, 100);
  const productionScore = clamp(Math.round((hookScore + reversalScore + params.conflict) / 3), 0, 100);
  const complianceScore = clamp(91 - (params.humiliation > 85 ? 5 : 0) - (params.conflict > 90 ? 4 : 0), 0, 100);
  const total = Math.round(
    hookScore * 0.2 +
      emotionScore * 0.16 +
      reversalScore * 0.16 +
      characterScore * 0.12 +
      localizationScore * 0.12 +
      productionScore * 0.14 +
      complianceScore * 0.1,
  );

  return {
    total,
    dimensions: [
      { name: "开场钩子", score: hookScore, note: hookScore > 84 ? "前 10 秒具备强事件入口。" : "建议提前给出误会、证据或羞辱事件。" },
      { name: "情绪张力", score: emotionScore, note: emotionScore > 82 ? "情绪落差清晰，适合短节奏推进。" : "痛点可再具体，避免只有概念冲突。" },
      { name: "反转节奏", score: reversalScore, note: reversalScore > 82 ? "反转密度适合前 3 集留存。" : "第 2 集末尾需要更明确的信息翻盘。" },
      { name: "人设清晰", score: characterScore, note: "核心人物关系已成型，拍摄前可继续补动机。" },
      { name: "本地化", score: localizationScore, note: version.marketRisk },
      { name: "投流可剪辑", score: productionScore, note: "可拆出开场羞辱、身份揭露和反击三类素材。" },
      { name: "合规风险", score: complianceScore, note: complianceScore > 86 ? "当前未发现明显高风险设定。" : "建议降低暴力、歧视或极端羞辱表达。" },
    ],
    suggestions: [
      "第 1 集 20 秒内加入可视化证据，例如协议、录音或公开名单。",
      "第 2 集结尾让反派误判主角身份，制造下一集点击理由。",
      "投流版本保留一句可截图传播的短对白，控制在 12 个汉字以内。",
    ],
  };
}

function makeCharacters(template, market) {
  const names = market.names;
  return [
    {
      role: "主角",
      name: names[0],
      archetype: template.lead,
      motive: "夺回被误解和被剥夺的人生选择权。",
      secret: "掌握能改写关系格局的关键证据。",
    },
    {
      role: "对手",
      name: names[1],
      archetype: template.rival,
      motive: "维持现有权力和体面。",
      secret: "其判断建立在一条错误信息上。",
    },
    {
      role: "助推者",
      name: names[2],
      archetype: "知道真相但暂时沉默的人",
      motive: "在利益与良知之间摇摆。",
      secret: "保存了最早的身份或交易记录。",
    },
  ];
}

function makeTitles(template, brief, market) {
  const base = brief.painPoint?.slice(0, 12) || template.category;
  return [
    `离开后，${template.lead}翻盘了`,
    `${template.name}：最后一份协议`,
    `她不是输家`,
    `${market.label}版 ${template.category}实验`,
    `当众羞辱之后`,
    `第七天真相曝光`,
    `被抛弃的人才是答案`,
  ].map((title) => title.replace("情绪", base));
}

function makeEpisodes(template, brief, market, params) {
  const intensity = params.humiliation > 78 ? "当众" : "私下";
  const reversal = params.reversal > 72 ? "立刻埋下反转证据" : "用一个细节暗示反转";

  return [
    {
      number: 1,
      title: "被赶出局",
      hook: template.hook,
      script: `${intensity}场合里，主角被对手否定价值。她没有解释，只拿走一份被忽视的文件。镜头最后，文件上的签名暴露出她才是关键人物。`,
      beat: `10 秒定调：${brief.painPoint || template.premise}。30 秒冲突：对手逼主角认输。90 秒钩子：${reversal}。`,
      dialogue: ["“你们要的体面，我不要了。”", "“等真相出来，你最好还笑得出来。”"],
    },
    {
      number: 2,
      title: "错误的人被相信",
      hook: "对手以为掌控局面，却在关键电话里听到主角的新身份。",
      script: `反派继续扩大误会，助推者试图阻止但失败。主角开始反向收集证据，并第一次使用市场、合同或身份资源进行试探。`,
      beat: "10 秒接上集反转。30 秒升级关系撕裂。结尾让反派发现主角并未离场。",
      dialogue: ["“我不是回来解释的。”", "“我是回来结算的。”"],
    },
    {
      number: 3,
      title: "第一轮清算",
      hook: "会议大屏亮起，所有人第一次看见被隐藏的证据链。",
      script: `公开场景中，主角不再防守，而是让对手自己说出矛盾。第一轮反击成功，但更大的幕后利益关系被牵出。`,
      beat: "开场给证据，中段打脸，结尾抛出更高层对手。",
      dialogue: ["“这一次，我让证据替我说话。”", "“你抢走的，不止一个名字。”"],
    },
  ];
}

function makeOutline(template, episodeCount) {
  const arcs = [
    "1-3 集：建立羞辱、误会和第一处反击。",
    "4-8 集：主角收集证据，对手扩大打压，关系裂缝暴露。",
    "9-14 集：隐藏身份逐步揭开，旧案和利益链浮出水面。",
    "15-20 集：主角主动设局，反派联盟内部互咬。",
    `21-${episodeCount} 集：终局审判、情感选择和新秩序建立。`,
  ];
  return arcs.map((arc, index) => ({
    id: uid("arc"),
    stage: `阶段 ${index + 1}`,
    summary: `${arc} 模板主线：${template.beat}`,
  }));
}

export function generateVersion({ brief, params, source = "AI生成" }) {
  const template = getTemplate(brief.templateId);
  const market = getMarket(brief.market);
  const parameters = mergeParams(template, params);
  const episodeCount = clamp(Number(brief.episodeCount || 24), 12, 40);
  const titleCandidates = makeTitles(template, brief, market);
  const characters = makeCharacters(template, market);
  const version = {
    id: uid("ver"),
    name: `${source} ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`,
    createdAt: new Date().toISOString(),
    source,
    templateId: template.id,
    templateName: template.name,
    marketId: brief.market,
    marketName: market.label,
    marketRisk: market.risk,
    parameters,
    titleCandidates,
    selectedTitle: titleCandidates[0],
    logline: `${template.premise} 目标市场为${market.label}，节奏策略是：${market.pacing}`,
    sellingPoints: [
      `核心情绪：${template.tags.join(" / ")}`,
      `观众抓手：${market.audience}`,
      `前 3 集主线：${template.beat}`,
    ],
    characters,
    outline: makeOutline(template, episodeCount),
    episodes: makeEpisodes(template, brief, market, parameters),
    adHooks: [
      `前 5 秒：${template.hook}`,
      "字幕钩子：他们以为她输了，其实她刚开始算账。",
      "口播钩子：如果你被最亲近的人背叛，会选择解释，还是翻盘？",
    ],
  };
  return {
    ...version,
    score: scoreScript(version),
  };
}

export function createProject({ brief, params }) {
  const version = generateVersion({ brief, params });
  return createProjectFromVersion({ brief, version });
}

export function normalizeAiVersion({ brief, params, payload, usage, model, source = "DeepSeek", requestId, costUsd }) {
  const template = getTemplate(brief.templateId);
  const market = getMarket(brief.market);
  const parameters = mergeParams(template, params);
  const safeArray = (value, fallback = []) => (Array.isArray(value) && value.length ? value : fallback);
  const safeText = (value, fallback = "") => (typeof value === "string" && value.trim() ? value.trim() : fallback);
  const localFallback = generateVersion({ brief, params, source: "本地兜底" });

  const version = {
    id: uid("ver"),
    name: `${source} ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`,
    createdAt: new Date().toISOString(),
    source,
    templateId: template.id,
    templateName: template.name,
    marketId: brief.market,
    marketName: market.label,
    marketRisk: market.risk,
    model,
    usage,
    requestId,
    costUsd,
    parameters,
    titleCandidates: safeArray(payload.titleCandidates, localFallback.titleCandidates).slice(0, 10),
    selectedTitle: safeText(payload.selectedTitle, payload.titleCandidates?.[0] || localFallback.selectedTitle),
    logline: safeText(payload.logline, localFallback.logline),
    sellingPoints: safeArray(payload.sellingPoints, localFallback.sellingPoints),
    characters: safeArray(payload.characters, localFallback.characters).map((item, index) => ({
      role: safeText(item.role, localFallback.characters[index]?.role || "角色"),
      name: safeText(item.name, localFallback.characters[index]?.name || `角色${index + 1}`),
      archetype: safeText(item.archetype, localFallback.characters[index]?.archetype || "短剧功能角色"),
      motive: safeText(item.motive, localFallback.characters[index]?.motive || "推动核心冲突"),
      secret: safeText(item.secret, localFallback.characters[index]?.secret || "持有剧情反转信息"),
    })),
    outline: safeArray(payload.outline, localFallback.outline).map((item, index) => ({
      id: uid("arc"),
      stage: safeText(item.stage, localFallback.outline[index]?.stage || `阶段 ${index + 1}`),
      summary: safeText(item.summary, localFallback.outline[index]?.summary || "推进主线冲突和反转。"),
    })),
    episodes: safeArray(payload.episodes, localFallback.episodes)
      .slice(0, 3)
      .map((item, index) => ({
        number: Number(item.number || index + 1),
        title: safeText(item.title, localFallback.episodes[index]?.title || `第 ${index + 1} 集`),
        hook: safeText(item.hook, localFallback.episodes[index]?.hook || "用强事件制造点击理由。"),
        beat: safeText(item.beat, localFallback.episodes[index]?.beat || "定调、冲突、钩子。"),
        script: safeText(item.script, localFallback.episodes[index]?.script || "本集围绕核心误会和反击推进。"),
        dialogue: safeArray(item.dialogue, localFallback.episodes[index]?.dialogue || ["“真相会自己开口。”"]),
      })),
    adHooks: safeArray(payload.adHooks, localFallback.adHooks),
  };

  return {
    ...version,
    score: scoreScript(version),
  };
}

export function createProjectFromVersion({ brief, version, notice }) {
  return {
    id: uid("proj"),
    name: brief.title || version.selectedTitle,
    status: "草稿",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    brief,
    activeVersionId: version.id,
    versions: [version],
    comments: [
      {
        id: uid("comment"),
        author: "系统",
        text: notice || "初版已生成，可先检查前 3 集钩子和市场适配度。",
        createdAt: new Date().toISOString(),
      },
    ],
    exports: [],
  };
}

export function buildRewriteParams(activeParams, instruction = "") {
  const isConflict = instruction.includes("冲突") || instruction.includes("反击") || instruction.includes("羞辱");
  const isAdHook = instruction.includes("投流") || instruction.includes("钩子") || instruction.includes("点击");
  const isLower = instruction.includes("降低") || instruction.includes("克制") || instruction.includes("合规");
  const isLocalization = instruction.includes("本地化") || instruction.includes("市场") || instruction.includes("文化");

  return {
    ...activeParams,
    conflict: clamp(activeParams.conflict + (isConflict ? 8 : 3), 0, 100),
    hookDensity: clamp(activeParams.hookDensity + (isAdHook ? 10 : 4), 0, 100),
    humiliation: clamp(activeParams.humiliation + (isLower ? -12 : isConflict ? 5 : 2), 0, 100),
    reversal: clamp(activeParams.reversal + (isAdHook ? 4 : 2), 0, 100),
    sweet: clamp(activeParams.sweet + (isLocalization ? 2 : 0), 0, 100),
  };
}

export function rewriteVersion(project, instruction) {
  const active = project.versions.find((version) => version.id === project.activeVersionId) || project.versions[0];
  const nextParams = buildRewriteParams(active.parameters, instruction);
  const next = generateVersion({
    brief: project.brief,
    params: nextParams,
    source: instruction || "段落重写",
  });
  next.name = `${instruction || "重写版本"} ${project.versions.length + 1}`;
  return {
    ...project,
    activeVersionId: next.id,
    updatedAt: new Date().toISOString(),
    versions: [next, ...project.versions],
  };
}
