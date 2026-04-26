import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Archive,
  BarChart3,
  BookOpenText,
  Check,
  ChevronRight,
  ClipboardList,
  Download,
  FileJson,
  FileText,
  Flame,
  Gauge,
  GitCompare,
  MessageSquare,
  PenLine,
  Plus,
  RefreshCcw,
  ScrollText,
  Sparkles,
  Wand2,
} from "lucide-react";
import { defaultBrief, markets, templates } from "./data/templates";
import { lastTrendUpdated, marketNotes, templateSignals, trendTags } from "./data/trends";
import { createProject, createProjectFromVersion, getTemplate, mergeParams, rewriteVersion, scoreScript, uid } from "./lib/generator";
import { loadWorkspace, saveWorkspace } from "./lib/storage";
import { exportDoc, exportJson, exportText, printPdf } from "./lib/exporters";
import { generateVersionWithDeepSeek, rewriteVersionWithDeepSeek } from "./lib/deepseekClient";
import { fetchAiLogs, loadWorkspaceFromServer, saveWorkspaceToServer } from "./lib/workspaceApi";

const parameterMeta = [
  { key: "humiliation", label: "羞辱强度", min: "克制", max: "强刺激" },
  { key: "reversal", label: "反转频率", min: "慢铺垫", max: "高频" },
  { key: "sweet", label: "甜虐比例", min: "纯爽感", max: "情感补偿" },
  { key: "conflict", label: "冲突烈度", min: "内隐", max: "正面对抗" },
  { key: "hookDensity", label: "钩子密度", min: "长线", max: "投流向" },
];

function formatDate(value) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function updateVersionScore(version) {
  return { ...version, score: scoreScript(version) };
}

export default function App() {
  const [workspace, setWorkspace] = useState(() => loadWorkspace());
  const [draftBrief, setDraftBrief] = useState(defaultBrief);
  const [draftParams, setDraftParams] = useState(() => mergeParams(getTemplate(defaultBrief.templateId)));
  const [compareVersionId, setCompareVersionId] = useState("");
  const [commentText, setCommentText] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRewriting, setIsRewriting] = useState(false);
  const [generationNotice, setGenerationNotice] = useState("");
  const [storageStatus, setStorageStatus] = useState("正在连接服务端工作区...");
  const [aiLogState, setAiLogState] = useState({ logs: [], totals: { count: 0, success: 0, tokens: 0, costUsd: 0 } });
  const serverReadyRef = useRef(false);
  const saveTimerRef = useRef(null);

  useEffect(() => {
    saveWorkspace(workspace);
    if (!serverReadyRef.current) return;

    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveWorkspaceToServer(workspace)
        .then(() => setStorageStatus("服务端已同步"))
        .catch((error) => setStorageStatus(`服务端同步失败：${error instanceof Error ? error.message : "未知错误"}`));
    }, 450);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [workspace]);

  useEffect(() => {
    loadWorkspaceFromServer()
      .then((serverWorkspace) => {
        serverReadyRef.current = true;
        setWorkspace(serverWorkspace);
        setStorageStatus("服务端工作区已连接");
      })
      .catch((error) => {
        serverReadyRef.current = false;
        setStorageStatus(`使用本地缓存：${error instanceof Error ? error.message : "服务端不可用"}`);
      });
    refreshAiLogs();
  }, []);

  function refreshAiLogs() {
    fetchAiLogs()
      .then(setAiLogState)
      .catch(() => {
        setAiLogState({ logs: [], totals: { count: 0, success: 0, tokens: 0, costUsd: 0 } });
      });
  }

  const activeProject = useMemo(
    () => workspace.projects.find((project) => project.id === workspace.activeProjectId) || workspace.projects[0],
    [workspace],
  );

  const activeVersion = useMemo(() => {
    if (!activeProject) return null;
    return activeProject.versions.find((version) => version.id === activeProject.activeVersionId) || activeProject.versions[0];
  }, [activeProject]);

  const compareVersion = useMemo(() => {
    if (!activeProject) return null;
    return activeProject.versions.find((version) => version.id === compareVersionId) || activeProject.versions[1] || null;
  }, [activeProject, compareVersionId]);

  function patchWorkspaceProject(projectId, patcher) {
    setWorkspace((current) => ({
      ...current,
      projects: current.projects.map((project) => (project.id === projectId ? patcher(project) : project)),
    }));
  }

  function patchActiveVersion(patcher) {
    if (!activeProject || !activeVersion) return;
    patchWorkspaceProject(activeProject.id, (project) => ({
      ...project,
      updatedAt: new Date().toISOString(),
      versions: project.versions.map((version) =>
        version.id === activeVersion.id ? updateVersionScore(patcher(version)) : version,
      ),
    }));
  }

  function handleTemplateChange(templateId) {
    const template = getTemplate(templateId);
    setDraftBrief((brief) => ({ ...brief, templateId }));
    setDraftParams(mergeParams(template));
  }

  async function handleCreateProject() {
    if (isGenerating) return;
    setIsGenerating(true);
    setGenerationNotice("正在调用 DeepSeek 生成短剧项目...");
    let project;

    try {
      const version = await generateVersionWithDeepSeek({ brief: draftBrief, params: draftParams });
      project = createProjectFromVersion({
        brief: draftBrief,
        version,
        notice: "已使用 DeepSeek 生成初版，可先检查前 3 集钩子、市场适配和合规风险。",
      });
      setGenerationNotice("DeepSeek 生成完成。");
    } catch (error) {
      project = createProject({ brief: draftBrief, params: draftParams });
      project.comments = [
        {
          id: uid("comment"),
          author: "系统",
          text: `DeepSeek 调用失败，已回退到本地模拟生成。原因：${error instanceof Error ? error.message : "未知错误"}`,
          createdAt: new Date().toISOString(),
        },
        ...project.comments,
      ];
      setGenerationNotice("DeepSeek 调用失败，已用本地模拟结果兜底。");
    }

      setWorkspace((current) => ({
        ...current,
        activeProjectId: project.id,
        projects: [project, ...current.projects],
      }));
    setCompareVersionId("");
    setIsGenerating(false);
    refreshAiLogs();
  }

  async function handleRewrite(instruction) {
    if (!activeProject || !activeVersion || isRewriting) return;
    const previousVersionId = activeVersion.id;
    setIsRewriting(true);
    setGenerationNotice(`正在调用 DeepSeek 执行「${instruction}」...`);

    try {
      const nextVersion = await rewriteVersionWithDeepSeek({ project: activeProject, activeVersion, instruction });
      patchWorkspaceProject(activeProject.id, (project) => ({
        ...project,
        activeVersionId: nextVersion.id,
        updatedAt: new Date().toISOString(),
        versions: [nextVersion, ...project.versions],
        comments: [
          {
            id: uid("comment"),
            author: "系统",
            text: `已使用 DeepSeek 完成「${instruction}」，并生成新版本。`,
            createdAt: new Date().toISOString(),
          },
          ...project.comments,
        ],
      }));
      setCompareVersionId(previousVersionId);
      setGenerationNotice(`DeepSeek 已完成「${instruction}」。`);
    } catch (error) {
      patchWorkspaceProject(activeProject.id, (project) => {
        const rewritten = rewriteVersion(project, instruction);
        return {
          ...rewritten,
          comments: [
            {
              id: uid("comment"),
              author: "系统",
              text: `DeepSeek 改写失败，已回退到本地模拟改写。原因：${error instanceof Error ? error.message : "未知错误"}`,
              createdAt: new Date().toISOString(),
            },
            ...rewritten.comments,
          ],
        };
      });
      setCompareVersionId(previousVersionId);
      setGenerationNotice("DeepSeek 改写失败，已用本地模拟结果兜底。");
    } finally {
      setIsRewriting(false);
      refreshAiLogs();
    }
  }

  function handleProjectStatus(status) {
    if (!activeProject) return;
    patchWorkspaceProject(activeProject.id, (project) => ({ ...project, status, updatedAt: new Date().toISOString() }));
  }

  function addComment() {
    if (!activeProject || !commentText.trim()) return;
    const comment = {
      id: uid("comment"),
      author: "团队成员",
      text: commentText.trim(),
      createdAt: new Date().toISOString(),
    };
    patchWorkspaceProject(activeProject.id, (project) => ({
      ...project,
      comments: [comment, ...project.comments],
      updatedAt: new Date().toISOString(),
    }));
    setCommentText("");
  }

  function recordExport(type, exporter) {
    if (!activeProject || !activeVersion) return;
    exporter(activeProject, activeVersion);
    patchWorkspaceProject(activeProject.id, (project) => ({
      ...project,
      exports: [
        { id: uid("export"), type, version: activeVersion.name, createdAt: new Date().toISOString() },
        ...project.exports,
      ],
    }));
  }

  function selectProject(projectId) {
    setWorkspace((current) => ({ ...current, activeProjectId: projectId }));
    setCompareVersionId("");
  }

  const stats = {
    projects: workspace.projects.length,
    versions: workspace.projects.reduce((sum, project) => sum + project.versions.length, 0),
    exports: workspace.projects.reduce((sum, project) => sum + project.exports.length, 0),
    avgScore: Math.round(
      workspace.projects.reduce((sum, project) => sum + (project.versions[0]?.score?.total || 0), 0) /
        Math.max(workspace.projects.length, 1),
    ),
  };

  return (
    <div className="app-shell">
      <aside className="side-rail">
        <div className="brand-lockup">
          <div className="brand-mark">
            <ScrollText size={22} />
          </div>
          <div>
            <p className="eyebrow">DJCYTOOLS</p>
            <h1>短剧叙事工厂</h1>
          </div>
        </div>

        <div className="metric-stack">
          <Metric icon={BookOpenText} label="项目" value={stats.projects} />
          <Metric icon={GitCompare} label="版本" value={stats.versions} />
          <Metric icon={Gauge} label="均分" value={stats.avgScore} />
          <Metric icon={Download} label="导出" value={stats.exports} />
        </div>

        <div className="rail-section">
          <div className="section-title">
            <span>项目库</span>
            <button className="icon-button" type="button" onClick={handleCreateProject} title="按当前参数生成新项目" disabled={isGenerating}>
              <Plus size={16} />
            </button>
          </div>
          <div className="project-list">
            {workspace.projects.map((project) => (
              <button
                className={`project-row ${project.id === activeProject?.id ? "active" : ""}`}
                key={project.id}
                type="button"
                onClick={() => selectProject(project.id)}
              >
                <span>
                  <strong>{project.name}</strong>
                  <small>
                    {project.status} · {project.versions.length} 版
                  </small>
                </span>
                <ChevronRight size={16} />
              </button>
            ))}
          </div>
        </div>
      </aside>

      <main className="workbench">
        <header className="top-bar">
          <div>
            <p className="eyebrow">PROJECT WORKBENCH</p>
            <h2>{activeProject?.name || "新项目"}</h2>
          </div>
          <div className="top-actions">
            {["草稿", "评审中", "已定稿", "已导出"].map((status) => (
              <button
                key={status}
                type="button"
                className={`segmented ${activeProject?.status === status ? "selected" : ""}`}
                onClick={() => handleProjectStatus(status)}
              >
                {activeProject?.status === status && <Check size={14} />}
                {status}
              </button>
            ))}
          </div>
        </header>

        <div className="bench-grid">
          <section className="panel input-panel">
            <PanelHeader icon={Sparkles} eyebrow="GENERATOR" title="创意输入" />
            <label>
              项目名
              <input value={draftBrief.title} onChange={(event) => setDraftBrief({ ...draftBrief, title: event.target.value })} />
            </label>
            <div className="two-col">
              <label>
                目标市场
                <select value={draftBrief.market} onChange={(event) => setDraftBrief({ ...draftBrief, market: event.target.value })}>
                  {Object.entries(markets).map(([id, market]) => (
                    <option value={id} key={id}>
                      {market.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                模板
                <select value={draftBrief.templateId} onChange={(event) => handleTemplateChange(event.target.value)}>
                  {templates.map((template) => (
                    <option value={template.id} key={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              情绪痛点
              <textarea
                rows={4}
                value={draftBrief.painPoint}
                onChange={(event) => setDraftBrief({ ...draftBrief, painPoint: event.target.value })}
              />
            </label>
            <div className="two-col">
              <label>
                目标观众
                <input value={draftBrief.audience} onChange={(event) => setDraftBrief({ ...draftBrief, audience: event.target.value })} />
              </label>
              <label>
                集数
                <input
                  type="number"
                  min="12"
                  max="40"
                  value={draftBrief.episodeCount}
                  onChange={(event) => setDraftBrief({ ...draftBrief, episodeCount: Number(event.target.value) })}
                />
              </label>
            </div>
            <label>
              禁忌内容
              <textarea
                rows={2}
                value={draftBrief.forbidden}
                onChange={(event) => setDraftBrief({ ...draftBrief, forbidden: event.target.value })}
              />
            </label>

            <div className="slider-group">
              {parameterMeta.map((param) => (
                <label className="range-line" key={param.key}>
                  <span>
                    {param.label}
                    <b>{draftParams[param.key]}</b>
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={draftParams[param.key]}
                    onChange={(event) => setDraftParams({ ...draftParams, [param.key]: Number(event.target.value) })}
                  />
                  <small>
                    {param.min}
                    <em>{param.max}</em>
                  </small>
                </label>
              ))}
            </div>

            {generationNotice && <p className="generation-notice">{generationNotice}</p>}
            <button className="primary-action" type="button" onClick={handleCreateProject} disabled={isGenerating}>
              <Wand2 size={18} />
              {isGenerating ? "DeepSeek 生成中..." : "生成短剧项目"}
            </button>
          </section>

          <section className="panel editor-panel">
            <PanelHeader icon={PenLine} eyebrow="SCRIPT EDITOR" title="结构化剧本" />
            {activeVersion ? (
              <ScriptEditor
                version={activeVersion}
                patchActiveVersion={patchActiveVersion}
                onRewrite={handleRewrite}
                isRewriting={isRewriting}
              />
            ) : (
              <div className="empty-state">创建项目后开始编辑。</div>
            )}
          </section>

          <aside className="right-stack">
            <section className="panel score-panel">
              <PanelHeader icon={Gauge} eyebrow="QUALITY" title="AI 评分" />
              {activeVersion && <ScoreCard version={activeVersion} onRewrite={handleRewrite} isRewriting={isRewriting} />}
            </section>

            <section className="panel">
              <PanelHeader icon={Activity} eyebrow="VERSIONS" title="版本实验" />
              {activeProject && activeVersion && (
                <VersionPanel
                  project={activeProject}
                  activeVersion={activeVersion}
                  compareVersion={compareVersion}
                  compareVersionId={compareVersionId}
                  setCompareVersionId={setCompareVersionId}
                  setWorkspace={setWorkspace}
                />
              )}
            </section>

            <section className="panel">
              <PanelHeader icon={BarChart3} eyebrow="TRENDS" title="数据洞察" />
              <TrendPanel setDraftBrief={setDraftBrief} />
            </section>

            <section className="panel">
              <PanelHeader icon={Download} eyebrow="DELIVERY" title="导出与协作" />
              {activeProject && activeVersion && (
                <DeliveryPanel
                  project={activeProject}
                  version={activeVersion}
                  commentText={commentText}
                  setCommentText={setCommentText}
                  addComment={addComment}
                  recordExport={recordExport}
                />
              )}
            </section>

            <section className="panel">
              <PanelHeader icon={Target} eyebrow="OPS" title="运行状态" />
              <OpsPanel storageStatus={storageStatus} aiLogState={aiLogState} />
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}

function Metric({ icon: Icon, label, value }) {
  return (
    <div className="metric">
      <Icon size={17} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PanelHeader({ icon: Icon, eyebrow, title }) {
  return (
    <div className="panel-header">
      <div className="panel-icon">
        <Icon size={17} />
      </div>
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h3>{title}</h3>
      </div>
    </div>
  );
}

function ScriptEditor({ version, patchActiveVersion, onRewrite, isRewriting }) {
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

  return (
    <div className="editor-content">
      <div className="title-candidates">
        {version.titleCandidates.map((title) => (
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

      <VersionMeta version={version} />

      <label>
        一句话卖点
        <textarea rows={3} value={version.logline} onChange={(event) => updateField("logline", event.target.value)} />
      </label>

      <div className="quick-actions">
        {["提高冲突", "生成投流钩子", "降低狗血度", "本地化表达"].map((item) => (
          <button key={item} type="button" onClick={() => onRewrite(item)} disabled={isRewriting}>
            <RefreshCcw size={15} />
            {isRewriting ? "改写中..." : item}
          </button>
        ))}
      </div>

      <div className="section-band">
        <h4>人物卡</h4>
        <div className="character-grid">
          {version.characters.map((character, index) => (
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
          {version.outline.map((arc, index) => (
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

      <div className="section-band">
        <h4>前 3 集脚本</h4>
        {version.episodes.map((episode, index) => (
          <article className="episode-editor" key={episode.number}>
            <div className="episode-head">
              <strong>第 {episode.number} 集</strong>
              <input value={episode.title} onChange={(event) => updateEpisode(index, "title", event.target.value)} />
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
              <textarea rows={4} value={episode.script} onChange={(event) => updateEpisode(index, "script", event.target.value)} />
            </label>
            <label>
              核心对白
              <textarea
                rows={2}
                value={episode.dialogue.join("\n")}
                onChange={(event) => updateEpisode(index, "dialogue", event.target.value)}
              />
            </label>
          </article>
        ))}
      </div>
    </div>
  );
}

function VersionMeta({ version }) {
  const usage = version.usage || {};
  return (
    <div className="version-meta">
      <span>{version.source || "本地生成"}</span>
      {version.model && <span>{version.model}</span>}
      {typeof usage.total_tokens === "number" && <span>{usage.total_tokens} tokens</span>}
      {typeof version.costUsd === "number" && <span>${version.costUsd}</span>}
      {version.requestId && <span>{version.requestId}</span>}
      <span>{formatDate(version.createdAt)}</span>
    </div>
  );
}

function ScoreCard({ version, onRewrite, isRewriting }) {
  return (
    <div>
      <div className="score-dial">
        <span>{version.score.total}</span>
        <small>综合分</small>
      </div>
      <div className="score-bars">
        {version.score.dimensions.map((item) => (
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
            {isRewriting ? "DeepSeek 改写中..." : suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}

function VersionPanel({ project, activeVersion, compareVersion, compareVersionId, setCompareVersionId, setWorkspace }) {
  function setActiveVersion(versionId) {
    setWorkspace((current) => ({
      ...current,
      projects: current.projects.map((item) =>
        item.id === project.id ? { ...item, activeVersionId: versionId, updatedAt: new Date().toISOString() } : item,
      ),
    }));
  }

  return (
    <div className="version-panel">
      <label>
        对比版本
        <select value={compareVersionId} onChange={(event) => setCompareVersionId(event.target.value)}>
          <option value="">自动选择上一版</option>
          {project.versions
            .filter((version) => version.id !== activeVersion.id)
            .map((version) => (
              <option key={version.id} value={version.id}>
                {version.name}
              </option>
            ))}
        </select>
      </label>
      {compareVersion && (
        <div className="compare-box">
          <div>
            <span>当前</span>
            <strong>{activeVersion.score.total}</strong>
            <small>{activeVersion.name}</small>
          </div>
          <div>
            <span>对照</span>
            <strong>{compareVersion.score.total}</strong>
            <small>{compareVersion.name}</small>
          </div>
        </div>
      )}
      <div className="version-list">
        {project.versions.map((version) => (
          <button
            key={version.id}
            type="button"
            className={version.id === activeVersion.id ? "version-row active" : "version-row"}
            onClick={() => setActiveVersion(version.id)}
          >
            <span>
              <b>{version.name}</b>
              <small>
                {formatDate(version.createdAt)} · {version.templateName} · {version.source || "本地生成"}
              </small>
            </span>
            <strong>{version.score.total}</strong>
          </button>
        ))}
      </div>
    </div>
  );
}

function TrendPanel({ setDraftBrief }) {
  function applyTag(tag) {
    setDraftBrief((brief) => ({
      ...brief,
      painPoint: `${tag.tag}：围绕${tag.fit}设计前 3 集。`,
    }));
  }

  return (
    <div className="trend-panel">
      <p className="timestamp">更新：{lastTrendUpdated}</p>
      <div className="trend-list">
        {trendTags.map((tag) => (
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
        {templateSignals.map((signal) => (
          <div className="signal" key={signal.name}>
            <b>{signal.name}</b>
            <span>保存 {signal.saveRate}%</span>
            <span>导出 {signal.exportRate}%</span>
            <strong>{signal.score}</strong>
          </div>
        ))}
      </div>
      <div className="market-note-list">
        {marketNotes.map((note) => (
          <p key={note.market}>
            <b>{note.market}</b>
            {note.note}
          </p>
        ))}
      </div>
    </div>
  );
}

function DeliveryPanel({ project, version, commentText, setCommentText, addComment, recordExport }) {
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
          团队评论
          <textarea rows={2} value={commentText} onChange={(event) => setCommentText(event.target.value)} />
        </label>
        <button type="button" onClick={addComment}>
          <MessageSquare size={15} />
          添加评论
        </button>
      </div>

      <div className="activity-list">
        {project.comments.map((comment) => (
          <p key={comment.id}>
            <b>{comment.author}</b>
            {comment.text}
            <small>{formatDate(comment.createdAt)}</small>
          </p>
        ))}
        {project.exports.map((item) => (
          <p key={item.id}>
            <b>{item.type}</b>
            已导出 {item.version}
            <small>{formatDate(item.createdAt)}</small>
          </p>
        ))}
      </div>
    </div>
  );
}

function OpsPanel({ storageStatus, aiLogState }) {
  const totals = aiLogState.totals || { count: 0, success: 0, tokens: 0, costUsd: 0 };
  return (
    <div className="ops-panel">
      <div className="ops-status">
        <strong>{storageStatus}</strong>
        <span>AI 调用 {totals.count} 次 · 成功 {totals.success} 次</span>
        <span>Token {totals.tokens} · 估算成本 ${totals.costUsd}</span>
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
