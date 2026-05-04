import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ChevronRight,
  Home,
  LogIn,
  LogOut,
  PenLine,
  Plus,
  Clapperboard,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import { defaultBrief, markets, templates, templateTypes } from "./data/templates";
import {
  analyzeCompliance,
  analyzeSimilarity,
  buildStoryboards,
  createProject,
  createProjectFromVersion,
  getTemplate,
  mergeParams,
  rewriteVersion,
  scoreScript,
  uid,
} from "./lib/generator";
import { loadWorkspace, normalizeWorkspace, saveWorkspace } from "./lib/storage";
import { generateVersionWithDeepSeek, rewriteVersionWithDeepSeek } from "./lib/deepseekClient";
import {
  fetchAiLogs,
  fetchAnalyticsSummary,
  fetchAuthSession,
  confirmPasswordReset,
  createProjectOnServer,
  deleteProjectOnServer,
  loadWorkspaceFromServer,
  login,
  logout,
  requestPasswordReset,
  register,
  saveWorkspaceToServer,
  trackPageView,
  updateProjectOnServer,
} from "./lib/workspaceApi";
import {
  DeliveryPanel,
  DraftReadinessPanel,
  ErrorNotice,
  PanelHeader,
  ScriptEditor,
  TemplateBriefPreview,
  VideoSamplePanel,
} from "./components/workbench/WorkbenchPanels.jsx";
import LandingPage from "./LandingPage.jsx";

const parameterMeta = [
  { key: "humiliation", label: "羞辱强度", min: "克制", max: "强刺激" },
  { key: "reversal", label: "反转频率", min: "慢铺垫", max: "高频" },
  { key: "sweet", label: "甜虐比例", min: "纯爽感", max: "情感补偿" },
  { key: "conflict", label: "冲突烈度", min: "内隐", max: "正面对抗" },
  { key: "hookDensity", label: "钩子密度", min: "长线", max: "投流向" },
];

const emptyAnalyticsState = {
  totals: { pageViews: 0, uniqueVisitors: 0 },
  pages: {
    landing: { pageViews: 0, uniqueVisitors: 0, lastVisitedAt: null },
    workbench: { pageViews: 0, uniqueVisitors: 0, lastVisitedAt: null },
  },
  recentEvents: [],
};

const unauthenticatedState = {
  status: "ready",
  authenticated: false,
  user: null,
  team: null,
  membership: null,
};

const workflowSteps = [
  {
    id: "setup",
    number: "1",
    icon: Sparkles,
    title: "项目设置",
    hint: "选模板、填创意、生成剧本",
  },
  {
    id: "script",
    number: "2",
    icon: PenLine,
    title: "剧本确认",
    hint: "看剧本、改分镜、保存确认",
  },
  {
    id: "video",
    number: "3",
    icon: Clapperboard,
    title: "生成视频",
    hint: "选集数、设比例、提交生成",
  },
];

function formatDate(value) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function updateVersionScore(version, candidates = []) {
  const withStoryboards = {
    ...version,
    storyboards: buildStoryboards(version),
  };
  const complianceReport = analyzeCompliance(withStoryboards);
  const similarityReport = analyzeSimilarity(withStoryboards, candidates);
  return {
    ...withStoryboards,
    complianceReport,
    similarityReport,
    score: scoreScript({ ...withStoryboards, complianceReport, similarityReport }),
  };
}

export default function App() {
  const [workbenchRequested, setWorkbenchRequested] = useState(() => window.location.hash === "#workbench");
  const [workspace, setWorkspace] = useState(() => loadWorkspace());
  const [draftBrief, setDraftBrief] = useState(defaultBrief);
  const [draftParams, setDraftParams] = useState(() => mergeParams(getTemplate(defaultBrief.templateId)));
  const [activeWorkflowStep, setActiveWorkflowStep] = useState("setup");
  const [commentText, setCommentText] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRewriting, setIsRewriting] = useState(false);
  const [generationNotice, setGenerationNotice] = useState("");
  const [actionError, setActionError] = useState(null);
  const [storageStatus, setStorageStatus] = useState("正在连接服务端工作区...");
  const [aiLogState, setAiLogState] = useState({ logs: [], totals: { count: 0, success: 0, tokens: 0, costUsd: 0 } });
  const [analyticsState, setAnalyticsState] = useState(emptyAnalyticsState);
  const [authState, setAuthState] = useState({ ...unauthenticatedState, status: "checking" });
  const [loginError, setLoginError] = useState("");
  const serverReadyRef = useRef(false);
  const saveTimerRef = useRef(null);
  const latestWorkspaceRef = useRef(workspace);
  const saveInFlightRef = useRef(false);
  const saveAgainRef = useRef(false);
  const isAuthenticated = Boolean(authState.authenticated);
  const currentRole = authState.membership?.role || "viewer";
  const canEdit = currentRole === "owner" || currentRole === "editor";
  const showLanding = !workbenchRequested || !isAuthenticated;

  useEffect(() => {
    function syncRouteFromHash() {
      setWorkbenchRequested(window.location.hash === "#workbench");
    }

    window.addEventListener("hashchange", syncRouteFromHash);
    window.addEventListener("popstate", syncRouteFromHash);
    return () => {
      window.removeEventListener("hashchange", syncRouteFromHash);
      window.removeEventListener("popstate", syncRouteFromHash);
    };
  }, []);

  useEffect(() => {
    fetchAuthSession()
      .then((session) => {
        setAuthState(session.authenticated ? { status: "ready", ...session } : unauthenticatedState);
      })
      .catch(() => {
        setAuthState(unauthenticatedState);
      });
  }, []);

  async function flushWorkspaceToServer() {
    if (!serverReadyRef.current || !isAuthenticated || !canEdit) return;
    if (saveInFlightRef.current) {
      saveAgainRef.current = true;
      setStorageStatus("服务端同步排队中");
      return;
    }

    saveInFlightRef.current = true;
    const workspaceSnapshot = latestWorkspaceRef.current;
    try {
      await saveWorkspaceToServer(workspaceSnapshot);
      setStorageStatus("服务端已同步");
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      setStorageStatus(`服务端同步失败：${message}`);
      setActionError({
        title: "服务端同步失败",
        message,
        detail: "本地缓存仍会保存当前工作区。确认服务端进程运行后会自动再次同步。",
        tone: "warning",
      });
    } finally {
      saveInFlightRef.current = false;
      if (saveAgainRef.current && serverReadyRef.current && isAuthenticated && canEdit) {
        saveAgainRef.current = false;
        if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = window.setTimeout(flushWorkspaceToServer, 1200);
      }
    }
  }

  useEffect(() => {
    latestWorkspaceRef.current = workspace;
    saveWorkspace(workspace);
    if (!serverReadyRef.current || !isAuthenticated || !canEdit) return;

    if (saveInFlightRef.current) {
      saveAgainRef.current = true;
      setStorageStatus("服务端同步排队中");
      return;
    }

    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(flushWorkspaceToServer, 1200);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [workspace, isAuthenticated, canEdit]);

  useEffect(() => {
    if (!isAuthenticated) {
      serverReadyRef.current = false;
      return;
    }
    loadWorkspaceFromServer()
      .then((serverWorkspace) => {
        serverReadyRef.current = true;
        setWorkspace(normalizeWorkspace(serverWorkspace));
        setStorageStatus("服务端工作区已连接");
      })
      .catch((error) => {
        serverReadyRef.current = false;
        const message = error instanceof Error ? error.message : "服务端不可用";
        setStorageStatus(`使用本地缓存：${message}`);
        setActionError({
          title: "正在使用本地缓存",
          message,
          detail: "可以继续生成和编辑；服务端恢复后再刷新或导入备份同步。",
          tone: "warning",
        });
    });
    refreshAiLogs();
    refreshAnalytics();
  }, [isAuthenticated]);

  useEffect(() => {
    const page = showLanding ? "landing" : "workbench";
    trackPageView(page)
      .then((data) => {
        if (data?.summary) setAnalyticsState(data.summary);
      })
      .catch(() => {
        refreshAnalytics();
      });
  }, [showLanding]);

  function refreshAiLogs() {
    fetchAiLogs()
      .then(setAiLogState)
      .catch(() => {
        setAiLogState({ logs: [], totals: { count: 0, success: 0, tokens: 0, costUsd: 0 } });
      });
  }

  function refreshAnalytics() {
    fetchAnalyticsSummary()
      .then(setAnalyticsState)
      .catch(() => setAnalyticsState(emptyAnalyticsState));
  }

  async function handleLogin({ email, password }) {
    setLoginError("");
    try {
      const session = await login(email, password);
      setAuthState({ status: "ready", ...session });
      setActionError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "登录失败";
      setLoginError(message);
    }
  }

  async function handleRegister({ email, password, name, teamName }) {
    setLoginError("");
    try {
      const session = await register({ email, password, name, teamName });
      setAuthState({ status: "ready", ...session });
      setActionError(null);
      return session;
    } catch (error) {
      const message = error instanceof Error ? error.message : "注册失败";
      setLoginError(message);
    }
  }

  async function handleRequestPasswordReset(email) {
    setLoginError("");
    try {
      const result = await requestPasswordReset(email);
      if (result.tokenExposed && result.token) {
        setLoginError(`本地开发模式重置 Token：${result.token}`);
      } else if (result.emailDelivery?.attempted && result.emailDelivery?.ok) {
        setLoginError("重置邮件已发送，请查收邮箱并复制邮件中的 Token。");
      } else if (result.emailDelivery?.attempted && !result.emailDelivery?.ok) {
        setLoginError(`重置请求已创建，但邮件发送失败：${result.emailDelivery.error || "请检查邮箱配置"}`);
      } else {
        setLoginError("如果邮箱存在，系统已创建重置请求。");
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "申请重置失败";
      setLoginError(message);
    }
  }

  async function handleConfirmPasswordReset({ token, password }) {
    setLoginError("");
    try {
      await confirmPasswordReset({ token, password });
      setLoginError("密码已重置，请使用新密码登录。");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "重置密码失败";
      setLoginError(message);
    }
  }

  async function handleLogout() {
    let logoutError = null;
    try {
      await logout();
    } catch (error) {
      logoutError = error;
    } finally {
      serverReadyRef.current = false;
      setAuthState(unauthenticatedState);
      setStorageStatus(logoutError ? "已在本地退出；服务端稍后会自动清理会话" : "已退出登录");
      setAiLogState({ logs: [], totals: { count: 0, success: 0, tokens: 0, costUsd: 0 } });
    }
  }

  const activeProject = useMemo(
    () => workspace.projects.find((project) => project.id === workspace.activeProjectId) || workspace.projects[0],
    [workspace],
  );

  const activeVersion = useMemo(() => {
    if (!activeProject) return null;
    return activeProject.versions.find((version) => version.id === activeProject.activeVersionId) || activeProject.versions[0];
  }, [activeProject]);

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
        version.id === activeVersion.id ? updateVersionScore(patcher(version), project.versions) : version,
      ),
    }));
  }

  function handleTemplateChange(templateId) {
    const template = getTemplate(templateId, templateCatalog);
    setDraftBrief((brief) => ({ ...brief, templateId }));
    setDraftParams(mergeParams(template));
  }

  function buildNormalizedBrief() {
    const episodeCount = Math.min(Math.max(Number(draftBrief.episodeCount || 24), 12), 40);
    return {
      ...draftBrief,
      title: draftBrief.title?.trim() || `${selectedTemplate.name} 实验项目`,
      painPoint: draftBrief.painPoint?.trim() || selectedTemplate.premise,
      audience: draftBrief.audience?.trim() || selectedTemplate.tags?.join(" / ") || "短剧核心观众",
      episodeCount,
    };
  }

  async function persistCreatedProject(project, successMessage = "项目已创建并同步") {
    setWorkspace((current) => ({
      ...current,
      activeProjectId: project.id,
      projects: [project, ...current.projects.filter((item) => item.id !== project.id)],
    }));

    if (!serverReadyRef.current || !isAuthenticated || !canEdit) return;
    try {
      await createProjectOnServer(project);
      setStorageStatus(successMessage);
    } catch (error) {
      const message = error instanceof Error ? error.message : "项目接口同步失败";
      setStorageStatus(`项目接口同步失败：${message}`);
      setActionError({
        title: "项目接口同步失败",
        message,
        detail: "项目已保存在本地缓存；自动工作区同步会继续尝试写入服务端。",
        tone: "warning",
      });
    }
  }

  async function handleCreateDraftProject() {
    if (!canEdit) return;
    const project = createProject({ brief: buildNormalizedBrief(), params: draftParams, templateCatalog });
    project.comments = [
      {
        id: uid("comment"),
        author: "系统",
        text: "已创建项目草稿，可继续编辑或调用 AI 改写。",
        createdAt: new Date().toISOString(),
      },
      ...project.comments,
    ];
    setGenerationNotice("已创建项目草稿。");
    setActionError(null);
    await persistCreatedProject(project, "项目草稿已创建并同步");
    setActiveWorkflowStep("script");
  }

  async function handleCreateProject() {
    if (isGenerating || !canEdit) return;
    const normalizedBrief = buildNormalizedBrief();

    setIsGenerating(true);
    setGenerationNotice("正在调用 AI 生成短剧项目...");
    let project;

    try {
      const version = await generateVersionWithDeepSeek({ brief: normalizedBrief, params: draftParams, templateCatalog });
      project = createProjectFromVersion({
        brief: normalizedBrief,
        version,
        notice: "已使用 AI 生成初版，可先检查前 3 集钩子、市场适配和分镜节奏。",
      });
      setGenerationNotice("AI 生成完成。");
      setActionError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      project = createProject({ brief: normalizedBrief, params: draftParams, templateCatalog });
      project.comments = [
        {
          id: uid("comment"),
          author: "系统",
          text: `AI 调用失败，已回退到本地模拟生成。原因：${message}`,
          createdAt: new Date().toISOString(),
        },
        ...project.comments,
      ];
      setGenerationNotice("AI 调用失败，已用本地模拟结果兜底。");
      setActionError({
        title: "AI 生成失败，已自动兜底",
        message,
        detail: "当前项目已由本地生成器创建，可继续编辑、生成视频和导出；AI 调用日志会记录这次失败。",
        tone: "warning",
      });
    }

    await persistCreatedProject(project, "AI 项目已创建并同步");
    setActiveWorkflowStep("script");
    setIsGenerating(false);
    refreshAiLogs();
  }

  async function handleRewrite(instruction) {
    if (!activeProject || !activeVersion || isRewriting || !canEdit) return;
    setIsRewriting(true);
    setGenerationNotice(`正在调用 AI 执行「${instruction}」...`);

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
              text: `已完成「${instruction}」，并生成新版本。`,
              createdAt: new Date().toISOString(),
            },
          ...project.comments,
        ],
      }));
      setGenerationNotice(`已完成「${instruction}」。`);
      setActionError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      patchWorkspaceProject(activeProject.id, (project) => {
        const rewritten = rewriteVersion(project, instruction, templateCatalog);
        return {
          ...rewritten,
          comments: [
            {
              id: uid("comment"),
              author: "系统",
              text: `AI 改写失败，已回退到本地模拟改写。原因：${message}`,
              createdAt: new Date().toISOString(),
            },
            ...rewritten.comments,
          ],
        };
      });
      setGenerationNotice("AI 改写失败，已用本地模拟结果兜底。");
      setActionError({
        title: "AI 改写失败，已自动兜底",
        message,
        detail: "已生成本地改写版本，可继续编辑或生成真实视频。",
        tone: "warning",
      });
    } finally {
      setIsRewriting(false);
      refreshAiLogs();
    }
  }

  function updateProjectDetails(projectId, patch) {
    if (!projectId || !canEdit) return;
    const nextPatch = { ...patch, updatedAt: new Date().toISOString() };
    patchWorkspaceProject(projectId, (project) => ({
      ...project,
      ...nextPatch,
      name: typeof nextPatch.name === "string" ? nextPatch.name.trim() || "未命名项目" : project.name,
      status: nextPatch.status || project.status,
    }));

    if (!serverReadyRef.current || !isAuthenticated) return;
    updateProjectOnServer(projectId, patch)
      .then(() => setStorageStatus("项目已更新并同步"))
      .catch((error) => {
        const message = error instanceof Error ? error.message : "项目更新同步失败";
        setStorageStatus(`项目更新同步失败：${message}`);
        setActionError({
          title: "项目更新同步失败",
          message,
          detail: "本地修改已保留；自动工作区同步会继续尝试写入服务端。",
          tone: "warning",
        });
      });
  }

  function addComment() {
    if (!activeProject || !commentText.trim() || !canEdit) return;
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
    if (!activeProject || !activeVersion || !canEdit) return;
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
  }

  function deleteProject(projectId) {
    if (!projectId || !canEdit) return;
    const targetProject = workspace.projects.find((project) => project.id === projectId);
    if (!targetProject) return;
    if (workspace.projects.length <= 1) {
      setActionError({
        title: "不能删除最后一个项目",
        message: "项目库至少需要保留一个项目。",
        tone: "warning",
      });
      return;
    }
    if (!window.confirm(`确认删除项目「${targetProject.name}」？该操作会移除项目和所有版本。`)) return;
    setWorkspace((current) => {
      const remaining = current.projects.filter((project) => project.id !== projectId);
      return {
        ...current,
        projects: remaining,
        activeProjectId: current.activeProjectId === projectId ? remaining[0]?.id || "" : current.activeProjectId,
      };
    });

    if (!serverReadyRef.current || !isAuthenticated) return;
    deleteProjectOnServer(projectId)
      .then(() => setStorageStatus("项目已删除并同步"))
      .catch((error) => {
        const message = error instanceof Error ? error.message : "项目删除同步失败";
        setStorageStatus(`项目删除同步失败：${message}`);
        setActionError({
          title: "项目删除同步失败",
          message,
          detail: "本地项目库已更新；自动工作区同步会继续尝试写入服务端。",
          tone: "warning",
        });
      });
  }

  function deleteActiveProject() {
    if (!activeProject) return;
    deleteProject(activeProject.id);
  }

  function confirmScriptAndGoVideo() {
    if (!activeVersion) {
      setActionError({
        title: "还没有可确认的剧本",
        message: "请先在第 1 步生成剧本，再进入视频生成。",
        tone: "warning",
      });
      setActiveWorkflowStep("setup");
      return;
    }
    setStorageStatus("剧本已确认，可以生成视频");
    setActionError(null);
    setActiveWorkflowStep("video");
  }

  const stats = {
    projects: workspace.projects.length,
    versions: workspace.projects.reduce((sum, project) => sum + project.versions.length, 0),
    exports: workspace.projects.reduce((sum, project) => sum + project.exports.length, 0),
  };
  const activeWorkflow = workflowSteps.find((step) => step.id === activeWorkflowStep) || workflowSteps[0];
  const scriptStateLabel = activeVersion ? "剧本已生成" : "等待生成剧本";
  const currentVersionLabel = activeVersion?.selectedTitle || activeVersion?.name || "未生成剧本";
  const currentEpisodeCount = activeVersion?.episodes?.length || 0;
  const currentMarketLabel = markets[draftBrief.market]?.label || draftBrief.market || "未选择";

  function launchWorkbench() {
    window.location.hash = "workbench";
    setWorkbenchRequested(true);
    window.scrollTo({ top: 0 });
  }

  function openLanding() {
    window.history.pushState(null, "", `${window.location.pathname}${window.location.search}`);
    setWorkbenchRequested(false);
    window.scrollTo({ top: 0 });
  }

  if (showLanding) {
    return (
      <>
        <LandingPage onLaunch={launchWorkbench} />
        {workbenchRequested &&
          (authState.status === "checking" ? (
            <AuthLoading embedded />
          ) : (
            <LoginScreen
              embedded
              error={loginError}
              onLogin={handleLogin}
              onRegister={handleRegister}
              onRequestPasswordReset={handleRequestPasswordReset}
              onConfirmPasswordReset={handleConfirmPasswordReset}
              onBack={openLanding}
            />
          ))}
      </>
    );
  }

  if (authState.status === "checking") {
    return <AuthLoading />;
  }

  if (!isAuthenticated) {
    return (
      <LoginScreen
        error={loginError}
        onLogin={handleLogin}
        onRegister={handleRegister}
        onRequestPasswordReset={handleRequestPasswordReset}
        onConfirmPasswordReset={handleConfirmPasswordReset}
        onBack={openLanding}
      />
    );
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

        <div className="rail-summary-card">
          <span>当前步骤</span>
          <strong>{activeWorkflow.title}</strong>
          <small>
            {stats.projects} 个项目 · {stats.versions} 个版本
          </small>
        </div>

        <div className="rail-section">
          <div className="section-title">
            <span>项目库</span>
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
                  <small>{project.versions.length} 版 · {project.updatedAt ? formatDate(project.updatedAt) : "未保存"}</small>
                </span>
                <ChevronRight size={16} />
              </button>
            ))}
          </div>
        </div>
      </aside>

      <main className="workbench" id="workbench">
        <div className="workbench-sticky-head">
          <header className="top-bar">
            <div>
              <p className="eyebrow">PROJECT WORKBENCH</p>
              <h2>{activeProject?.name || "新项目"}</h2>
            </div>
            <div className="top-actions">
              <span className="user-pill">
                <ShieldCheck size={14} />
                {authState.user?.name || "已登录"}
                <small>{authState.membership?.roleLabel || "查看者"}</small>
              </span>
              <button className="segmented danger" type="button" onClick={deleteActiveProject} disabled={!canEdit || !activeProject || workspace.projects.length <= 1}>
                <Trash2 size={14} />
                删除项目
              </button>
              <button className="segmented quiet" type="button" onClick={openLanding}>
                <Home size={14} />
                落地页
              </button>
              <button className="segmented quiet" type="button" onClick={handleLogout}>
                <LogOut size={14} />
                退出
              </button>
            </div>
          </header>

          <section className="workbench-status-strip" aria-label="运行状态">
            <div className="status-strip-main">
              <Activity size={15} />
              <strong>{storageStatus}</strong>
            </div>
            <span>当前项目：{activeProject?.name || "新项目"}</span>
            <span>{scriptStateLabel}</span>
            <span>当前：{activeWorkflow.title}</span>
          </section>

          <nav className="workflow-steps" aria-label="短视频生成步骤">
            {workflowSteps.map((step) => {
              const StepIcon = step.icon;
              const isActive = step.id === activeWorkflowStep;
              const isLocked = step.id !== "setup" && !activeVersion;
              return (
                <button
                  type="button"
                  key={step.id}
                  className={`workflow-step ${isActive ? "active" : ""}`}
                  onClick={() => setActiveWorkflowStep(isLocked ? "setup" : step.id)}
                  aria-current={isActive ? "step" : undefined}
                >
                  <span>{step.number}</span>
                  <StepIcon size={16} />
                  <strong>{step.title}</strong>
                  <small>{isLocked ? "先生成剧本" : step.hint}</small>
                </button>
              );
            })}
          </nav>
        </div>

        {actionError && <ErrorNotice error={actionError} onClose={() => setActionError(null)} />}
        {generationNotice && activeWorkflowStep !== "setup" && <p className="generation-notice workflow-global-notice">{generationNotice}</p>}

        <div className="workflow-layout">
          <section className="workflow-panel setup-step" hidden={activeWorkflowStep !== "setup"}>
            <div className="workflow-stage-card">
              <PanelHeader icon={Sparkles} eyebrow="STEP 1" title="项目设置">
                <div className="stage-header-summary">
                  <span><b>当前项目</b>{activeProject?.name || draftBrief.title || "未创建"}</span>
                  <span><b>模板</b>{selectedTemplate?.name || "未选择"}</span>
                  <span><b>市场</b>{currentMarketLabel}</span>
                  <span><b>集数</b>{draftBrief.episodeCount}集</span>
                  <span><b>准备度</b>{draftReadiness.score}%</span>
                </div>
              </PanelHeader>

              <div className="setup-form-grid">
                <div className="setup-form-main">
                  <div className="creative-project-card" aria-label="当前项目">
                    <label>
                      当前项目
                      <select value={activeProject?.id || ""} onChange={(event) => selectProject(event.target.value)} disabled={workspace.projects.length === 0}>
                        {workspace.projects.map((project) => (
                          <option value={project.id} key={project.id}>
                            {project.name} · {project.versions.length}版
                          </option>
                        ))}
                      </select>
                    </label>
                    <button className="secondary-action" type="button" onClick={handleCreateDraftProject} disabled={!canEdit}>
                      <Plus size={14} />
                      保存草稿
                    </button>
                    <div className="creative-project-meta">
                      <span>{activeProject?.versions?.length || 0} 个版本</span>
                      <span>{activeProject?.updatedAt ? formatDate(activeProject.updatedAt) : "未同步"}</span>
                    </div>
                  </div>

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
                  <label>
                    创意和情绪痛点
                    <textarea
                      className="brief-main-textarea"
                      rows={3}
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
                      className="brief-short-textarea"
                      rows={1}
                      value={draftBrief.forbidden}
                      onChange={(event) => setDraftBrief({ ...draftBrief, forbidden: event.target.value })}
                    />
                  </label>

                  <details className="advanced-settings">
                    <summary>高级设置</summary>
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
                  </details>
                </div>

                <aside className="setup-side-card">
                  <TemplateBriefPreview template={selectedTemplate} />
                  <DraftReadinessPanel readiness={draftReadiness} />
                  {generationNotice && <p className="generation-notice">{generationNotice}</p>}
                  <button className="primary-action" type="button" onClick={handleCreateProject} disabled={isGenerating || !canEdit}>
                    <Wand2 size={18} />
                    {isGenerating ? "AI 生成中..." : canEdit ? "生成剧本" : "查看者无生成权限"}
                  </button>
                  {activeVersion && (
                    <button className="secondary-action" type="button" onClick={() => setActiveWorkflowStep("script")}>
                      查看当前剧本
                    </button>
                  )}
                </aside>
              </div>
            </div>
          </section>

          <section className="workflow-panel script-step" hidden={activeWorkflowStep !== "script"}>
            <div className="workflow-stage-card">
              <PanelHeader icon={PenLine} eyebrow="STEP 2" title="剧本确认">
                <div className="stage-header-summary with-action">
                  <span><b>当前剧本</b>{currentVersionLabel}</span>
                  <span><b>剧集</b>{currentEpisodeCount || "未生成"}</span>
                  <span><b>保存</b>自动保存</span>
                  <span><b>下一步</b>确认后生成视频</span>
                </div>
                <button className="primary-action compact-primary" type="button" onClick={confirmScriptAndGoVideo} disabled={!activeVersion}>
                  确认剧本，进入生成视频
                </button>
              </PanelHeader>
              {activeVersion ? (
                <>
                  <ScriptEditor
                    version={activeVersion}
                    patchActiveVersion={patchActiveVersion}
                    onRewrite={handleRewrite}
                    isRewriting={isRewriting || !canEdit}
                  />
                  {activeProject && (
                    <details className="workflow-more-actions">
                      <summary>导出与备注</summary>
                      <DeliveryPanel
                        project={activeProject}
                        version={activeVersion}
                        commentText={commentText}
                        setCommentText={setCommentText}
                        addComment={addComment}
                        recordExport={recordExport}
                      />
                    </details>
                  )}
                </>
              ) : (
                <div className="empty-state">还没有剧本。请先回到第 1 步生成剧本。</div>
              )}
            </div>
          </section>

          <section className="workflow-panel video-step" hidden={activeWorkflowStep !== "video"}>
            <div className="workflow-stage-card">
              <PanelHeader icon={Clapperboard} eyebrow="STEP 3" title="生成视频">
                <div className="stage-header-summary with-action">
                  <span><b>当前剧本</b>{currentVersionLabel}</span>
                  <span><b>剧集</b>{currentEpisodeCount || "未生成"}</span>
                  <span><b>单集</b>15秒</span>
                  <span><b>范围</b>可批量生成</span>
                </div>
                <button className="secondary-action" type="button" onClick={() => setActiveWorkflowStep("script")}>
                  返回改剧本
                </button>
              </PanelHeader>
              {activeProject && activeVersion ? (
                <VideoSamplePanel
                  project={activeProject}
                  activeVersion={activeVersion}
                  canEdit={canEdit}
                />
              ) : (
                <div className="empty-state">还没有可用于生成视频的剧本。请先完成第 1 步和第 2 步。</div>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

function AuthLoading({ embedded = false }) {
  const content = (
    <div className={`auth-panel ${embedded ? "auth-panel-floating" : ""}`}>
        <div className="brand-mark">
          <ScrollText size={22} />
        </div>
        <p className="eyebrow">DJCYTOOLS</p>
        <h1>正在校验登录状态</h1>
      </div>
  );
  if (embedded) {
    return (
      <div className="auth-modal-backdrop" role="status" aria-live="polite">
        <div className="auth-modal-frame">{content}</div>
      </div>
    );
  }
  return <main className="auth-shell">{content}</main>;
}

function LoginScreen({ error, onLogin, onRegister, onRequestPasswordReset, onConfirmPasswordReset, onBack, embedded = false }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("admin@djcytools.local");
  const [name, setName] = useState("");
  const [teamName, setTeamName] = useState("");
  const [password, setPassword] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [resetRequested, setResetRequested] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const isRegister = mode === "register";
  const isReset = mode === "reset";

  async function submit(event) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      if (isReset && resetToken.trim()) {
        await onConfirmPasswordReset({ token: resetToken, password });
        setMode("login");
        setPassword("");
        setResetToken("");
        setResetRequested(false);
      } else if (isReset) {
        const result = await onRequestPasswordReset(email);
        if (result?.ok) {
          setResetRequested(true);
          if (result?.tokenExposed && result.token) setResetToken(result.token);
        }
      } else if (isRegister) {
        await onRegister({ email, password, name, teamName });
      } else {
        await onLogin({ email, password });
      }
    } finally {
      setSubmitting(false);
    }
  }

  function switchMode(nextMode) {
    setMode(nextMode);
    if (nextMode === "register" && email === "admin@djcytools.local") setEmail("");
    if (nextMode !== "reset") {
      setResetRequested(false);
      setResetToken("");
    }
  }

  const form = (
      <form className={`auth-panel ${embedded ? "auth-panel-floating" : ""}`} onSubmit={submit}>
        <div className="brand-mark">
          <ScrollText size={22} />
        </div>
        <p className="eyebrow">SOLO STUDIO</p>
        <h1 id="workbench-login-title">{isReset ? "重置账号密码" : isRegister ? "注册短剧叙事工厂" : "登录短剧叙事工厂"}</h1>
        <div className="auth-tabs" role="tablist" aria-label="账号入口">
          <button className={mode === "login" ? "selected" : ""} type="button" onClick={() => switchMode("login")}>
            登录
          </button>
          <button className={isRegister ? "selected" : ""} type="button" onClick={() => switchMode("register")}>
            邮箱注册
          </button>
          <button className={isReset ? "selected" : ""} type="button" onClick={() => switchMode("reset")}>
            重置密码
          </button>
        </div>
        <label>
          邮箱
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" />
        </label>
        {isRegister && (
          <label>
            姓名
            <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" />
          </label>
        )}
        {isRegister && (
          <label>
            工作台名称
            <input value={teamName} onChange={(event) => setTeamName(event.target.value)} placeholder="例如：我的短视频工作台" />
          </label>
        )}
        {isReset && (
          <label>
            邮件 Token
            <textarea rows={2} value={resetToken} onChange={(event) => setResetToken(event.target.value)} placeholder="先发送重置邮件，再粘贴邮件里的 Token" />
          </label>
        )}
        {(!isReset || resetToken.trim()) && (
          <label>
            密码
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={isRegister || isReset ? "new-password" : "current-password"}
              minLength={isRegister || isReset ? 8 : undefined}
            />
          </label>
        )}
        {isRegister && <p className="muted-note">注册后会创建你的个人工作台；如已配置 SMTP，会同步发送注册邮件。</p>}
        {isReset && (
          <p className="muted-note">
            {resetRequested || resetToken.trim() ? "收到 Token 后输入新密码即可完成重置。" : "先输入邮箱发送重置邮件；本地开发未配置邮件时会直接显示 Token。"}
          </p>
        )}
        {error && <p className="auth-error">{error}</p>}
        <button className="primary-action" type="submit" disabled={submitting}>
          <LogIn size={18} />
          {submitting
            ? "处理中..."
            : isReset
                ? resetToken.trim()
                  ? "确认重置密码"
                  : "发送重置邮件"
                : isRegister
                  ? "注册并进入工作台"
                  : "登录工作台"}
        </button>
        <button className="secondary-action" type="button" onClick={onBack}>
          <Home size={15} />
          返回首页
        </button>
      </form>
  );
  if (embedded) {
    return (
      <div className="auth-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="workbench-login-title">
        <div className="auth-modal-frame">{form}</div>
      </div>
    );
  }
  return <main className="auth-shell">{form}</main>;
}
