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
  Home,
  MessageSquare,
  PenLine,
  Plus,
  RefreshCcw,
  ScrollText,
  Sparkles,
  Target,
  Trash2,
  Users,
  Wand2,
} from "lucide-react";
import { defaultBrief, markets, templates, templateTypes } from "./data/templates";
import { lastTrendUpdated, marketNotes, templateSignals, trendTags } from "./data/trends";
import { createProject, createProjectFromVersion, getTemplate, mergeParams, rewriteVersion, scoreScript, uid } from "./lib/generator";
import { loadWorkspace, normalizeWorkspace, saveWorkspace } from "./lib/storage";
import { exportDoc, exportJson, exportText, printPdf } from "./lib/exporters";
import { generateVersionWithDeepSeek, rewriteVersionWithDeepSeek } from "./lib/deepseekClient";
import { fetchAiLogs, loadWorkspaceFromServer, saveWorkspaceToServer } from "./lib/workspaceApi";
import LandingPage from "./LandingPage.jsx";

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
  const [showLanding, setShowLanding] = useState(() => window.location.hash !== "#workbench");
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
  const backupInputRef = useRef(null);

  useEffect(() => {
    function syncRouteFromHash() {
      setShowLanding(window.location.hash !== "#workbench");
    }

    window.addEventListener("hashchange", syncRouteFromHash);
    window.addEventListener("popstate", syncRouteFromHash);
    return () => {
      window.removeEventListener("hashchange", syncRouteFromHash);
      window.removeEventListener("popstate", syncRouteFromHash);
    };
  }, []);

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
        setWorkspace(normalizeWorkspace(serverWorkspace));
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

  const templateCatalog = useMemo(() => {
    const customTemplates = workspace.customTemplates || [];
    return [...templates, ...customTemplates].sort((a, b) => {
      const aType = templateTypes.includes(a.type) ? templateTypes.indexOf(a.type) : templateTypes.length;
      const bType = templateTypes.includes(b.type) ? templateTypes.indexOf(b.type) : templateTypes.length;
      if (aType !== bType) return aType - bType;
      return Number(a.heatRank || 999) - Number(b.heatRank || 999);
    });
  }, [workspace.customTemplates]);

  const typeGroups = useMemo(() => {
    const customTypes = templateCatalog.map((template) => template.type).filter((type) => type && !templateTypes.includes(type));
    return [...templateTypes, ...Array.from(new Set(customTypes))];
  }, [templateCatalog]);

  const selectedTemplate = useMemo(() => getTemplate(draftBrief.templateId, templateCatalog), [draftBrief.templateId, templateCatalog]);

  const draftReadiness = useMemo(() => {
    const episodeCount = Number(draftBrief.episodeCount || 0);
    const checks = [
      { label: "项目名", done: Boolean(draftBrief.title?.trim()) },
      { label: "情绪痛点", done: Boolean(draftBrief.painPoint?.trim()) },
      { label: "目标观众", done: Boolean(draftBrief.audience?.trim()) },
      { label: "模板", done: Boolean(selectedTemplate?.id) },
      { label: "集数 12-40", done: episodeCount >= 12 && episodeCount <= 40 },
      { label: "钩子密度", done: Number(draftParams.hookDensity || 0) >= 45 },
    ];
    return {
      score: Math.round((checks.filter((item) => item.done).length / checks.length) * 100),
      checks,
    };
  }, [draftBrief, draftParams.hookDensity, selectedTemplate]);

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
    const template = getTemplate(templateId, templateCatalog);
    setDraftBrief((brief) => ({ ...brief, templateId }));
    setDraftParams(mergeParams(template));
  }

  async function handleCreateProject() {
    if (isGenerating) return;
    const episodeCount = Math.min(Math.max(Number(draftBrief.episodeCount || 24), 12), 40);
    const normalizedBrief = {
      ...draftBrief,
      title: draftBrief.title?.trim() || `${selectedTemplate.name} 实验项目`,
      painPoint: draftBrief.painPoint?.trim() || selectedTemplate.premise,
      audience: draftBrief.audience?.trim() || selectedTemplate.tags?.join(" / ") || "短剧核心观众",
      episodeCount,
    };

    setIsGenerating(true);
    setGenerationNotice("正在调用 DeepSeek 生成短剧项目...");
    let project;

    try {
      const version = await generateVersionWithDeepSeek({ brief: normalizedBrief, params: draftParams, templateCatalog });
      project = createProjectFromVersion({
        brief: normalizedBrief,
        version,
        notice: "已使用 DeepSeek 生成初版，可先检查前 3 集钩子、市场适配和合规风险。",
      });
      setGenerationNotice("DeepSeek 生成完成。");
    } catch (error) {
      project = createProject({ brief: normalizedBrief, params: draftParams, templateCatalog });
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
      const nextVersion = await rewriteVersionWithDeepSeek({ project: activeProject, activeVersion, instruction, templateCatalog });
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
        const rewritten = rewriteVersion(project, instruction, templateCatalog);
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

  function deleteActiveProject() {
    if (!activeProject) return;
    if (!window.confirm(`确认删除项目「${activeProject.name}」？该操作会从当前工作区移除项目和所有版本。`)) return;
    setWorkspace((current) => {
      const remaining = current.projects.filter((project) => project.id !== activeProject.id);
      return {
        ...current,
        projects: remaining,
        activeProjectId: remaining[0]?.id || "",
      };
    });
    setCompareVersionId("");
  }

  function exportWorkspaceBackup() {
    const blob = new Blob([JSON.stringify(workspace, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `djcytools-workspace-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function importWorkspaceBackup(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || ""));
        if (!Array.isArray(parsed.projects) || !parsed.team) throw new Error("备份文件结构不正确");
        setWorkspace(normalizeWorkspace(parsed));
        setStorageStatus("已从备份恢复，正在同步服务端");
      } catch (error) {
        setStorageStatus(`备份恢复失败：${error instanceof Error ? error.message : "未知错误"}`);
      }
    };
    reader.readAsText(file, "utf-8");
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

  function launchWorkbench() {
    window.location.hash = "workbench";
    setShowLanding(false);
    window.scrollTo({ top: 0 });
  }

  function openLanding() {
    window.history.pushState(null, "", `${window.location.pathname}${window.location.search}`);
    setShowLanding(true);
    window.scrollTo({ top: 0 });
  }

  if (showLanding) {
    return <LandingPage onLaunch={launchWorkbench} />;
  }

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

      <main className="workbench" id="workbench">
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
            <button className="segmented danger" type="button" onClick={deleteActiveProject} disabled={!activeProject || workspace.projects.length <= 1}>
              <Trash2 size={14} />
              删除项目
            </button>
            <button className="segmented quiet" type="button" onClick={openLanding}>
              <Home size={14} />
              落地页
            </button>
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
                  {typeGroups.map((type) => (
                    <optgroup label={type} key={type}>
                      {templateCatalog
                        .filter((template) => template.type === type)
                        .map((template) => (
                          <option value={template.id} key={template.id}>
                            #{template.heatRank} {template.name}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
              </label>
            </div>
            <TemplateBriefPreview template={selectedTemplate} />
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

            <DraftReadinessPanel readiness={draftReadiness} />
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
              <PanelHeader icon={ScrollText} eyebrow="TEMPLATES" title="模板库管理" />
              <TemplateManager
                workspace={workspace}
                setWorkspace={setWorkspace}
                templateCatalog={templateCatalog}
                typeGroups={typeGroups}
                draftBrief={draftBrief}
                setDraftBrief={setDraftBrief}
                setDraftParams={setDraftParams}
              />
            </section>

            <section className="panel">
              <PanelHeader icon={Users} eyebrow="TEAM" title="团队权限" />
              <TeamPanel workspace={workspace} setWorkspace={setWorkspace} />
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
              <OpsPanel
                storageStatus={storageStatus}
                aiLogState={aiLogState}
                exportWorkspaceBackup={exportWorkspaceBackup}
                importWorkspaceBackup={importWorkspaceBackup}
                backupInputRef={backupInputRef}
              />
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

function TemplateBriefPreview({ template }) {
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

function DraftReadinessPanel({ readiness }) {
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

  return (
    <div className="editor-content">
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

      <VersionMeta version={version} />

      <label>
        一句话卖点
        <textarea rows={3} value={version.logline} onChange={(event) => updateField("logline", event.target.value)} />
      </label>

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

      <div className="section-band">
        <h4>前 3 集脚本</h4>
        {episodes.map((episode, index) => (
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
                value={(episode.dialogue || []).join("\n")}
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

function TeamPanel({ workspace, setWorkspace }) {
  const members = workspace.team?.members || [];

  function patchTeam(patcher) {
    setWorkspace((current) => ({
      ...current,
      team: patcher(current.team || { name: "未命名团队", members: [] }),
    }));
  }

  function updateMember(index, field, value) {
    patchTeam((team) => ({
      ...team,
      members: team.members.map((member, itemIndex) => (itemIndex === index ? { ...member, [field]: value } : member)),
    }));
  }

  function addMember() {
    patchTeam((team) => ({
      ...team,
      members: [...team.members, { name: "新成员", role: "查看者" }],
    }));
  }

  function removeMember(index) {
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
        />
      </label>
      <div className="member-list">
        {members.map((member, index) => (
          <div className="member-row" key={`${member.name}-${index}`}>
            <input value={member.name} onChange={(event) => updateMember(index, "name", event.target.value)} />
            <select value={member.role} onChange={(event) => updateMember(index, "role", event.target.value)}>
              <option>所有者</option>
              <option>编辑者</option>
              <option>查看者</option>
            </select>
            <button type="button" onClick={() => removeMember(index)} title="移除成员">
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
      <button className="secondary-action" type="button" onClick={addMember}>
        <Plus size={15} />
        添加成员
      </button>
    </div>
  );
}

function TemplateManager({ workspace, setWorkspace, templateCatalog, typeGroups, draftBrief, setDraftBrief, setDraftParams }) {
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

function OpsPanel({ storageStatus, aiLogState, exportWorkspaceBackup, importWorkspaceBackup, backupInputRef }) {
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
      <div className="backup-actions">
        <button className="secondary-action" type="button" onClick={exportWorkspaceBackup}>
          <Download size={15} />
          导出工作区
        </button>
        <button className="secondary-action" type="button" onClick={() => backupInputRef.current?.click()}>
          <Archive size={15} />
          恢复备份
        </button>
        <input
          ref={backupInputRef}
          type="file"
          accept="application/json"
          hidden
          onChange={(event) => importWorkspaceBackup(event.target.files?.[0])}
        />
      </div>
    </div>
  );
}
