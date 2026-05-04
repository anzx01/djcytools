import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Archive,
  Check,
  ClipboardList,
  Download,
  FileJson,
  FileText,
  Flame,
  KeyRound,
  MailPlus,
  MessageSquare,
  MonitorPlay,
  Plus,
  RefreshCcw,
  Send,
  Store,
  Trash2,
  X,
} from "lucide-react";
import { templates } from "../../data/templates";
import { lastTrendUpdated, marketNotes, templateSignals, trendTags } from "../../data/trends";
import { getTemplate, uid } from "../../lib/generator";
import { createRealVideoTask, fetchGeneratedVideos, fetchRealVideoTask, isRealVideoTaskDone, isRealVideoTaskFailed } from "../../lib/realVideoClient";
import { calculateCampaignMetrics, downloadTextFile, exportDoc, exportJson, exportText, printPdf, sanitizeFilename } from "../../lib/exporters";

const REAL_VIDEO_TEST_DURATION_SECONDS = 15;

function formatDate(value) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function compactWorkbenchText(value = "", limit = 120) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function buildEpisodeRealVideoShot({ episode = {}, index = 0, title = "当前短剧", version = {}, ratio = "9:16" }) {
  const dialogue = Array.isArray(episode.dialogue) ? episode.dialogue.filter(Boolean) : [];
  const frame = compactWorkbenchText(episode.hook || episode.script || version?.logline || title, 120);
  const subtitle = compactWorkbenchText(dialogue[0] || episode.hook || version?.logline || title, 72);
  const episodeNumber = episode.number || index + 1;
  return {
    id: `script-real-video-episode-${episodeNumber}`,
    position: 1,
    episodeNumber,
    episodeTitle: episode.title || title,
    start: index * REAL_VIDEO_TEST_DURATION_SECONDS,
    end: (index + 1) * REAL_VIDEO_TEST_DURATION_SECONDS,
    duration: REAL_VIDEO_TEST_DURATION_SECONDS,
    title: episode.title || "剧本直出真实视频",
    frame,
    camera: "写实竖屏短剧，前 3 秒明确冲突，移动端近景构图",
    sound: "同步人声、环境声和短剧氛围音乐",
    prop: compactWorkbenchText(episode.prop || "", 60),
    subtitle,
    voiceover: compactWorkbenchText(dialogue.join("；"), 120),
    visualPrompt: `${ratio} vertical realistic short drama, episode ${episodeNumber} of "${title}", cinematic mobile framing, clear conflict in first 3 seconds, natural acting, subtitle-safe composition`,
    assetStatus: "script_ready",
  };
}

function buildScriptVideoFallback({ project, version, ratio = "9:16" }) {
  const title = version?.selectedTitle || version?.name || project?.name || "当前短剧";
  const episodes = Array.isArray(version?.episodes) && version.episodes.length ? version.episodes : [{ number: 1, title, hook: version?.logline }];
  const shots = episodes.map((episode, index) => buildEpisodeRealVideoShot({ project, version, episode, index, title, ratio }));
  const firstShot = shots[0] || {};
  return {
    id: "script-real-video-sample",
    name: `${title} 15秒真实视频`,
    source: "当前剧本",
    status: "script_ready",
    format: ratio,
    duration: REAL_VIDEO_TEST_DURATION_SECONDS,
    voice: "同步音频",
    style: "写实竖屏短剧",
    logline: version?.logline || firstShot.frame || title,
    shots,
  };
}

function generatedVideoDisplayTitle(video = {}, index = 0, fallback = "") {
  const title = String(video.title || "").trim();
  if (title && !/^\?+$/.test(title)) return title;
  if (fallback) return fallback;
  if (video.downloadedAt) return `未命名成片 · ${formatDate(video.downloadedAt)}`;
  return `未命名成片 ${index + 1}`;
}

function normalizeGeneratedVideoMatchText(value = "") {
  return String(value || "").replace(/\s+/g, "").toLowerCase();
}

function videoBelongsToCurrentScript(video = {}, { projectId = "", versionId = "", scriptTitle = "" } = {}) {
  const target = video.generationTarget || {};
  if (projectId && target.projectId && String(target.projectId) === String(projectId)) return true;
  if (versionId && target.versionId && String(target.versionId) === String(versionId)) return true;

  const currentTitleKey = normalizeGeneratedVideoMatchText(scriptTitle);
  if (!currentTitleKey) return false;

  return [target.scriptTitle, video.title]
    .map(normalizeGeneratedVideoMatchText)
    .some((value) => value && (value.includes(currentTitleKey) || currentTitleKey.includes(value)));
}

function realVideoFrameStyle(ratio = "9:16") {
  const [width, height] = String(ratio || "9:16").split(":").map((value) => Number(value));
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 9;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 16;
  const frameWidth = safeHeight > safeWidth ? "min(100%, 240px)" : safeHeight === safeWidth ? "min(100%, 320px)" : "100%";
  return {
    "--real-video-aspect-ratio": `${safeWidth} / ${safeHeight}`,
    "--real-video-frame-width": frameWidth,
  };
}

function buildCurrentGenerationSummary({ project = {}, version = {}, sample = {}, shot = {}, ratio = "9:16" }) {
  const title = version.selectedTitle || version.name || project.name || sample.name || "当前短剧";
  const episodeNumber = shot.episodeNumber || 1;
  const episodeTitle = shot.episodeTitle || shot.title || "剧本片段";
  const shotPosition = shot.position || 1;
  const subtitle = shot.subtitle || shot.voiceover || "";
  const frame = shot.frame || sample.logline || version.logline || "";
  const targetLabel = `第${episodeNumber}集 ${episodeTitle} · 镜头 ${shotPosition}`;
  const targetDetail = [subtitle ? `字幕：${subtitle}` : "", frame ? `画面：${frame}` : ""].filter(Boolean).join("；");
  return {
    title: `${title} · 第${episodeNumber}集 ${episodeTitle}`,
    meta: `镜头 ${shotPosition} · ${REAL_VIDEO_TEST_DURATION_SECONDS}s · ${ratio}`,
    subtitle,
    frame,
    generationTarget: {
      scriptTitle: title,
      episodeNumber,
      episodeTitle,
      shotPosition,
      shotTitle: shot.title || subtitle || frame || episodeTitle,
      label: targetLabel,
      detail: targetDetail,
      duration: REAL_VIDEO_TEST_DURATION_SECONDS,
      ratio,
    },
  };
}

function generationTargetLabel(target = {}) {
  if (!target || typeof target !== "object") return "";
  if (target.label) return target.label;
  const episode = target.episodeNumber ? `第${target.episodeNumber}集` : "";
  const title = target.episodeTitle || target.shotTitle || "";
  const shot = target.shotPosition ? `镜头 ${target.shotPosition}` : "";
  return [episode && title ? `${episode} ${title}` : episode || title, shot].filter(Boolean).join(" · ");
}

function generationTargetDetail(target = {}) {
  if (!target || typeof target !== "object") return "";
  return target.detail || [target.subtitle ? `字幕：${target.subtitle}` : "", target.frame ? `画面：${target.frame}` : ""].filter(Boolean).join("；");
}

const videoBatchStatusLabels = {
  waiting: "等待提交",
  submitting: "提交中",
  submitted: "已提交",
  failed: "提交失败",
};

const deliveryStatusLabels = {
  queued: "待发送",
  sent: "已发送",
  failed: "失败",
  expired: "已失效",
};

export function ErrorNotice({ error, onClose }) {
  return (
    <div className={`error-notice ${error.tone === "error" ? "error" : ""}`} role="status">
      <AlertTriangle size={18} />
      <div>
        <strong>{error.title}</strong>
        <p>{error.message}</p>
        {error.detail && <small>{error.detail}</small>}
      </div>
      <button type="button" onClick={onClose} title="关闭提示">
        <X size={16} />
      </button>
    </div>
  );
}

export function Metric({ icon: Icon, label, value }) {
  return (
    <div className="metric">
      <Icon size={17} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function PanelHeader({ icon: Icon, eyebrow, title, children }) {
  return (
    <div className={`panel-header ${children ? "has-extra" : ""}`}>
      <div className="panel-header-title">
        <div className="panel-icon">
          <Icon size={17} />
        </div>
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h3>{title}</h3>
        </div>
      </div>
      {children && <div className="panel-header-extra">{children}</div>}
    </div>
  );
}

export function TemplateBriefPreview({ template }) {
  const tags = template.tags || [];
  return (
    <div className="template-preview">
      <div className="template-preview-head">
        <span>{template.type}</span>
        <strong>{template.heatScore || "自定义"}</strong>
      </div>
      <h4>{template.name}</h4>
      <p>{template.hook}</p>
      <div className="template-preview-tags">
        {tags.slice(0, 4).map((tag) => (
          <em key={tag}>{tag}</em>
        ))}
      </div>
    </div>
  );
}

export function DraftReadinessPanel({ readiness }) {
  return (
    <div className="readiness-panel">
      <div className="readiness-head">
        <span>生成准备度</span>
        <strong>{readiness.score}%</strong>
      </div>
      <div className="readiness-track" aria-hidden="true">
        <i style={{ width: `${readiness.score}%` }} />
      </div>
      <div className="readiness-checks">
        {readiness.checks.map((item) => (
          <span className={item.done ? "done" : ""} key={item.label}>
            {item.done && <Check size={12} />}
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function CampaignPanel({ project, activeVersion, onAddResult }) {
  const [draft, setDraft] = useState({
    channel: "Meta Ads",
    materialName: activeVersion.selectedTitle || project.name,
    spend: 100,
    impressions: 10000,
    clicks: 420,
    completions: 1800,
    conversions: 18,
    revenue: 220,
    materialUrl: "",
    note: "",
  });
  const metrics = calculateCampaignMetrics(draft);
  const results = project.campaignResults || [];

  useEffect(() => {
    setDraft((current) => ({
      ...current,
      materialName: activeVersion.selectedTitle || project.name,
    }));
  }, [activeVersion.id, activeVersion.selectedTitle, project.name]);

  function updateField(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function submitResult() {
    onAddResult({
      ...draft,
      spend: Number(draft.spend || 0),
      impressions: Number(draft.impressions || 0),
      clicks: Number(draft.clicks || 0),
      completions: Number(draft.completions || 0),
      conversions: Number(draft.conversions || 0),
      revenue: Number(draft.revenue || 0),
    });
    setDraft((current) => ({
      ...current,
      materialName: activeVersion.selectedTitle || project.name,
      materialUrl: "",
      note: "",
    }));
  }

  return (
    <div className="campaign-panel">
      <div className="campaign-form">
        <div className="two-col">
          <label>
            渠道
            <input value={draft.channel} onChange={(event) => updateField("channel", event.target.value)} />
          </label>
          <label>
            素材名
            <input value={draft.materialName} onChange={(event) => updateField("materialName", event.target.value)} />
          </label>
        </div>
        <div className="campaign-number-grid">
          {[
            ["spend", "花费 $"],
            ["impressions", "曝光"],
            ["clicks", "点击"],
            ["completions", "完播"],
            ["conversions", "转化"],
            ["revenue", "收入 $"],
          ].map(([key, label]) => (
            <label key={key}>
              {label}
              <input type="number" min="0" value={draft[key]} onChange={(event) => updateField(key, event.target.value)} />
            </label>
          ))}
        </div>
        <label>
          素材链接
          <input value={draft.materialUrl} onChange={(event) => updateField("materialUrl", event.target.value)} />
        </label>
        <label>
          投流备注
          <textarea rows={2} value={draft.note} onChange={(event) => updateField("note", event.target.value)} />
        </label>
        <div className="campaign-metrics-preview">
          <span>CTR <b>{metrics.ctr}%</b></span>
          <span>完播 <b>{metrics.completionRate}%</b></span>
          <span>CPA <b>${metrics.cpa}</b></span>
          <span>ROAS <b>{metrics.roas}</b></span>
        </div>
        <button className="secondary-action strong" type="button" onClick={submitResult}>
          <Plus size={15} />
          记录投流结果
        </button>
      </div>

      <div className="campaign-result-list">
        {results.slice(0, 6).map((result) => {
          const itemMetrics = result.metrics || calculateCampaignMetrics(result);
          return (
            <article key={result.id}>
              <div>
                <b>{result.channel}</b>
                <span>{result.materialName}</span>
                <small>{result.versionName} · {formatDate(result.createdAt)}</small>
              </div>
              <strong>{itemMetrics.roas}x</strong>
              <p>
                CTR {itemMetrics.ctr}% · 完播 {itemMetrics.completionRate}% · CPA ${itemMetrics.cpa}
              </p>
            </article>
          );
        })}
        {results.length === 0 && <p className="muted-note">暂无投流结果。导出后把素材表现回填到这里，用于复盘模板和版本。</p>}
      </div>
    </div>
  );
}

export function ScriptEditor({ version, patchActiveVersion, onRewrite, isRewriting }) {
  function updateField(field, value) {
    patchActiveVersion((current) => ({ ...current, [field]: value }));
  }

  function updateCharacter(index, field, value) {
    patchActiveVersion((current) => ({
      ...current,
      characters: current.characters.map((character, itemIndex) =>
        itemIndex === index ? { ...character, [field]: value } : character,
      ),
    }));
  }

  function updateEpisode(index, field, value) {
    patchActiveVersion((current) => ({
      ...current,
      episodes: current.episodes.map((episode, itemIndex) =>
        itemIndex === index
          ? {
              ...episode,
              [field]: field === "dialogue" ? value.split("\n").filter(Boolean) : value,
            }
          : episode,
      ),
    }));
  }

  function updateStringList(field, index, value) {
    patchActiveVersion((current) => ({
      ...current,
      [field]: (current[field] || []).map((item, itemIndex) => (itemIndex === index ? value : item)),
    }));
  }

  const titleCandidates = version.titleCandidates || [];
  const sellingPoints = version.sellingPoints || [];
  const adHooks = version.adHooks || [];
  const characters = version.characters || [];
  const outline = version.outline || [];
  const episodes = version.episodes || [];
  const storyboards = version.storyboards || [];
  const storyboardByEpisode = new Map(
    storyboards.map((board, index) => [Number(board.episodeNumber || index + 1), board]),
  );

  return (
    <div className="editor-content workflow-script-editor">
      <div className="script-focus-card">
        <div className="script-focus-head">
          <div>
            <span>剧名候选</span>
            <div className="title-candidates">
              {titleCandidates.map((title) => (
                <button
                  key={title}
                  type="button"
                  className={version.selectedTitle === title ? "chip selected" : "chip"}
                  onClick={() => updateField("selectedTitle", title)}
                >
                  {title}
                </button>
              ))}
            </div>
          </div>
          <VersionMeta version={version} />
        </div>

        <label>
          一句话卖点
          <textarea rows={2} value={version.logline} onChange={(event) => updateField("logline", event.target.value)} />
        </label>

        <div className="quick-actions">
          {["提高冲突", "改短更直接", "强化结尾钩子", "本地化表达"].map((item) => (
            <button key={item} type="button" onClick={() => onRewrite(item)} disabled={isRewriting}>
              <RefreshCcw size={15} />
              {isRewriting ? "改写中..." : item}
            </button>
          ))}
        </div>
      </div>

      <div className="section-band episode-section">
        <div className="section-title-row">
          <h4>剧本与分镜</h4>
          <span>{episodes.length} 集 · 分镜已融合到对应剧集</span>
        </div>
        {episodes.map((episode, index) => {
          const storyboard = storyboardByEpisode.get(Number(episode.number)) || storyboards[index] || null;
          const shots = storyboard?.shots || [];
          return (
            <article className="episode-editor" key={episode.number}>
              <div className="episode-head">
                <strong>第 {episode.number} 集</strong>
                <input value={episode.title} onChange={(event) => updateEpisode(index, "title", event.target.value)} />
              </div>
              <div className="episode-compare-grid">
                <div className="episode-script-panel">
                  <div className="episode-column-head">
                    <b>剧本</b>
                    <span>可直接编辑</span>
                  </div>
                  <label>
                    钩子
                    <textarea rows={2} value={episode.hook} onChange={(event) => updateEpisode(index, "hook", event.target.value)} />
                  </label>
                  <label>
                    结构
                    <textarea rows={2} value={episode.beat} onChange={(event) => updateEpisode(index, "beat", event.target.value)} />
                  </label>
                  <label>
                    脚本
                    <textarea rows={3} value={episode.script} onChange={(event) => updateEpisode(index, "script", event.target.value)} />
                  </label>
                  <label>
                    核心对白
                    <textarea
                      rows={2}
                      value={(episode.dialogue || []).join("\n")}
                      onChange={(event) => updateEpisode(index, "dialogue", event.target.value)}
                    />
                  </label>
                </div>
                <div className="inline-storyboard episode-storyboard-panel" aria-label={`第 ${episode.number} 集分镜`}>
                  <div className="inline-storyboard-head">
                    <MonitorPlay size={14} />
                    <b>对应分镜</b>
                    <span>{shots.length} 个镜头</span>
                    {storyboard?.title && storyboard.title !== episode.title && <em>{storyboard.title}</em>}
                  </div>
                  {shots.length > 0 ? (
                    shots.map((shot) => (
                      <div className="inline-shot-row" key={`${episode.number}-${shot.time}-${shot.frame}`}>
                        <strong>{shot.time}</strong>
                        <p>{shot.frame}</p>
                        <small>{[shot.camera, shot.sound, shot.prop].filter(Boolean).join(" · ")}</small>
                      </div>
                    ))
                  ) : (
                    <p className="muted-note">暂无分镜，保存剧本后可重新生成。</p>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <details className="workflow-more-actions script-details">
        <summary>更多剧本资料</summary>
        <div className="section-band compact-section">
          <h4>卖点卡</h4>
          <div className="text-card-grid">
            {sellingPoints.map((point, index) => (
              <label className="text-card" key={`${point}-${index}`}>
                卖点 {index + 1}
                <textarea rows={2} value={point} onChange={(event) => updateStringList("sellingPoints", index, event.target.value)} />
              </label>
            ))}
          </div>
        </div>

        <div className="section-band">
          <h4>人物卡</h4>
          <div className="character-grid">
            {characters.map((character, index) => (
              <div className="character-item" key={`${character.role}-${character.name}`}>
                <span>{character.role}</span>
                <input value={character.name} onChange={(event) => updateCharacter(index, "name", event.target.value)} />
                <textarea rows={2} value={character.motive} onChange={(event) => updateCharacter(index, "motive", event.target.value)} />
                <small>{character.archetype}</small>
              </div>
            ))}
          </div>
        </div>

        <div className="section-band">
          <h4>故事大纲</h4>
          <div className="outline-list">
            {outline.map((arc, index) => (
              <label key={arc.id}>
                {arc.stage}
                <textarea
                  rows={2}
                  value={arc.summary}
                  onChange={(event) =>
                    patchActiveVersion((current) => ({
                      ...current,
                      outline: current.outline.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, summary: event.target.value } : item,
                      ),
                    }))
                  }
                />
              </label>
            ))}
          </div>
        </div>

        <div className="section-band compact-section">
          <h4>投流钩子</h4>
          <div className="ad-hook-list">
            {adHooks.map((hook, index) => (
              <label key={`${hook}-${index}`}>
                钩子 {index + 1}
                <textarea rows={2} value={hook} onChange={(event) => updateStringList("adHooks", index, event.target.value)} />
              </label>
            ))}
          </div>
        </div>
      </details>
    </div>
  );
}

function VersionMeta({ version }) {
  return (
    <div className="version-meta">
      <span>{version.source ? "AI 生成" : "本地生成"}</span>
      <span>{formatDate(version.createdAt)}</span>
    </div>
  );
}

export function ScoreCard({ version, onRewrite, isRewriting }) {
  const visibleDimensions = (version.score.dimensions || []).filter(
    (item) => item.name !== "合规风险" && item.name !== "相似度",
  );
  return (
    <div>
      <div className="score-dial">
        <span>{version.score.total}</span>
        <small>综合分</small>
      </div>
      <div className="score-bars">
        {visibleDimensions.map((item) => (
          <div className="score-line" key={item.name}>
            <span>
              {item.name}
              <b>{item.score}</b>
            </span>
            <div className="bar-track">
              <i style={{ width: `${item.score}%` }} />
            </div>
            <small>{item.note}</small>
          </div>
        ))}
      </div>
      <div className="suggestion-list">
        {version.score.suggestions.map((suggestion) => (
          <button type="button" key={suggestion} onClick={() => onRewrite(suggestion)} disabled={isRewriting}>
            <Flame size={15} />
            {isRewriting ? "AI 改写中..." : suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}

export function TrendPanel({ setDraftBrief, trendSummary, trendSnapshots, canImportTrends, onRefreshTrends, onImportTrendSnapshot }) {
  const tags = trendSummary?.tags || trendTags;
  const signals = trendSummary?.templateSignals || templateSignals;
  const notes = trendSummary?.marketNotes || marketNotes;
  const updatedAt = trendSummary?.lastUpdated ? formatDate(trendSummary.lastUpdated) : lastTrendUpdated;
  const [trendDraft, setTrendDraft] = useState("");

  function applyTag(tag) {
    setDraftBrief((brief) => ({
      ...brief,
      painPoint: `${tag.tag}：围绕${tag.fit}设计前 3 集。`,
    }));
  }

  return (
    <div className="trend-panel">
      <div className="panel-inline-head">
        <p className="timestamp">更新：{updatedAt} · {trendSummary?.source || "static-seed"}</p>
        <button className="mini-action" type="button" onClick={onRefreshTrends}>
          <RefreshCcw size={13} />
          刷新
        </button>
      </div>
      <div className="trend-list">
        {tags.map((tag) => (
          <button type="button" className="trend-row" key={`${tag.tag}-${tag.market}`} onClick={() => applyTag(tag)}>
            <span>
              <b>{tag.tag}</b>
              <small>{tag.market} · {tag.fit}</small>
            </span>
            <strong>
              {tag.heat}
              <em>{tag.change > 0 ? `+${tag.change}` : tag.change}</em>
            </strong>
          </button>
        ))}
      </div>
      <div className="signal-grid">
        {signals.map((signal) => (
          <div className="signal" key={signal.name}>
            <b>{signal.name}</b>
            <span>{signal.campaigns ? `投流 ${signal.campaigns} 次` : `保存 ${signal.saveRate}%`}</span>
            <span>{signal.avgRoas ? `ROAS ${signal.avgRoas}x` : `导出 ${signal.exportRate}%`}</span>
            <strong>{signal.score}</strong>
          </div>
        ))}
      </div>
      <div className="market-note-list">
        {notes.map((note) => (
          <p key={note.market}>
            <b>{note.market}</b>
            {note.note}
          </p>
        ))}
      </div>
      <div className="trend-import-box">
        <label>
          导入趋势快照 JSON
          <textarea
            rows={4}
            value={trendDraft}
            onChange={(event) => setTrendDraft(event.target.value)}
            placeholder='{"source":"manual","tags":[...],"templateSignals":[...],"marketNotes":[...]}'
            disabled={!canImportTrends}
          />
        </label>
        <button
          className="secondary-action strong"
          type="button"
          disabled={!canImportTrends || !trendDraft.trim()}
          onClick={() => {
            onImportTrendSnapshot(trendDraft);
            setTrendDraft("");
          }}
        >
          <Download size={15} />
          导入快照
        </button>
      </div>
      <div className="snapshot-list">
        {(trendSnapshots || []).slice(0, 4).map((snapshot) => (
          <p key={snapshot.id}>
            <b>{snapshot.source}</b>
            {snapshot.tags?.length || 0} 标签 · {snapshot.templateSignals?.length || 0} 模板信号
            <small>{formatDate(snapshot.createdAt)}</small>
          </p>
        ))}
        {(!trendSnapshots || trendSnapshots.length === 0) && <p className="muted-note">暂无导入快照，当前使用内置趋势种子。</p>}
      </div>
    </div>
  );
}

export function DeliveryPanel({ project, commentText, setCommentText, addComment, recordExport }) {
  return (
    <div className="delivery-panel">
      <div className="export-grid">
        <button type="button" onClick={() => recordExport("TXT", exportText)}>
          <FileText size={16} />
          TXT
        </button>
        <button type="button" onClick={() => recordExport("PDF", printPdf)}>
          <ClipboardList size={16} />
          PDF
        </button>
        <button type="button" onClick={() => recordExport("DOC", exportDoc)}>
          <Archive size={16} />
          DOC
        </button>
        <button type="button" onClick={() => recordExport("JSON", exportJson)}>
          <FileJson size={16} />
          JSON
        </button>
      </div>

      <div className="comment-box">
        <label>
          备注
          <textarea rows={2} value={commentText} onChange={(event) => setCommentText(event.target.value)} />
        </label>
        <button type="button" onClick={addComment}>
          <MessageSquare size={15} />
          添加备注
        </button>
      </div>

      <div className="activity-list">
        {project.comments.slice(0, 3).map((comment) => (
          <p key={comment.id}>
            <b>{comment.author}</b>
            {comment.text}
            <small>{formatDate(comment.createdAt)}</small>
          </p>
        ))}
        {project.exports.slice(0, 3).map((item) => (
          <p key={item.id}>
            <b>{item.type}</b>
            已生成文件 {item.version}
            <small>{formatDate(item.createdAt)}</small>
          </p>
        ))}
      </div>
    </div>
  );
}

export function TeamPanel({ workspace, setWorkspace, canManageTeam = true, onUpdateMember, onRemoveMember }) {
  const members = workspace.team?.members || [];

  function patchTeam(patcher) {
    if (!canManageTeam) return;
    setWorkspace((current) => ({
      ...current,
      team: patcher(current.team || { name: "未命名团队", members: [] }),
    }));
  }

  function updateMember(index, field, value) {
    if (!canManageTeam) return;
    patchTeam((team) => ({
      ...team,
      members: team.members.map((member, itemIndex) => (itemIndex === index ? { ...member, [field]: value } : member)),
    }));
  }

  function commitMember(member) {
    if (!canManageTeam || !member?.id || !onUpdateMember) return;
    onUpdateMember(member.id, { name: member.name, role: member.role });
  }

  function addMember() {
    if (!canManageTeam) return;
    patchTeam((team) => ({
      ...team,
      members: [...team.members, { name: "新成员", role: "查看者" }],
    }));
  }

  function removeMember(index) {
    if (!canManageTeam) return;
    const member = members[index];
    if (member?.id && onRemoveMember) {
      onRemoveMember(member.id, member);
      return;
    }
    patchTeam((team) => ({
      ...team,
      members: team.members.filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  return (
    <div className="team-panel">
      <label>
        团队名称
        <input
          value={workspace.team?.name || ""}
          onChange={(event) => patchTeam((team) => ({ ...team, name: event.target.value }))}
          disabled={!canManageTeam}
        />
      </label>
      <div className="member-list">
        {members.map((member, index) => (
          <div className="member-row" key={`${member.name}-${index}`}>
            <input
              value={member.name}
              onChange={(event) => updateMember(index, "name", event.target.value)}
              onBlur={() => commitMember(members[index])}
              disabled={!canManageTeam}
            />
            <select
              value={member.role}
              onChange={(event) => {
                updateMember(index, "role", event.target.value);
                commitMember({ ...member, role: event.target.value });
              }}
              disabled={!canManageTeam}
            >
              <option>所有者</option>
              <option>编辑者</option>
              <option>查看者</option>
            </select>
            <button type="button" onClick={() => removeMember(index)} title="移除成员" disabled={!canManageTeam}>
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
      {!canManageTeam && <p className="muted-note">只有所有者可以调整团队成员和角色。</p>}
      <button className="secondary-action" type="button" onClick={addMember} disabled={!canManageTeam}>
        <Plus size={15} />
        添加成员
      </button>
    </div>
  );
}

export function SecurityPanel({
  canManageTeam,
  inviteState,
  notificationState,
  auditState,
  onCreateInvite,
  onUpdateNotificationDelivery,
  onDeliverNotificationWebhook,
  onRefreshSecurity,
}) {
  const [inviteDraft, setInviteDraft] = useState({ email: "", name: "", role: "editor" });
  const notifications = notificationState?.notifications || [];
  const webhookConfigured = Boolean(notificationState?.webhookConfigured);
  const visibleAuditLogs = (auditState.logs || []).filter((log) => log.action !== "workspace.saved").slice(0, 6);

  function submitInvite(event) {
    event.preventDefault();
    if (!canManageTeam || !inviteDraft.email.trim()) return;
    onCreateInvite(inviteDraft);
    setInviteDraft({ email: "", name: "", role: "editor" });
  }

  return (
    <div className="security-panel">
      <div className="panel-inline-head">
        <span className="timestamp">团队安全、邀请与审计</span>
        <button className="mini-action" type="button" onClick={onRefreshSecurity} disabled={!canManageTeam}>
          <RefreshCcw size={13} />
          刷新
        </button>
      </div>
      <form className="invite-form" onSubmit={submitInvite}>
        <div className="two-col">
          <label>
            邀请邮箱
            <input
              type="email"
              value={inviteDraft.email}
              onChange={(event) => setInviteDraft({ ...inviteDraft, email: event.target.value })}
              disabled={!canManageTeam}
            />
          </label>
          <label>
            姓名
            <input
              value={inviteDraft.name}
              onChange={(event) => setInviteDraft({ ...inviteDraft, name: event.target.value })}
              disabled={!canManageTeam}
            />
          </label>
        </div>
        <div className="two-col">
          <label>
            角色
            <select
              value={inviteDraft.role}
              onChange={(event) => setInviteDraft({ ...inviteDraft, role: event.target.value })}
              disabled={!canManageTeam}
            >
              <option value="editor">编辑者</option>
              <option value="viewer">查看者</option>
            </select>
          </label>
          <button className="secondary-action strong" type="submit" disabled={!canManageTeam}>
            <MailPlus size={15} />
            生成邀请
          </button>
        </div>
      </form>

      {inviteState.lastInvite?.token && (
        <div className="copy-block">
          <b>邀请 Token</b>
          <code>{inviteState.lastInvite.token}</code>
          <small>复制给成员后，可在登录页“接受邀请”中加入团队。</small>
        </div>
      )}

      <div className="security-list">
        {(inviteState.invites || []).slice(0, 5).map((invite) => (
          <p key={invite.id}>
            <b>{invite.email}</b>
            {invite.role} · {invite.status}
            <small>{formatDate(invite.createdAt)} 到期 {formatDate(invite.expiresAt)}</small>
          </p>
        ))}
        {(!inviteState.invites || inviteState.invites.length === 0) && <p className="muted-note">暂无团队邀请。</p>}
      </div>

      <div className="notification-outbox">
        <div className="panel-inline-head">
          <span className="timestamp">本地通知发件箱</span>
          <span className="timestamp">
            {notifications.filter((item) => item.status === "queued").length} 条待发送 · {webhookConfigured ? "Webhook 已配置" : "本地投递"}
          </span>
        </div>
        {notifications.slice(0, 6).map((notification) => (
          <article className="notification-item" key={notification.id}>
            <div className="notification-meta">
              <MessageSquare size={15} />
              <div>
                <b>{notification.subject}</b>
                <span>{notification.recipient}</span>
              </div>
              <em className={`delivery-status ${notification.status}`}>
                {deliveryStatusLabels[notification.status] || notification.status}
              </em>
            </div>
            <pre className="notification-body">{notification.body}</pre>
            <div className="notification-actions">
              <small>{formatDate(notification.createdAt)}</small>
              <button
                className="mini-action strong"
                type="button"
                onClick={() => onDeliverNotificationWebhook(notification.id)}
                disabled={!canManageTeam || !webhookConfigured || ["sent", "expired"].includes(notification.status)}
                title={webhookConfigured ? "通过配置的 Webhook 自动投递" : "需要配置 DJCYTOOLS_NOTIFICATION_WEBHOOK_URL"}
              >
                <Send size={13} />
                Webhook 发送
              </button>
              <button
                className="mini-action"
                type="button"
                onClick={() => onUpdateNotificationDelivery(notification.id, "sent")}
                disabled={!canManageTeam || notification.status === "sent"}
              >
                <Check size={13} />
                已发送
              </button>
              <button
                className="mini-action danger-mini"
                type="button"
                onClick={() => onUpdateNotificationDelivery(notification.id, "failed")}
                disabled={!canManageTeam || notification.status === "failed"}
              >
                <AlertTriangle size={13} />
                失败
              </button>
            </div>
          </article>
        ))}
        {notifications.length === 0 && <p className="muted-note">暂无待投递通知；生成邀请或重置密码后会自动进入这里。</p>}
      </div>

      <div className="security-list audit-list">
        {visibleAuditLogs.map((log) => (
          <p key={log.id}>
            <b>{log.action}</b>
            {log.actor}
            <small>{formatDate(log.createdAt)}</small>
          </p>
        ))}
        {visibleAuditLogs.length === 0 && <p className="muted-note">暂无关键审计记录。</p>}
      </div>
    </div>
  );
}

export function AccountSecurityPanel({ user, onChangePassword }) {
  const [draft, setDraft] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const canSubmit = draft.currentPassword && draft.newPassword.length >= 8 && draft.newPassword === draft.confirmPassword;

  function submitPassword(event) {
    event.preventDefault();
    if (!canSubmit) return;
    onChangePassword({ currentPassword: draft.currentPassword, newPassword: draft.newPassword });
    setDraft({ currentPassword: "", newPassword: "", confirmPassword: "" });
  }

  return (
    <div className="account-security-panel">
      <div className="migration-card">
        <KeyRound size={16} />
        <div>
          <b>{user?.email || "当前账号"}</b>
          <span>修改密码后会保留当前会话，并清理其他已登录会话。</span>
        </div>
      </div>
      <form className="invite-form" onSubmit={submitPassword}>
        <label>
          当前密码
          <input
            type="password"
            value={draft.currentPassword}
            onChange={(event) => setDraft({ ...draft, currentPassword: event.target.value })}
            autoComplete="current-password"
          />
        </label>
        <label>
          新密码
          <input
            type="password"
            value={draft.newPassword}
            onChange={(event) => setDraft({ ...draft, newPassword: event.target.value })}
            autoComplete="new-password"
            minLength={8}
          />
        </label>
        <label>
          确认新密码
          <input
            type="password"
            value={draft.confirmPassword}
            onChange={(event) => setDraft({ ...draft, confirmPassword: event.target.value })}
            autoComplete="new-password"
            minLength={8}
          />
        </label>
        {draft.confirmPassword && draft.newPassword !== draft.confirmPassword && <p className="muted-note">两次输入的新密码不一致。</p>}
        <button className="secondary-action strong" type="submit" disabled={!canSubmit}>
          <KeyRound size={15} />
          更新密码
        </button>
      </form>
    </div>
  );
}

export function InteractivePanel({ project, activeVersion, onCreateInteractiveExperience }) {
  const [draft, setDraft] = useState({ mood: "想看主角翻盘", persona: "下班后刷剧的女性观众" });
  const experiences = project?.interactiveExperiences || [];
  return (
    <div className="interactive-panel">
      <div className="interactive-form">
        <label>
          情绪状态
          <input value={draft.mood} onChange={(event) => setDraft({ ...draft, mood: event.target.value })} />
        </label>
        <label>
          用户画像
          <input value={draft.persona} onChange={(event) => setDraft({ ...draft, persona: event.target.value })} />
        </label>
        <button className="secondary-action strong" type="button" onClick={() => onCreateInteractiveExperience(draft)}>
          <Plus size={15} />
          生成互动体验
        </button>
      </div>
      <div className="security-list">
        {experiences.slice(0, 2).map((experience) => (
          <p key={experience.id}>
            <b>{experience.name}</b>
            {experience.persona} · {experience.mood}
            <small>{experience.choices?.length || 0} 个选择点 · {formatDate(experience.createdAt)}</small>
          </p>
        ))}
        {experiences.length === 0 && <p className="muted-note">可基于当前版本生成 C 端互动短剧雏形。</p>}
      </div>
    </div>
  );
}

export function VideoSamplePanel({ project, activeVersion, canEdit = true }) {
  const [activeShotIndex, setActiveShotIndex] = useState(0);
  const [realVideoTask, setRealVideoTask] = useState(null);
  const [submittedShotSummary, setSubmittedShotSummary] = useState(null);
  const [isCreatingRealVideo, setIsCreatingRealVideo] = useState(false);
  const [isCreatingEpisodeBatch, setIsCreatingEpisodeBatch] = useState(false);
  const [episodeRange, setEpisodeRange] = useState({ from: 1, to: 8 });
  const [episodeBatchTasks, setEpisodeBatchTasks] = useState([]);
  const [realVideoError, setRealVideoError] = useState("");
  const [generatedVideos, setGeneratedVideos] = useState([]);
  const [generatedVideosError, setGeneratedVideosError] = useState("");
  const [realVideoOptions, setRealVideoOptions] = useState({
    ratio: "9:16",
    duration: REAL_VIDEO_TEST_DURATION_SECONDS,
  });
  const currentScriptTitle = activeVersion?.selectedTitle || activeVersion?.name || project?.name || "当前剧本";
  const scriptVideoSample = buildScriptVideoFallback({ project, version: activeVersion, ratio: realVideoOptions.ratio });
  const realVideoSample = scriptVideoSample;
  const episodeShots = Array.isArray(realVideoSample?.shots) ? realVideoSample.shots : [];
  const maxEpisodeNumber = Math.max(1, ...episodeShots.map((shot, index) => Number(shot.episodeNumber || index + 1)).filter(Number.isFinite));
  const clampEpisode = (value) => Math.min(maxEpisodeNumber, Math.max(1, Number(value) || 1));
  const episodeRangeFrom = Math.min(clampEpisode(episodeRange.from), clampEpisode(episodeRange.to));
  const episodeRangeTo = Math.max(clampEpisode(episodeRange.from), clampEpisode(episodeRange.to));
  const selectedEpisodeShots = episodeShots.filter((shot, index) => {
    const number = Number(shot.episodeNumber || index + 1);
    return number >= episodeRangeFrom && number <= episodeRangeTo;
  });
  const activeShot = episodeShots[activeShotIndex] || episodeShots[0] || null;
  const activeEpisodeNumber = clampEpisode(activeShot?.episodeNumber || activeShotIndex + 1);
  const realVideoFailed = isRealVideoTaskFailed(realVideoTask?.status);
  const realVideoDone = isRealVideoTaskDone(realVideoTask?.status);
  const activeRealVideoUrl = realVideoTask?.localVideoUrl || realVideoTask?.videoUrl || "";
  const activeShotSummary = activeShot
    ? buildCurrentGenerationSummary({ project, version: activeVersion, sample: realVideoSample, shot: activeShot, ratio: realVideoOptions.ratio })
    : null;
  const isTaskInFlight = Boolean(realVideoTask?.id && !realVideoDone && !realVideoFailed);
  const visibleGenerationSummary = isTaskInFlight ? submittedShotSummary || activeShotSummary : activeShotSummary;
  const realVideoTaskTarget = realVideoTask?.generationTarget || submittedShotSummary?.generationTarget || null;
  const isSubmittingVideo = isCreatingRealVideo || isCreatingEpisodeBatch;
  const activeRealVideoRatio = realVideoTaskTarget?.ratio || realVideoTask?.ratio || realVideoOptions.ratio;
  const activeRealVideoFrameStyle = realVideoFrameStyle(activeRealVideoRatio);
  const generatedVideosForCurrentScript = useMemo(
    () =>
      generatedVideos.filter((video) =>
        videoBelongsToCurrentScript(video, {
          projectId: project?.id || "",
          versionId: activeVersion?.id || "",
          scriptTitle: currentScriptTitle,
        }),
      ),
    [activeVersion?.id, currentScriptTitle, generatedVideos, project?.id],
  );
  const otherGeneratedVideoCount = Math.max(0, generatedVideos.length - generatedVideosForCurrentScript.length);

  function selectEpisode(value) {
    const nextEpisode = clampEpisode(value);
    const nextIndex = episodeShots.findIndex((shot, index) => Number(shot.episodeNumber || index + 1) === nextEpisode);
    setActiveShotIndex(nextIndex >= 0 ? nextIndex : 0);
  }

  async function refreshGeneratedVideos() {
    setGeneratedVideosError("");
    try {
      const data = await fetchGeneratedVideos();
      setGeneratedVideos(Array.isArray(data.videos) ? data.videos : []);
    } catch (error) {
      setGeneratedVideosError(error instanceof Error ? error.message : "读取本地真实视频失败");
    }
  }

  useEffect(() => {
    refreshGeneratedVideos();
  }, []);

  useEffect(() => {
    setActiveShotIndex(0);
    setRealVideoTask(null);
    setSubmittedShotSummary(null);
    setEpisodeRange({
      from: 1,
      to: Math.min(8, Math.max(1, ...(Array.isArray(activeVersion?.episodes) ? activeVersion.episodes.map((episode, index) => Number(episode.number || index + 1)).filter(Number.isFinite) : [1]))),
    });
    setEpisodeBatchTasks([]);
    setRealVideoError("");
  }, [activeVersion?.id]);

  useEffect(() => {
    if (!realVideoTask?.id || realVideoDone || realVideoFailed) return undefined;
    let cancelled = false;
    let polling = false;
    let timeout = 0;
    let interval = 0;

    const stopPolling = () => {
      if (timeout) window.clearTimeout(timeout);
      if (interval) window.clearInterval(interval);
      timeout = 0;
      interval = 0;
    };

    const pollTask = async () => {
      if (polling) return;
      polling = true;
      try {
        const data = await fetchRealVideoTask(realVideoTask.id);
        if (cancelled) return;
        setRealVideoTask((current) => ({
          ...(data.task || {}),
          title: data.task?.title || current?.title || realVideoSample.name || activeVersion.selectedTitle || project.name,
          ratio: data.task?.ratio || current?.ratio || submittedShotSummary?.generationTarget?.ratio || realVideoOptions.ratio,
          generationTarget: data.task?.generationTarget || current?.generationTarget || submittedShotSummary?.generationTarget || null,
        }));
        if (data.task?.errorHint || data.task?.error) setRealVideoError(data.task.errorHint || data.task.error);
        if (isRealVideoTaskDone(data.task?.status) || isRealVideoTaskFailed(data.task?.status)) stopPolling();
        if (isRealVideoTaskDone(data.task?.status) && (data.task?.localVideoUrl || data.task?.videoUrl)) refreshGeneratedVideos();
      } catch (error) {
        if (cancelled) return;
        setRealVideoError(error instanceof Error ? error.message : "真实视频任务查询失败");
      } finally {
        polling = false;
      }
    };

    timeout = window.setTimeout(pollTask, 2500);
    interval = window.setInterval(pollTask, 6000);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [realVideoTask?.id, realVideoDone, realVideoFailed, realVideoSample?.name, activeVersion?.selectedTitle, project?.name, submittedShotSummary?.generationTarget, realVideoOptions.ratio]);

  async function createRealVideo() {
    if (!canEdit || !activeVersion || !realVideoSample || !activeShot || isSubmittingVideo) return;
    setIsCreatingRealVideo(true);
    setRealVideoError("");
    const nextSubmittedSummary = buildCurrentGenerationSummary({
      project,
      version: activeVersion,
      sample: realVideoSample,
      shot: activeShot,
      ratio: realVideoOptions.ratio,
    });
    setSubmittedShotSummary(nextSubmittedSummary);
    try {
      const data = await createRealVideoTask({
        project,
        version: activeVersion,
        sample: realVideoSample,
        shot: activeShot,
        duration: REAL_VIDEO_TEST_DURATION_SECONDS,
        ratio: realVideoOptions.ratio,
        generateAudio: true,
      });
      setRealVideoTask({
        ...(data.task || {}),
        title: data.task?.title || realVideoSample.name || activeVersion.selectedTitle || project.name,
        ratio: data.task?.ratio || nextSubmittedSummary.generationTarget.ratio,
        generationTarget: data.task?.generationTarget || nextSubmittedSummary.generationTarget,
      });
      if (data.task?.errorHint || data.task?.error) setRealVideoError(data.task.errorHint || data.task.error);
    } catch (error) {
      setRealVideoError(error instanceof Error ? error.message : "真实视频任务提交失败");
    } finally {
      setIsCreatingRealVideo(false);
    }
  }

  async function createEpisodeRangeVideos() {
    if (!canEdit || !activeVersion || !realVideoSample || !selectedEpisodeShots.length || isSubmittingVideo) return;
    setIsCreatingEpisodeBatch(true);
    setRealVideoError("");
    const initialBatch = selectedEpisodeShots.map((shot) => {
      const summary = buildCurrentGenerationSummary({ project, version: activeVersion, sample: realVideoSample, shot, ratio: realVideoOptions.ratio });
      return {
        key: shot.id || `${summary.generationTarget.episodeNumber}-${summary.generationTarget.shotPosition}`,
        summary,
        status: "waiting",
        taskId: "",
        error: "",
      };
    });
    setEpisodeBatchTasks(initialBatch);

    for (const shot of selectedEpisodeShots) {
      const summary = buildCurrentGenerationSummary({ project, version: activeVersion, sample: realVideoSample, shot, ratio: realVideoOptions.ratio });
      const key = shot.id || `${summary.generationTarget.episodeNumber}-${summary.generationTarget.shotPosition}`;
      setSubmittedShotSummary(summary);
      setEpisodeBatchTasks((current) => current.map((item) => (item.key === key ? { ...item, status: "submitting", error: "" } : item)));
      try {
        const data = await createRealVideoTask({
          project,
          version: activeVersion,
          sample: realVideoSample,
          shot,
          duration: REAL_VIDEO_TEST_DURATION_SECONDS,
          ratio: realVideoOptions.ratio,
          generateAudio: true,
        });
        const task = {
          ...(data.task || {}),
          title: data.task?.title || summary.title,
          ratio: data.task?.ratio || summary.generationTarget.ratio,
          generationTarget: data.task?.generationTarget || summary.generationTarget,
        };
        setRealVideoTask(task);
        setEpisodeBatchTasks((current) =>
          current.map((item) => (item.key === key ? { ...item, status: "submitted", taskId: task.id || "", error: task.errorHint || task.error || "" } : item)),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "真实视频任务提交失败";
        setRealVideoError(message);
        setEpisodeBatchTasks((current) => current.map((item) => (item.key === key ? { ...item, status: "failed", error: message } : item)));
      }
    }

    setIsCreatingEpisodeBatch(false);
    refreshGeneratedVideos();
  }

  return (
    <div className="video-sample-panel">
      <div className="video-workflow-intro">
        <b>{activeVersion?.selectedTitle || activeVersion?.name || project?.name || "当前剧本"}</b>
        <span>选择单集或剧集范围，提交后会按剧本内容生成真实视频。</span>
      </div>
      {visibleGenerationSummary && (
        <div className={`current-generation-card ${isTaskInFlight ? "running" : ""}`} aria-label="当前生成片段">
          <span>{isTaskInFlight ? "正在生成" : "准备生成"}</span>
          <b>{isTaskInFlight ? realVideoTask?.title || visibleGenerationSummary.title : visibleGenerationSummary.title}</b>
          <small>{visibleGenerationSummary.meta}</small>
          {(visibleGenerationSummary.subtitle || visibleGenerationSummary.frame) && (
            <p>{visibleGenerationSummary.subtitle || visibleGenerationSummary.frame}</p>
          )}
        </div>
      )}
      {activeVersion && activeShot && (
        <div className="sample-preview-grid">
          <div className="real-video-stack">
            {activeVersion && (
              <div className="real-video-options">
                <label>
                  比例
                  <select
                    value={realVideoOptions.ratio}
                    onChange={(event) => setRealVideoOptions((current) => ({ ...current, ratio: event.target.value }))}
                  >
                    <option value="9:16">9:16</option>
                    <option value="16:9">16:9</option>
                    <option value="1:1">1:1</option>
                    <option value="3:4">3:4</option>
                    <option value="4:3">4:3</option>
                  </select>
                </label>
                <label>
                  单集
                  <input
                    aria-label="单独生成集数"
                    max={maxEpisodeNumber}
                    min="1"
                    type="number"
                    value={activeEpisodeNumber}
                    onChange={(event) => selectEpisode(event.target.value)}
                  />
                </label>
                <label>
                  秒数
                  <input
                    max="15"
                    min="15"
                    type="number"
                    value={REAL_VIDEO_TEST_DURATION_SECONDS}
                    disabled
                    onChange={() => {}}
                  />
                </label>
                <label>
                  起始集
                  <input
                    aria-label="起始集"
                    max={maxEpisodeNumber}
                    min="1"
                    type="number"
                    value={episodeRangeFrom}
                    onChange={(event) => setEpisodeRange((current) => ({ ...current, from: Number(event.target.value) }))}
                  />
                </label>
                <label>
                  结束集
                  <input
                    aria-label="结束集"
                    max={maxEpisodeNumber}
                    min="1"
                    type="number"
                    value={episodeRangeTo}
                    onChange={(event) => setEpisodeRange((current) => ({ ...current, to: Number(event.target.value) }))}
                  />
                </label>
              </div>
            )}
            <div className="video-sample-actions">
              <button className="secondary-action strong" type="button" onClick={createRealVideo} disabled={!canEdit || !activeVersion || isSubmittingVideo}>
                <MonitorPlay size={15} />
                {isCreatingRealVideo ? "提交中" : canEdit ? `生成当前第${activeEpisodeNumber}集` : "查看者无生成权限"}
              </button>
              <button className="secondary-action" type="button" onClick={createEpisodeRangeVideos} disabled={!canEdit || !activeVersion || isSubmittingVideo || !selectedEpisodeShots.length}>
                <ClipboardList size={15} />
                {isCreatingEpisodeBatch ? "批量提交中" : `生成第${episodeRangeFrom}${episodeRangeFrom === episodeRangeTo ? "" : `-${episodeRangeTo}`}集`}
              </button>
            </div>
            <div className={`generated-video-list ${generatedVideosForCurrentScript.length === 0 ? "empty" : ""}`}>
              <div className="generated-video-list-head">
                <div>
                  <b>当前剧本已生成视频</b>
                  <small>{generatedVideosForCurrentScript.length ? `${generatedVideosForCurrentScript.length} 条可查看` : "生成完成后显示在这里"}</small>
                </div>
                <button className="mini-action" type="button" onClick={refreshGeneratedVideos}>
                  <RefreshCcw size={13} />
                  刷新
                </button>
              </div>
              {generatedVideosForCurrentScript.length === 0 && (
                <p className="generated-video-empty">
                  {generatedVideosError ? generatedVideosError : `${currentScriptTitle} 还没有已生成视频。生成当前集或剧集范围后会出现在这里。`}
                </p>
              )}
              {generatedVideosForCurrentScript.slice(0, 3).map((video, index) => {
                  const target = video.generationTarget || null;
                  const targetLabel = generationTargetLabel(target);
                  const targetDetail = generationTargetDetail(target);
                  const displayTitle = target?.scriptTitle || generatedVideoDisplayTitle(video, index, currentScriptTitle);
                  return (
                    <button
                      className={video.localVideoUrl === activeRealVideoUrl ? "active" : ""}
                      key={video.taskId || video.id || `${displayTitle}-${index}`}
                      type="button"
                      onClick={() => {
                        setRealVideoTask({
                          id: video.taskId || video.id,
                          title: generatedVideoDisplayTitle(video, index, displayTitle),
                          status: video.status || "succeeded",
                          ratio: video.ratio || target?.ratio || realVideoOptions.ratio,
                          videoUrl: video.sourceVideoUrl || "",
                          localVideoUrl: video.localVideoUrl,
                          generationTarget: target,
                        });
                        setSubmittedShotSummary(null);
                        setRealVideoError("");
                      }}
                    >
                      <b>{displayTitle}</b>
                      {targetLabel ? <strong>{targetLabel}</strong> : <strong>旧视频未记录具体集数</strong>}
                      {targetDetail && <small>{targetDetail}</small>}
                      <small>{video.downloadedAt ? `生成时间 ${formatDate(video.downloadedAt)}` : "已生成"}</small>
                    </button>
                  );
                })}
              {generatedVideosForCurrentScript.length > 3 && <small>另有 {generatedVideosForCurrentScript.length - 3} 条当前剧本视频。</small>}
              {generatedVideosForCurrentScript.length === 0 && otherGeneratedVideoCount > 0 && !generatedVideosError && (
                <small>已有其他剧本视频 {otherGeneratedVideoCount} 条；这里仅显示当前剧本。</small>
              )}
              {generatedVideosForCurrentScript.length > 0 && generatedVideosError && <small>{generatedVideosError}</small>}
            </div>
            {realVideoTask && !activeRealVideoUrl && (
              <div className={`real-video-task ${realVideoFailed ? "failed" : ""}`}>
                <b>{realVideoTask.title || realVideoSample.name || activeVersion.selectedTitle || "真实视频"}</b>
                <strong>{activeRealVideoUrl ? "视频已生成" : realVideoFailed ? "生成失败" : "云端生成中"}</strong>
                {realVideoTaskTarget && (
                  <div className="real-video-target">
                    <span>对应片段</span>
                    <b>{generationTargetLabel(realVideoTaskTarget)}</b>
                    {generationTargetDetail(realVideoTaskTarget) && <small>{generationTargetDetail(realVideoTaskTarget)}</small>}
                  </div>
                )}
                <span>{activeRealVideoUrl ? "已保存到已生成视频" : realVideoFailed ? "请根据提示处理后重新生成" : "完成后会自动出现在下方"}</span>
                {(realVideoTask.errorHint || realVideoTask.error) && <small>{realVideoTask.errorHint || realVideoTask.error}</small>}
                {realVideoTask.errorHelpUrl && (
                  <a href={realVideoTask.errorHelpUrl} target="_blank" rel="noreferrer">
                    打开模型开通页
                  </a>
                )}
                {activeRealVideoUrl && (
                  <a href={activeRealVideoUrl} target="_blank" rel="noreferrer">
                    打开视频
                  </a>
                )}
              </div>
            )}
            {episodeBatchTasks.length > 0 && (
              <div className="episode-batch-list" aria-label="本次剧集生成">
                <div className="episode-batch-head">
                  <b>本次生成</b>
                  <small>
                    {(activeVersion?.selectedTitle || project?.name || realVideoSample.name || "当前剧本")} · 第{episodeRangeFrom}
                    {episodeRangeFrom === episodeRangeTo ? "" : `-${episodeRangeTo}`}集
                  </small>
                </div>
                {episodeBatchTasks.map((item) => (
                  <p className={item.status} key={item.key}>
                    <b>{generationTargetLabel(item.summary?.generationTarget)}</b>
                    <small>{[videoBatchStatusLabels[item.status] || item.status, item.taskId ? `任务 ${item.taskId}` : "", item.error].filter(Boolean).join(" · ")}</small>
                  </p>
                ))}
              </div>
            )}
            {realVideoError && <p className="muted-note">{realVideoError}</p>}
          </div>
          <div className={`sample-meta ${activeRealVideoUrl ? "has-real-video" : ""}`}>
            {activeRealVideoUrl && (
              <div className="real-video-frame" style={activeRealVideoFrameStyle}>
                <video className="rendered-video-preview real-video" controls src={activeRealVideoUrl} />
              </div>
            )}
            <div className="panel-inline-head">
              <span className="timestamp">{realVideoSample.source || realVideoSample.status} · {REAL_VIDEO_TEST_DURATION_SECONDS}s · {realVideoSample.voice}</span>
            </div>
            <b>{realVideoSample.name}</b>
            <p>{realVideoSample.logline}</p>
            <div className="sample-render-status">
              <span className={activeRealVideoUrl ? "ready" : "pending"}>
                <b>{activeRealVideoUrl ? "已生成" : "待生成"}</b>
                真实视频
              </span>
              <span className="ready">
                <b>{REAL_VIDEO_TEST_DURATION_SECONDS}s</b>
                时长
              </span>
              <span className="ready">
                <b>{realVideoOptions.ratio}</b>
                比例
              </span>
            </div>
            {!activeRealVideoUrl && <div className="shot-timeline">
              {(realVideoSample.shots || []).map((shot, index) => (
                <button
                  className={index === activeShotIndex ? "active" : ""}
                  key={shot.id}
                  type="button"
                  onClick={() => {
                    setActiveShotIndex(index);
                  }}
                >
                  <span>{shot.position}</span>
                  <b>{shot.subtitle}</b>
                  <small>{Math.round(shot.start)}-{Math.round(shot.end)}s · {shot.assetStatus}</small>
                </button>
              ))}
            </div>}
          </div>
        </div>
      )}

      {activeVersion && activeShot && (
        <details className="workflow-more-actions video-prompt-details">
          <summary>查看生成提示词</summary>
          <div className="copy-block">
            <b>AI 提示参考</b>
            <code>{activeShot.visualPrompt}</code>
            <small>{activeShot.sound} · 道具：{activeShot.prop}</small>
          </div>
        </details>
      )}

      {!activeVersion && (
        <p className="muted-note">
          当前版本：{activeVersion?.selectedTitle || activeVersion?.name || "未选择版本"}。请选择剧本版本后生成真实视频。
        </p>
      )}
    </div>
  );
}

export function ApiHandoffPanel({
  activeProject,
  healthState,
  apiTokenState,
  canManageTokens,
  onCreateApiToken,
  onRevokeApiToken,
}) {
  const [tokenName, setTokenName] = useState("制作流程 Token");
  const projectId = activeProject?.id || "project_id";
  const baseUrl = window.location.origin;
  const publicHealth = `${baseUrl}/api/public/health`;
  const publicList = `${baseUrl}/api/public/projects`;
  const publicExport = `${baseUrl}/api/public/projects/${projectId}/export`;
  const campaignWebhook = `${baseUrl}/api/public/projects/${projectId}/campaign-results`;
  return (
    <div className="api-handoff-panel">
      <div className="api-metric-grid">
        <div>
          <KeyRound size={17} />
          <span>Public API</span>
          <strong>{healthState?.publicApiConfigured || apiTokenState?.tokens?.some((token) => !token.revokedAt) ? "已配置" : "未配置"}</strong>
          <small>环境变量或团队 Token</small>
        </div>
        <div>
          <FileJson size={17} />
          <span>OpenAPI</span>
          <strong>JSON</strong>
          <small>/api/public/openapi.json</small>
        </div>
      </div>
      <div className="api-endpoint-list">
        <label>
          健康检查
          <code>{publicHealth}</code>
        </label>
        <label>
          项目列表
          <code>{publicList}</code>
        </label>
        <label>
          当前项目导出
          <code>{publicExport}</code>
        </label>
        <label>
          投流数据回写
          <code>{campaignWebhook}</code>
        </label>
      </div>
      <div className="copy-block">
        <b>cURL 示例</b>
        <code>{`curl -H "X-DJCYTOOLS-API-KEY: $DJCYTOOLS_PUBLIC_API_TOKEN" "${publicExport}"`}</code>
        <code>{`curl -X POST -H "Content-Type: application/json" -H "X-DJCYTOOLS-API-KEY: $DJCYTOOLS_PUBLIC_API_TOKEN" -d '{"channel":"Meta Ads","spend":120,"impressions":18000,"clicks":720,"completions":3200,"conversions":24,"revenue":360}' "${campaignWebhook}"`}</code>
      </div>
      <form
        className="invite-form"
        onSubmit={(event) => {
          event.preventDefault();
          onCreateApiToken(tokenName);
          setTokenName("制作流程 Token");
        }}
      >
        <label>
          新建团队 API Token
          <input value={tokenName} onChange={(event) => setTokenName(event.target.value)} disabled={!canManageTokens} />
        </label>
        <button className="secondary-action strong" type="submit" disabled={!canManageTokens || !tokenName.trim()}>
          <KeyRound size={15} />
          生成 Token
        </button>
      </form>
      {apiTokenState?.lastToken?.token && (
        <div className="copy-block">
          <b>新 Token 只显示一次</b>
          <code>{apiTokenState.lastToken.token}</code>
          <small>关闭或刷新后只能看到前缀，需要重新生成。</small>
        </div>
      )}
      <div className="security-list">
        {(apiTokenState?.tokens || []).slice(0, 6).map((token) => (
          <p key={token.id}>
            <b>{token.name}</b>
            {token.prefix} · {token.revokedAt ? "已撤销" : "可用"}
            <small>
              创建 {formatDate(token.createdAt)} · 最近使用 {token.lastUsedAt ? formatDate(token.lastUsedAt) : "暂无"}
            </small>
            {!token.revokedAt && (
              <button className="mini-action danger-mini" type="button" onClick={() => onRevokeApiToken(token.id)} disabled={!canManageTokens}>
                撤销
              </button>
            )}
          </p>
        ))}
        {(!apiTokenState?.tokens || apiTokenState.tokens.length === 0) && <p className="muted-note">还没有团队 API Token。</p>}
      </div>
    </div>
  );
}

const communityTemplates = [
  {
    id: "marketplace-contract-revenge",
    name: "离婚协议反杀局",
    type: "豪门复仇",
    tags: ["协议", "公开反击", "身份揭露"],
    premise: "女主在离婚签字现场发现资产转移证据，反手接管家族项目。",
    lead: "被低估的前妻",
    rival: "伪善继承人",
    hook: "离婚协议刚签完，她拿出另一份收购确认书。",
    beat: "公开羞辱、证据反杀、资产控制权、旧爱悔悟。",
    defaultParams: { humiliation: 78, reversal: 86, sweet: 56, conflict: 82, hookDensity: 88 },
    price: "免费",
  },
  {
    id: "marketplace-live-mask",
    name: "直播间假面女王",
    type: "直播网红",
    tags: ["直播事故", "反差人设", "投流强钩子"],
    premise: "女主播被同行陷害翻车，却用直播事故揭开整条灰产链。",
    lead: "冷静控场的主播",
    rival: "买榜网红",
    hook: "直播断流前 3 秒，她把后台交易记录投到大屏。",
    beat: "流量误判、公开翻车、后台证据、品牌反转。",
    defaultParams: { humiliation: 72, reversal: 90, sweet: 42, conflict: 78, hookDensity: 93 },
    price: "模板积分 20",
  },
];

export function TemplateMarketplacePanel({ workspace, setWorkspace, templateInsights, setDraftBrief, setDraftParams }) {
  function installTemplate(template) {
    const installed = {
      ...template,
      id: `custom-${uid("market")}`,
      category: template.type,
      heatRank: 880 + (workspace.customTemplates || []).length,
      heatScore: 82,
      isCustom: true,
      marketplaceSourceId: template.id,
      installedAt: new Date().toISOString(),
    };
    setWorkspace((current) => ({
      ...current,
      customTemplates: [installed, ...(current.customTemplates || [])],
    }));
    setDraftBrief((brief) => ({ ...brief, templateId: installed.id }));
    setDraftParams(installed.defaultParams);
  }

  return (
    <div className="marketplace-panel">
      <div className="template-insight-list">
        {(templateInsights || []).slice(0, 5).map((insight) => (
          <div className="template-insight" key={insight.templateName}>
            <b>{insight.templateName}</b>
            <span>投流 {insight.campaigns} 次</span>
            <strong>{insight.avgRoas}x</strong>
            <small>CTR {insight.avgCtr}% · 完播 {insight.avgCompletionRate}%</small>
          </div>
        ))}
        {(!templateInsights || templateInsights.length === 0) && <p className="muted-note">投流回流后，这里会按模板聚合效果。</p>}
      </div>
      <div className="market-template-list">
        {communityTemplates.map((template) => (
          <article key={template.id}>
            <div>
              <Store size={16} />
              <b>{template.name}</b>
              <span>{template.type} · {template.price}</span>
            </div>
            <p>{template.hook}</p>
            <button className="secondary-action" type="button" onClick={() => installTemplate(template)}>
              安装模板
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}

export function TemplateManager({ workspace, setWorkspace, templateCatalog, typeGroups, draftBrief, setDraftBrief, setDraftParams }) {
  const selectedTemplate = getTemplate(draftBrief.templateId, templateCatalog);
  const [draftTemplate, setDraftTemplate] = useState(() => createTemplateDraft(selectedTemplate));
  const customTemplates = workspace.customTemplates || [];

  useEffect(() => {
    setDraftTemplate((current) => (current.id ? current : createTemplateDraft(selectedTemplate)));
  }, [selectedTemplate.id]);

  function createTemplateDraft(template) {
    return {
      id: "",
      name: `${template.name} 改版`,
      type: template.type || "自定义",
      tags: (template.tags || []).join("、"),
      premise: template.premise || "",
      lead: template.lead || "",
      rival: template.rival || "",
      hook: template.hook || "",
      beat: template.beat || "",
      heatScore: 70,
      defaultParams: template.defaultParams || selectedTemplate.defaultParams,
    };
  }

  function resetFromSelected() {
    setDraftTemplate(createTemplateDraft(selectedTemplate));
  }

  function saveCustomTemplate() {
    const nextTemplate = {
      id: draftTemplate.id || `custom-${uid("tpl")}`,
      name: draftTemplate.name.trim() || "未命名自定义模板",
      type: draftTemplate.type.trim() || "自定义",
      category: draftTemplate.type.trim() || "自定义",
      heatRank: draftTemplate.id ? draftTemplate.heatRank || 900 : 900 + customTemplates.length + 1,
      heatScore: Number(draftTemplate.heatScore || 70),
      tags: draftTemplate.tags
        .split(/[、,，]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
      premise: draftTemplate.premise,
      lead: draftTemplate.lead,
      rival: draftTemplate.rival,
      hook: draftTemplate.hook,
      beat: draftTemplate.beat,
      defaultParams: draftTemplate.defaultParams || selectedTemplate.defaultParams,
      isCustom: true,
    };

    setWorkspace((current) => {
      const existing = current.customTemplates || [];
      const nextCustomTemplates = existing.some((template) => template.id === nextTemplate.id)
        ? existing.map((template) => (template.id === nextTemplate.id ? nextTemplate : template))
        : [nextTemplate, ...existing];
      return {
        ...current,
        customTemplates: nextCustomTemplates,
      };
    });
    setDraftTemplate(createTemplateDraft(nextTemplate));
    setDraftBrief((brief) => ({ ...brief, templateId: nextTemplate.id }));
    setDraftParams(nextTemplate.defaultParams);
  }

  function editCustomTemplate(template) {
    setDraftTemplate({
      ...template,
      tags: (template.tags || []).join("、"),
    });
  }

  function deleteCustomTemplate(templateId) {
    setWorkspace((current) => ({
      ...current,
      customTemplates: (current.customTemplates || []).filter((template) => template.id !== templateId),
    }));
    if (draftBrief.templateId === templateId) {
      setDraftBrief((brief) => ({ ...brief, templateId: templates[0].id }));
      setDraftParams(templates[0].defaultParams);
    }
  }

  return (
    <div className="template-manager">
      <div className="template-manager-head">
        <div>
          <strong>{templateCatalog.length}</strong>
          <span>可用模板</span>
        </div>
        <div>
          <strong>{customTemplates.length}</strong>
          <span>团队自定义</span>
        </div>
      </div>

      <div className="template-form">
        <div className="two-col">
          <label>
            模板名
            <input
              value={draftTemplate.name}
              onChange={(event) => setDraftTemplate({ ...draftTemplate, name: event.target.value })}
            />
          </label>
          <label>
            类型
            <input
              list="template-type-options"
              value={draftTemplate.type}
              onChange={(event) => setDraftTemplate({ ...draftTemplate, type: event.target.value })}
            />
            <datalist id="template-type-options">
              {typeGroups.map((type) => (
                <option key={type} value={type} />
              ))}
              <option value="自定义" />
            </datalist>
          </label>
        </div>
        <label>
          标签
          <input value={draftTemplate.tags} onChange={(event) => setDraftTemplate({ ...draftTemplate, tags: event.target.value })} />
        </label>
        <label>
          钩子
          <textarea rows={2} value={draftTemplate.hook} onChange={(event) => setDraftTemplate({ ...draftTemplate, hook: event.target.value })} />
        </label>
        <label>
          模板主线
          <textarea rows={2} value={draftTemplate.beat} onChange={(event) => setDraftTemplate({ ...draftTemplate, beat: event.target.value })} />
        </label>
        <div className="two-col">
          <label>
            主角
            <input value={draftTemplate.lead} onChange={(event) => setDraftTemplate({ ...draftTemplate, lead: event.target.value })} />
          </label>
          <label>
            对手
            <input value={draftTemplate.rival} onChange={(event) => setDraftTemplate({ ...draftTemplate, rival: event.target.value })} />
          </label>
        </div>
        <div className="template-actions">
          <button className="secondary-action" type="button" onClick={resetFromSelected}>
            复制当前模板
          </button>
          <button className="secondary-action strong" type="button" onClick={saveCustomTemplate}>
            保存为团队模板
          </button>
        </div>
      </div>

      <div className="custom-template-list">
        {customTemplates.map((template) => (
          <div className="custom-template-row" key={template.id}>
            <button type="button" onClick={() => editCustomTemplate(template)}>
              <b>{template.name}</b>
              <span>{template.type} · {template.tags?.slice(0, 3).join(" / ")}</span>
            </button>
            <button type="button" onClick={() => deleteCustomTemplate(template.id)} title="删除自定义模板">
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        {customTemplates.length === 0 && <p className="muted-note">还没有团队自定义模板。可以复制当前模板后改写并保存。</p>}
      </div>
    </div>
  );
}

function formatOptionalDate(value) {
  return value ? formatDate(value) : "暂无";
}

export function OpsPanel({ storageStatus, aiLogState, analyticsState }) {
  const totals = aiLogState.totals || { count: 0, success: 0, tokens: 0, costUsd: 0 };
  const analyticsTotals = analyticsState?.totals || { pageViews: 0, uniqueVisitors: 0 };
  const landingStats = analyticsState?.pages?.landing || { pageViews: 0, uniqueVisitors: 0, lastVisitedAt: null };
  const workbenchStats = analyticsState?.pages?.workbench || { pageViews: 0, uniqueVisitors: 0, lastVisitedAt: null };
  const recentVisitAt = analyticsState?.recentEvents?.[0]?.createdAt || landingStats.lastVisitedAt || workbenchStats.lastVisitedAt;
  return (
    <div className="ops-panel">
      <div className="ops-status">
        <strong>{storageStatus}</strong>
        <span>AI 调用 {totals.count} 次 · 成功 {totals.success} 次</span>
        <span>Token {totals.tokens} · 估算成本 ${totals.costUsd}</span>
      </div>
      <div className="analytics-grid">
        <div>
          <span>落地页访问</span>
          <strong>{landingStats.pageViews}</strong>
          <small>{landingStats.uniqueVisitors} 独立访客</small>
        </div>
        <div>
          <span>工作台访问</span>
          <strong>{workbenchStats.pageViews}</strong>
          <small>{workbenchStats.uniqueVisitors} 独立访客</small>
        </div>
        <div>
          <span>总独立访客</span>
          <strong>{analyticsTotals.uniqueVisitors}</strong>
          <small>总访问 {analyticsTotals.pageViews}</small>
        </div>
        <div>
          <span>最近访问</span>
          <strong className="compact">{formatOptionalDate(recentVisitAt)}</strong>
          <small>本地匿名埋点</small>
        </div>
      </div>
      <div className="ai-log-list">
        {(aiLogState.logs || []).slice(0, 5).map((log) => (
          <p key={log.id}>
            <b>{log.status === "success" ? "成功" : "失败"}</b>
            {log.instruction} · {log.model || "unknown"}
            <small>
              {log.durationMs}ms · {formatDate(log.createdAt)}
            </small>
          </p>
        ))}
        {(!aiLogState.logs || aiLogState.logs.length === 0) && <p>暂无 AI 调用日志。</p>}
      </div>
    </div>
  );
}
