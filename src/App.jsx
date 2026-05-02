import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  BarChart3,
  BookOpenText,
  Check,
  ChevronRight,
  Download,
  Gauge,
  GitCompare,
  Home,
  KeyRound,
  LogIn,
  LogOut,
  MonitorPlay,
  PenLine,
  Plus,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Store,
  Target,
  Trash2,
  TrendingUp,
  Users,
  Wand2,
} from "lucide-react";
import { defaultBrief, markets, templates, templateTypes } from "./data/templates";
import {
  analyzeCompliance,
  analyzeSimilarity,
  buildStoryboards,
  createInteractiveExperience,
  createProject,
  createProjectFromVersion,
  getTemplate,
  mergeParams,
  rewriteVersion,
  scoreScript,
  uid,
} from "./lib/generator";
import { loadWorkspace, normalizeWorkspace, saveWorkspace } from "./lib/storage";
import { calculateCampaignMetrics } from "./lib/exporters";
import { generateVersionWithDeepSeek, rewriteVersionWithDeepSeek } from "./lib/deepseekClient";
import {
  fetchAiLogs,
  fetchAnalyticsSummary,
  fetchAuditLogs,
  fetchAuthSession,
  fetchHealth,
  fetchNotificationOutbox,
  fetchPublicApiTokens,
  fetchStorageMigrationPlan,
  fetchTeamInvites,
  fetchTemplateInsights,
  fetchTrendSnapshots,
  fetchTrendSummary,
  acceptInvite,
  changePassword,
  confirmPasswordReset,
  createPublicApiToken,
  createTeamInvite,
  createProjectOnServer,
  deleteProjectOnServer,
  deliverNotificationWebhook,
  downloadPostgresMigrationSql,
  importTrendSnapshot,
  loadWorkspaceFromServer,
  login,
  logout,
  requestPasswordReset,
  register,
  removeTeamMember,
  revokePublicApiToken,
  saveWorkspaceToServer,
  trackPageView,
  updateNotificationDelivery,
  updateTeamMember,
  updateProjectOnServer,
} from "./lib/workspaceApi";
import {
  CampaignPanel,
  AccountSecurityPanel,
  ApiHandoffPanel,
  CompliancePanel,
  DeliveryPanel,
  DraftReadinessPanel,
  ErrorNotice,
  InteractivePanel,
  Metric,
  OpsPanel,
  PanelHeader,
  ProjectManagementPanel,
  ScoreCard,
  SecurityPanel,
  ScriptEditor,
  StoryboardPanel,
  TeamPanel,
  TemplateBriefPreview,
  TemplateMarketplacePanel,
  TemplateManager,
  TrendPanel,
  VersionPanel,
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
  const [showLanding, setShowLanding] = useState(() => window.location.hash !== "#workbench");
  const [workspace, setWorkspace] = useState(() => loadWorkspace());
  const [draftBrief, setDraftBrief] = useState(defaultBrief);
  const [draftParams, setDraftParams] = useState(() => mergeParams(getTemplate(defaultBrief.templateId)));
  const [compareVersionId, setCompareVersionId] = useState("");
  const [commentText, setCommentText] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRewriting, setIsRewriting] = useState(false);
  const [generationNotice, setGenerationNotice] = useState("");
  const [actionError, setActionError] = useState(null);
  const [storageStatus, setStorageStatus] = useState("正在连接服务端工作区...");
  const [aiLogState, setAiLogState] = useState({ logs: [], totals: { count: 0, success: 0, tokens: 0, costUsd: 0 } });
  const [analyticsState, setAnalyticsState] = useState(emptyAnalyticsState);
  const [auditState, setAuditState] = useState({ logs: [] });
  const [inviteState, setInviteState] = useState({ invites: [], lastInvite: null });
  const [notificationState, setNotificationState] = useState({ notifications: [], webhookConfigured: false });
  const [templateInsights, setTemplateInsights] = useState([]);
  const [trendSummary, setTrendSummary] = useState(null);
  const [trendSnapshots, setTrendSnapshots] = useState([]);
  const [migrationPlan, setMigrationPlan] = useState(null);
  const [healthState, setHealthState] = useState(null);
  const [apiTokenState, setApiTokenState] = useState({ tokens: [], lastToken: null, envTokenConfigured: false });
  const [authState, setAuthState] = useState({ ...unauthenticatedState, status: "checking" });
  const [loginError, setLoginError] = useState("");
  const serverReadyRef = useRef(false);
  const saveTimerRef = useRef(null);
  const backupInputRef = useRef(null);
  const isAuthenticated = Boolean(authState.authenticated);
  const currentRole = authState.membership?.role || "viewer";
  const canEdit = currentRole === "owner" || currentRole === "editor";
  const canManageTeam = currentRole === "owner";

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
    fetchAuthSession()
      .then((session) => {
        setAuthState(session.authenticated ? { status: "ready", ...session } : unauthenticatedState);
      })
      .catch(() => {
        setAuthState(unauthenticatedState);
      });
  }, []);

  useEffect(() => {
    saveWorkspace(workspace);
    if (!serverReadyRef.current || !isAuthenticated || !canEdit) return;

    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveWorkspaceToServer(workspace)
        .then(() => setStorageStatus("服务端已同步"))
        .catch((error) => {
          const message = error instanceof Error ? error.message : "未知错误";
          setStorageStatus(`服务端同步失败：${message}`);
          setActionError({
            title: "服务端同步失败",
            message,
            detail: "本地缓存仍会保存当前工作区。确认服务端进程运行后会自动再次同步。",
            tone: "warning",
          });
        });
    }, 450);
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
    refreshTemplateInsights();
    refreshTrendSummary();
    refreshSecurityData();
    refreshHealth();
    refreshApiTokens();
  }, [isAuthenticated, canManageTeam]);

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

  function refreshTemplateInsights() {
    fetchTemplateInsights()
      .then((data) => setTemplateInsights(data.insights || []))
      .catch(() => setTemplateInsights([]));
  }

  function refreshTrendSummary() {
    fetchTrendSummary()
      .then(setTrendSummary)
      .catch(() => setTrendSummary(null));
    fetchTrendSnapshots()
      .then((data) => setTrendSnapshots(data.snapshots || []))
      .catch(() => setTrendSnapshots([]));
  }

  function refreshSecurityData() {
    if (!canManageTeam) {
      setAuditState({ logs: [] });
      setInviteState((current) => ({ ...current, invites: [] }));
      setNotificationState({ notifications: [], webhookConfigured: false });
      setMigrationPlan(null);
      return;
    }
    fetchAuditLogs()
      .then(setAuditState)
      .catch(() => setAuditState({ logs: [] }));
    fetchNotificationOutbox()
      .then((data) => setNotificationState({ notifications: data.notifications || [], webhookConfigured: Boolean(data.webhookConfigured) }))
      .catch(() => setNotificationState({ notifications: [], webhookConfigured: false }));
    fetchTeamInvites()
      .then((data) => setInviteState((current) => ({ ...current, invites: data.invites || [] })))
      .catch(() => setInviteState((current) => ({ ...current, invites: [] })));
    fetchStorageMigrationPlan()
      .then(setMigrationPlan)
      .catch(() => setMigrationPlan(null));
  }

  function refreshHealth() {
    fetchHealth()
      .then(setHealthState)
      .catch(() => setHealthState(null));
  }

  function refreshApiTokens() {
    if (!canManageTeam) {
      setApiTokenState({ tokens: [], lastToken: null, envTokenConfigured: false });
      return;
    }
    fetchPublicApiTokens()
      .then((data) =>
        setApiTokenState((current) => ({
          tokens: data.tokens || [],
          lastToken: current.lastToken,
          envTokenConfigured: Boolean(data.envTokenConfigured),
        })),
      )
      .catch(() => setApiTokenState({ tokens: [], lastToken: null, envTokenConfigured: false }));
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
    } catch (error) {
      const message = error instanceof Error ? error.message : "注册失败";
      setLoginError(message);
    }
  }

  async function handleAcceptInvite({ token, password, name }) {
    setLoginError("");
    try {
      const session = await acceptInvite({ token, password, name });
      setAuthState({ status: "ready", ...session });
      setActionError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "接受邀请失败";
      setLoginError(message);
    }
  }

  async function handleRequestPasswordReset(email) {
    setLoginError("");
    try {
      const result = await requestPasswordReset(email);
      setLoginError(result.token ? `重置 Token：${result.token}` : "如果邮箱存在，系统已生成重置 Token。");
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
    } catch (error) {
      const message = error instanceof Error ? error.message : "重置密码失败";
      setLoginError(message);
    }
  }

  async function handleChangePassword({ currentPassword, newPassword }) {
    try {
      await changePassword({ currentPassword, newPassword });
      setActionError({
        title: "密码已更新",
        message: "当前会话已保留，其他设备上的会话已失效。",
        tone: "warning",
      });
      refreshSecurityData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "密码更新失败";
      setActionError({ title: "密码更新失败", message, tone: "error" });
    }
  }

  async function handleLogout() {
    try {
      await logout();
    } finally {
      serverReadyRef.current = false;
      setAuthState(unauthenticatedState);
      setStorageStatus("已退出登录");
      setAiLogState({ logs: [], totals: { count: 0, success: 0, tokens: 0, costUsd: 0 } });
      setAuditState({ logs: [] });
      setInviteState({ invites: [], lastInvite: null });
      setTemplateInsights([]);
      setTrendSummary(null);
      setTrendSnapshots([]);
      setMigrationPlan(null);
      setHealthState(null);
      setApiTokenState({ tokens: [], lastToken: null, envTokenConfigured: false });
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
    setCompareVersionId("");

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
        text: "已创建项目草稿，可继续编辑或调用 DeepSeek 改写。",
        createdAt: new Date().toISOString(),
      },
      ...project.comments,
    ];
    setGenerationNotice("已创建项目草稿。");
    setActionError(null);
    await persistCreatedProject(project, "项目草稿已创建并同步");
  }

  async function handleCreateProject() {
    if (isGenerating || !canEdit) return;
    const normalizedBrief = buildNormalizedBrief();

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
      setActionError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      project = createProject({ brief: normalizedBrief, params: draftParams, templateCatalog });
      project.comments = [
        {
          id: uid("comment"),
          author: "系统",
          text: `DeepSeek 调用失败，已回退到本地模拟生成。原因：${message}`,
          createdAt: new Date().toISOString(),
        },
        ...project.comments,
      ];
      setGenerationNotice("DeepSeek 调用失败，已用本地模拟结果兜底。");
      setActionError({
        title: "DeepSeek 生成失败，已自动兜底",
        message,
        detail: "当前项目已由本地生成器创建，可继续编辑、评分、导出；AI 调用日志会记录这次失败。",
        tone: "warning",
      });
    }

    await persistCreatedProject(project, "DeepSeek 项目已创建并同步");
    setIsGenerating(false);
    refreshAiLogs();
  }

  async function handleRewrite(instruction) {
    if (!activeProject || !activeVersion || isRewriting || !canEdit) return;
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
              text: `DeepSeek 改写失败，已回退到本地模拟改写。原因：${message}`,
              createdAt: new Date().toISOString(),
            },
            ...rewritten.comments,
          ],
        };
      });
      setCompareVersionId(previousVersionId);
      setGenerationNotice("DeepSeek 改写失败，已用本地模拟结果兜底。");
      setActionError({
        title: "DeepSeek 改写失败，已自动兜底",
        message,
        detail: "已生成本地改写版本，并保留上一版作为对照。",
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

  function handleProjectStatus(status) {
    if (!activeProject || !canEdit) return;
    updateProjectDetails(activeProject.id, { status });
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

  function addCampaignResult(result) {
    if (!activeProject || !activeVersion || !canEdit) return;
    const metrics = calculateCampaignMetrics(result);
    patchWorkspaceProject(activeProject.id, (project) => ({
      ...project,
      updatedAt: new Date().toISOString(),
      campaignResults: [
        {
          id: uid("campaign"),
          versionId: activeVersion.id,
          versionName: activeVersion.name,
          templateName: activeVersion.templateName,
          createdAt: new Date().toISOString(),
          ...result,
          metrics,
        },
        ...(project.campaignResults || []),
      ],
    }));
    refreshTemplateInsights();
    refreshTrendSummary();
  }

  async function handleCreateInvite(invite) {
    if (!canManageTeam) return;
    try {
      const data = await createTeamInvite(invite);
      setInviteState((current) => ({
        invites: [data.invite, ...(current.invites || [])],
        lastInvite: data.invite,
      }));
      setActionError({
        title: "邀请已生成",
        message: `已为 ${data.invite.email} 生成邀请 Token。`,
        detail: "通知正文已进入本地发件箱，可复制给成员后标记投递状态。",
        tone: "warning",
      });
      refreshSecurityData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "创建邀请失败";
      setActionError({ title: "创建邀请失败", message, tone: "error" });
    }
  }

  async function handleUpdateNotificationDelivery(notificationId, status) {
    if (!canManageTeam) return;
    try {
      const data = await updateNotificationDelivery(notificationId, status);
      setNotificationState((current) => ({
        notifications: (current.notifications || []).map((item) => (item.id === notificationId ? data.notification : item)),
      }));
      refreshSecurityData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "通知状态更新失败";
      setActionError({ title: "通知状态更新失败", message, tone: "error" });
    }
  }

  async function handleDeliverNotificationWebhook(notificationId) {
    if (!canManageTeam) return;
    try {
      const data = await deliverNotificationWebhook(notificationId);
      setNotificationState((current) => ({
        ...current,
        notifications: (current.notifications || []).map((item) => (item.id === notificationId ? data.notification : item)),
      }));
      setActionError({
        title: data.ok ? "Webhook 已发送" : "Webhook 投递失败",
        message: data.ok ? "通知已通过配置的企业 IM/Webhook 通道投递。" : data.error || `Webhook 返回 ${data.httpStatus || "失败"}`,
        detail: data.ok ? "" : "通知已标记为失败，可检查 Webhook 地址、签名配置或目标服务日志后重试。",
        tone: data.ok ? "warning" : "error",
      });
      refreshSecurityData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Webhook 投递失败";
      setActionError({ title: "Webhook 投递失败", message, tone: "error" });
      refreshSecurityData();
    }
  }

  async function handleUpdateTeamMember(memberId, patch) {
    if (!canManageTeam) return;
    try {
      const nextWorkspace = await updateTeamMember(memberId, patch);
      serverReadyRef.current = true;
      setWorkspace(normalizeWorkspace(nextWorkspace));
      setStorageStatus("团队成员权限已同步");
      refreshSecurityData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "成员更新失败";
      setActionError({ title: "成员权限同步失败", message, tone: "error" });
      loadWorkspaceFromServer().then((serverWorkspace) => setWorkspace(normalizeWorkspace(serverWorkspace))).catch(() => {});
    }
  }

  async function handleRemoveTeamMember(memberId, member) {
    if (!canManageTeam) return;
    if (!window.confirm(`确认移除成员「${member?.name || "该成员"}」？`)) return;
    try {
      const nextWorkspace = await removeTeamMember(memberId);
      serverReadyRef.current = true;
      setWorkspace(normalizeWorkspace(nextWorkspace));
      setStorageStatus("团队成员已移除");
      refreshSecurityData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "成员移除失败";
      setActionError({ title: "成员移除失败", message, tone: "error" });
    }
  }

  function handleCreateInteractiveExperience({ mood, persona }) {
    if (!activeProject || !activeVersion || !canEdit) return;
    const experience = createInteractiveExperience({ project: activeProject, version: activeVersion, mood, persona });
    patchWorkspaceProject(activeProject.id, (project) => ({
      ...project,
      updatedAt: new Date().toISOString(),
      interactiveExperiences: [experience, ...(project.interactiveExperiences || [])],
      comments: [
        {
          id: uid("comment"),
          author: "系统",
          text: `已生成 C 端互动体验「${experience.name}」。`,
          createdAt: new Date().toISOString(),
        },
        ...project.comments,
      ],
    }));
  }

  async function handleDownloadPostgresExport() {
    if (!canManageTeam) return;
    try {
      await downloadPostgresMigrationSql();
      setActionError({
        title: "PostgreSQL 迁移包已导出",
        message: "SQL 文件包含当前团队的项目、版本、模板、投流、AI 日志和审计记录。",
        tone: "warning",
      });
      refreshSecurityData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "导出失败";
      setActionError({ title: "PostgreSQL 迁移包导出失败", message, tone: "error" });
    }
  }

  async function handleCreateApiToken(name) {
    if (!canManageTeam) return;
    try {
      const data = await createPublicApiToken(name);
      setApiTokenState((current) => ({
        envTokenConfigured: current.envTokenConfigured,
        tokens: [data.token, ...(current.tokens || [])],
        lastToken: data.token,
      }));
      setActionError({
        title: "团队 API Token 已生成",
        message: "Token 只显示一次，请立即保存到第三方制作流程。",
        detail: "公开接口会按该 Token 所属团队限制项目范围。",
        tone: "warning",
      });
      refreshSecurityData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Token 生成失败";
      setActionError({ title: "Token 生成失败", message, tone: "error" });
    }
  }

  async function handleRevokeApiToken(tokenId) {
    if (!canManageTeam) return;
    if (!window.confirm("确认撤销这个 API Token？外部系统将无法继续使用它。")) return;
    try {
      await revokePublicApiToken(tokenId);
      setApiTokenState((current) => ({
        ...current,
        tokens: (current.tokens || []).map((token) =>
          token.id === tokenId ? { ...token, revokedAt: new Date().toISOString() } : token,
        ),
        lastToken: current.lastToken?.id === tokenId ? null : current.lastToken,
      }));
      refreshApiTokens();
      refreshSecurityData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Token 撤销失败";
      setActionError({ title: "Token 撤销失败", message, tone: "error" });
    }
  }

  async function handleImportTrendSnapshot(rawValue) {
    if (!canEdit) return;
    try {
      const parsed = JSON.parse(rawValue);
      const data = await importTrendSnapshot(parsed);
      setActionError({
        title: "趋势快照已导入",
        message: `${data.snapshot.source} 已成为团队趋势参考。`,
        detail: "数据洞察会优先使用最新导入快照，并叠加团队投流回流信号。",
        tone: "warning",
      });
      refreshTrendSummary();
      refreshSecurityData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "导入失败";
      setActionError({ title: "趋势快照导入失败", message, detail: "请确认 JSON 包含 source、tags、templateSignals 或 marketNotes。", tone: "error" });
    }
  }

  function selectProject(projectId) {
    setWorkspace((current) => ({ ...current, activeProjectId: projectId }));
    setCompareVersionId("");
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
    setCompareVersionId("");

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
    if (!file || !canEdit) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || ""));
        if (!Array.isArray(parsed.projects) || !parsed.team) throw new Error("备份文件结构不正确");
        setWorkspace(normalizeWorkspace(parsed));
        setStorageStatus("已从备份恢复，正在同步服务端");
      } catch (error) {
        const message = error instanceof Error ? error.message : "未知错误";
        setStorageStatus(`备份恢复失败：${message}`);
        setActionError({
          title: "备份恢复失败",
          message,
          detail: "请确认导入的是 DJCYTools 工作区 JSON 文件。",
          tone: "error",
        });
      }
    };
    reader.readAsText(file, "utf-8");
  }

  const stats = {
    projects: workspace.projects.length,
    versions: workspace.projects.reduce((sum, project) => sum + project.versions.length, 0),
    exports: workspace.projects.reduce((sum, project) => sum + project.exports.length, 0),
    campaigns: workspace.projects.reduce((sum, project) => sum + (project.campaignResults?.length || 0), 0),
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

  if (authState.status === "checking") {
    return <AuthLoading />;
  }

  if (!isAuthenticated) {
    return (
      <LoginScreen
        error={loginError}
        onLogin={handleLogin}
        onRegister={handleRegister}
        onAcceptInvite={handleAcceptInvite}
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

        <div className="metric-stack">
          <Metric icon={BookOpenText} label="项目" value={stats.projects} />
          <Metric icon={GitCompare} label="版本" value={stats.versions} />
          <Metric icon={Gauge} label="均分" value={stats.avgScore} />
          <Metric icon={Download} label="导出" value={stats.exports} />
          <Metric icon={TrendingUp} label="投流" value={stats.campaigns} />
        </div>

        <div className="rail-section">
          <div className="section-title">
            <span>项目库</span>
            <button className="icon-button" type="button" onClick={handleCreateProject} title="按当前参数生成新项目" disabled={isGenerating || !canEdit}>
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
            <span className="user-pill">
              <ShieldCheck size={14} />
              {authState.user?.name || "已登录"}
              <small>{authState.membership?.roleLabel || "查看者"}</small>
            </span>
            {["草稿", "评审中", "已定稿", "已导出"].map((status) => (
              <button
                key={status}
                type="button"
                className={`segmented ${activeProject?.status === status ? "selected" : ""}`}
                onClick={() => handleProjectStatus(status)}
                disabled={!canEdit}
              >
                {activeProject?.status === status && <Check size={14} />}
                {status}
              </button>
            ))}
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

        {actionError && <ErrorNotice error={actionError} onClose={() => setActionError(null)} />}

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
            <button className="primary-action" type="button" onClick={handleCreateProject} disabled={isGenerating || !canEdit}>
              <Wand2 size={18} />
              {isGenerating ? "DeepSeek 生成中..." : canEdit ? "生成短剧项目" : "查看者无生成权限"}
            </button>
          </section>

          <section className="panel editor-panel">
            <PanelHeader icon={PenLine} eyebrow="SCRIPT EDITOR" title="结构化剧本" />
            {activeVersion ? (
              <ScriptEditor
                version={activeVersion}
                patchActiveVersion={patchActiveVersion}
                onRewrite={handleRewrite}
                isRewriting={isRewriting || !canEdit}
              />
            ) : (
              <div className="empty-state">创建项目后开始编辑。</div>
            )}
          </section>

          <aside className="right-stack">
            <section className="panel">
              <PanelHeader icon={BookOpenText} eyebrow="PROJECTS" title="项目管理" />
              <ProjectManagementPanel
                projects={workspace.projects}
                activeProjectId={activeProject?.id || workspace.activeProjectId}
                canEdit={canEdit}
                isGenerating={isGenerating}
                onSelectProject={selectProject}
                onCreateDraftProject={handleCreateDraftProject}
                onGenerateProject={handleCreateProject}
                onUpdateProject={updateProjectDetails}
                onDeleteProject={deleteProject}
              />
            </section>

            <section className="panel score-panel">
              <PanelHeader icon={Gauge} eyebrow="QUALITY" title="AI 评分" />
              {activeVersion && <ScoreCard version={activeVersion} onRewrite={handleRewrite} isRewriting={isRewriting || !canEdit} />}
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
              <TrendPanel
                setDraftBrief={setDraftBrief}
                trendSummary={trendSummary}
                trendSnapshots={trendSnapshots}
                canImportTrends={canEdit}
                onRefreshTrends={refreshTrendSummary}
                onImportTrendSnapshot={handleImportTrendSnapshot}
              />
            </section>

            <section className="panel">
              <PanelHeader icon={ShieldAlert} eyebrow="REVIEW" title="合规与相似度" />
              {activeVersion && <CompliancePanel version={activeVersion} />}
            </section>

            <section className="panel">
              <PanelHeader icon={MonitorPlay} eyebrow="STORYBOARD" title="分镜建议" />
              {activeVersion && <StoryboardPanel version={activeVersion} />}
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
              <PanelHeader icon={Store} eyebrow="MARKETPLACE" title="模板市场" />
              <TemplateMarketplacePanel
                workspace={workspace}
                setWorkspace={setWorkspace}
                templateInsights={templateInsights}
                setDraftBrief={setDraftBrief}
                setDraftParams={setDraftParams}
              />
            </section>

            <section className="panel">
              <PanelHeader icon={Users} eyebrow="TEAM" title="团队权限" />
              <TeamPanel
                workspace={workspace}
                setWorkspace={setWorkspace}
                canManageTeam={canManageTeam}
                onUpdateMember={handleUpdateTeamMember}
                onRemoveMember={handleRemoveTeamMember}
              />
            </section>

            <section className="panel">
              <PanelHeader icon={ShieldCheck} eyebrow="SECURITY" title="邀请与审计" />
              <SecurityPanel
                canManageTeam={canManageTeam}
                inviteState={inviteState}
                notificationState={notificationState}
                auditState={auditState}
                migrationPlan={migrationPlan}
                onCreateInvite={handleCreateInvite}
                onUpdateNotificationDelivery={handleUpdateNotificationDelivery}
                onDeliverNotificationWebhook={handleDeliverNotificationWebhook}
                onRefreshSecurity={refreshSecurityData}
              />
            </section>

            <section className="panel">
              <PanelHeader icon={KeyRound} eyebrow="ACCOUNT" title="账号安全" />
              <AccountSecurityPanel user={authState.user} onChangePassword={handleChangePassword} />
            </section>

            <section className="panel">
              <PanelHeader icon={Target} eyebrow="API" title="交付接口" />
              <ApiHandoffPanel
                activeProject={activeProject}
                healthState={healthState}
                migrationPlan={migrationPlan}
                apiTokenState={apiTokenState}
                canManageTokens={canManageTeam}
                onCreateApiToken={handleCreateApiToken}
                onRevokeApiToken={handleRevokeApiToken}
                onDownloadPostgresExport={handleDownloadPostgresExport}
              />
            </section>

            <section className="panel">
              <PanelHeader icon={Wand2} eyebrow="INTERACTIVE" title="互动短剧" />
              {activeProject && activeVersion && (
                <InteractivePanel
                  project={activeProject}
                  activeVersion={activeVersion}
                  onCreateInteractiveExperience={handleCreateInteractiveExperience}
                />
              )}
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
              <PanelHeader icon={TrendingUp} eyebrow="CAMPAIGN" title="投流回流" />
              {activeProject && activeVersion && (
                <CampaignPanel project={activeProject} activeVersion={activeVersion} onAddResult={addCampaignResult} />
              )}
            </section>

            <section className="panel">
              <PanelHeader icon={Target} eyebrow="OPS" title="运行状态" />
              <OpsPanel
                storageStatus={storageStatus}
                aiLogState={aiLogState}
                analyticsState={analyticsState}
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

function AuthLoading() {
  return (
    <main className="auth-shell">
      <div className="auth-panel">
        <div className="brand-mark">
          <ScrollText size={22} />
        </div>
        <p className="eyebrow">DJCYTOOLS</p>
        <h1>正在校验登录状态</h1>
      </div>
    </main>
  );
}

function LoginScreen({ error, onLogin, onRegister, onAcceptInvite, onRequestPasswordReset, onConfirmPasswordReset, onBack }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("admin@djcytools.local");
  const [name, setName] = useState("");
  const [teamName, setTeamName] = useState("");
  const [password, setPassword] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const isRegister = mode === "register";
  const isInvite = mode === "invite";
  const isReset = mode === "reset";

  async function submit(event) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      if (isInvite) {
        await onAcceptInvite({ token: inviteToken, password, name });
      } else if (isReset && resetToken.trim()) {
        await onConfirmPasswordReset({ token: resetToken, password });
      } else if (isReset) {
        await onRequestPasswordReset(email);
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
    if (nextMode === "invite") setEmail("");
  }

  return (
    <main className="auth-shell">
      <form className="auth-panel" onSubmit={submit}>
        <div className="brand-mark">
          <ScrollText size={22} />
        </div>
        <p className="eyebrow">TEAM WORKSPACE</p>
        <h1>{isInvite ? "接受团队邀请" : isReset ? "重置账号密码" : isRegister ? "注册短剧叙事工厂" : "登录短剧叙事工厂"}</h1>
        <div className="auth-tabs" role="tablist" aria-label="账号入口">
          <button className={mode === "login" ? "selected" : ""} type="button" onClick={() => switchMode("login")}>
            登录
          </button>
          <button className={isRegister ? "selected" : ""} type="button" onClick={() => switchMode("register")}>
            邮箱注册
          </button>
          <button className={isInvite ? "selected" : ""} type="button" onClick={() => switchMode("invite")}>
            接受邀请
          </button>
          <button className={isReset ? "selected" : ""} type="button" onClick={() => switchMode("reset")}>
            重置密码
          </button>
        </div>
        {!isInvite && (
          <label>
            邮箱
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" />
          </label>
        )}
        {(isRegister || isInvite) && (
          <label>
            姓名
            <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" />
          </label>
        )}
        {isRegister && (
          <label>
            团队名
            <input value={teamName} onChange={(event) => setTeamName(event.target.value)} autoComplete="organization" />
          </label>
        )}
        {isInvite && (
          <label>
            邀请 Token
            <textarea rows={3} value={inviteToken} onChange={(event) => setInviteToken(event.target.value)} />
          </label>
        )}
        {isReset && (
          <label>
            重置 Token
            <textarea rows={3} value={resetToken} onChange={(event) => setResetToken(event.target.value)} placeholder="留空则先申请重置 Token" />
          </label>
        )}
        {(!isReset || resetToken.trim()) && (
          <label>
            密码
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={isRegister || isInvite || isReset ? "new-password" : "current-password"}
              minLength={isRegister || isInvite || isReset ? 8 : undefined}
            />
          </label>
        )}
        {isRegister && <p className="muted-note">注册后会自动创建个人团队，并以所有者身份登录。</p>}
        {isInvite && <p className="muted-note">团队所有者生成邀请 Token 后，成员可在这里设置密码并加入团队。</p>}
        {isReset && <p className="muted-note">本地 MVP 会直接返回重置 Token，并写入团队所有者可见的通知发件箱。</p>}
        {error && <p className="auth-error">{error}</p>}
        <button className="primary-action" type="submit" disabled={submitting}>
          <LogIn size={18} />
          {submitting
            ? "处理中..."
            : isInvite
              ? "接受邀请并进入"
              : isReset
                ? resetToken.trim()
                  ? "确认重置密码"
                  : "申请重置 Token"
                : isRegister
                  ? "注册并进入工作台"
                  : "登录工作台"}
        </button>
        <button className="secondary-action" type="button" onClick={onBack}>
          <Home size={15} />
          返回落地页
        </button>
      </form>
    </main>
  );
}
