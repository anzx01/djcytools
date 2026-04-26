import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createSeedWorkspace } from "../src/lib/workspaceSeed.js";
import { normalizeProjectName, normalizeWorkspace } from "../src/lib/storage.js";

const databaseHandles = new Map();
const SESSION_DAYS = 7;
const ROLE_LABELS = {
  owner: "所有者",
  editor: "编辑者",
  viewer: "查看者",
};
const ROLE_VALUES = {
  所有者: "owner",
  编辑者: "editor",
  编剧: "editor",
  查看者: "viewer",
};
const ROLE_LEVEL = {
  viewer: 1,
  editor: 2,
  owner: 3,
};

function nowIso() {
  return new Date().toISOString();
}

function jsonStringify(value, fallback = null) {
  return JSON.stringify(value ?? fallback);
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function randomId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
}

function createDatabaseError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function stableId(prefix, value) {
  return `${prefix}_${crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 18)}`;
}

function normalizeRole(role) {
  if (!role) return "viewer";
  return ROLE_VALUES[role] || (ROLE_LEVEL[role] ? role : "viewer");
}

export function roleLabel(role) {
  return ROLE_LABELS[normalizeRole(role)] || ROLE_LABELS.viewer;
}

export function canRole(role, requiredRole) {
  return ROLE_LEVEL[normalizeRole(role)] >= ROLE_LEVEL[normalizeRole(requiredRole)];
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, storedHash) {
  const [algorithm, salt, expected] = String(storedHash || "").split("$");
  if (algorithm !== "scrypt" || !salt || !expected) return false;
  const actual = crypto.scryptSync(String(password), salt, 64);
  const expectedBuffer = Buffer.from(expected, "hex");
  return expectedBuffer.length === actual.length && crypto.timingSafeEqual(actual, expectedBuffer);
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function assertValidEmail(email) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const error = new Error("邮箱格式不正确");
    error.statusCode = 400;
    error.code = "INVALID_EMAIL";
    throw error;
  }
}

function assertValidPassword(password) {
  if (String(password || "").length < 8) {
    const error = new Error("密码至少需要 8 位");
    error.statusCode = 400;
    error.code = "WEAK_PASSWORD";
    throw error;
  }
}

function getDataPaths(rootDir) {
  const dataDir = path.join(rootDir, "data");
  return {
    dataDir,
    databaseFile: path.join(dataDir, "djcytools.sqlite"),
    workspaceFile: path.join(dataDir, "workspace.json"),
    logsFile: path.join(dataDir, "ai-logs.json"),
    analyticsFile: path.join(dataDir, "analytics.json"),
  };
}

function readJsonFile(filePath, fallback) {
  try {
    if (!existsSync(filePath)) return fallback;
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function execTransaction(db, callback) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = callback();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function initSchema(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      active_project_id TEXT,
      settings_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS team_members (
      team_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (team_id, user_id),
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      owner_user_id TEXT,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      active_version_id TEXT,
      brief_json TEXT NOT NULL DEFAULT '{}',
      params_json TEXT NOT NULL DEFAULT '{}',
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS versions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      name TEXT NOT NULL,
      template_name TEXT,
      source TEXT,
      model TEXT,
      request_id TEXT,
      usage_json TEXT NOT NULL DEFAULT '{}',
      cost_usd REAL DEFAULT 0,
      score_json TEXT NOT NULL DEFAULT '{}',
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      author TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS exports (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      type TEXT NOT NULL,
      version TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS campaign_results (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      version_id TEXT,
      version_name TEXT,
      template_name TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS custom_templates (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT,
      category TEXT,
      heat_rank INTEGER,
      heat_score REAL,
      tags_json TEXT NOT NULL DEFAULT '[]',
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ai_logs (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      user_id TEXT,
      status TEXT NOT NULL,
      model TEXT,
      instruction TEXT,
      market TEXT,
      template TEXT,
      usage_json TEXT NOT NULL DEFAULT '{}',
      cost_usd REAL DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      error TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS analytics_events (
      id TEXT PRIMARY KEY,
      page TEXT NOT NULL,
      visitor_hash TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_projects_team ON projects(team_id);
    CREATE INDEX IF NOT EXISTS idx_versions_project ON versions(project_id, position);
    CREATE INDEX IF NOT EXISTS idx_ai_logs_team_created ON ai_logs(team_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_analytics_page_created ON analytics_events(page, created_at DESC);
  `);
}

function getMeta(db, key) {
  return db.prepare("SELECT value FROM app_meta WHERE key = ?").get(key)?.value || null;
}

function setMeta(db, key, value) {
  db.prepare("INSERT OR REPLACE INTO app_meta(key, value) VALUES(?, ?)").run(key, value);
}

function getBootstrapConfig(env = {}) {
  return {
    teamId: env.DJCYTOOLS_TEAM_ID || "team_default",
    teamName: env.DJCYTOOLS_TEAM_NAME || "出海短剧实验室",
    adminEmail: (env.DJCYTOOLS_ADMIN_EMAIL || "admin@djcytools.local").trim().toLowerCase(),
    adminName: env.DJCYTOOLS_ADMIN_NAME || "DJCYTools 管理员",
    adminPassword: env.DJCYTOOLS_ADMIN_PASSWORD || "DJCYTools@2026",
  };
}

function ensureBootstrapIdentity(db, env) {
  const config = getBootstrapConfig(env);
  const timestamp = nowIso();
  const userId = stableId("user", config.adminEmail);
  db.prepare(
    `INSERT OR IGNORE INTO users(id, email, name, password_hash, created_at, updated_at)
     VALUES(?, ?, ?, ?, ?, ?)`,
  ).run(userId, config.adminEmail, config.adminName, hashPassword(config.adminPassword), timestamp, timestamp);
  db.prepare(
    `INSERT OR IGNORE INTO teams(id, name, settings_json, created_at, updated_at)
     VALUES(?, ?, ?, ?, ?)`,
  ).run(
    config.teamId,
    config.teamName,
    jsonStringify({ persistence: "sqlite", language: "zh-CN" }, {}),
    timestamp,
    timestamp,
  );
  db.prepare(
    `INSERT OR REPLACE INTO team_members(team_id, user_id, role, created_at, updated_at)
     VALUES(?, ?, ?, COALESCE((SELECT created_at FROM team_members WHERE team_id = ? AND user_id = ?), ?), ?)`,
  ).run(config.teamId, userId, "owner", config.teamId, userId, timestamp, timestamp);
  return { teamId: config.teamId, userId };
}

function ensureDisplayMemberUser(db, member, index) {
  const name = String(member?.name || `团队成员 ${index + 1}`).trim();
  const existingDisplayUser = member?.id ? db.prepare("SELECT id FROM users WHERE id = ? AND password_hash = ''").get(member.id) : null;
  if (existingDisplayUser?.id) {
    db.prepare("UPDATE users SET name = ?, updated_at = ? WHERE id = ?").run(name, nowIso(), existingDisplayUser.id);
    return existingDisplayUser.id;
  }
  const email = `member-${crypto.createHash("sha1").update(`${name}:${index}`).digest("hex").slice(0, 10)}@local.djcytools`;
  const userId = stableId("user", email);
  const timestamp = nowIso();
  db.prepare(
    `INSERT OR IGNORE INTO users(id, email, name, password_hash, created_at, updated_at)
     VALUES(?, ?, ?, ?, ?, ?)`,
  ).run(userId, email, name, "", timestamp, timestamp);
  db.prepare("UPDATE users SET name = ?, updated_at = ? WHERE id = ? AND password_hash = ''").run(name, timestamp, userId);
  return userId;
}

function insertWorkspace(db, workspaceValue, teamId, ownerUserId) {
  const workspace = normalizeWorkspace(workspaceValue);
  const timestamp = nowIso();
  db.prepare("UPDATE teams SET name = ?, active_project_id = ?, settings_json = ?, updated_at = ? WHERE id = ?").run(
    workspace.team?.name || "未命名团队",
    workspace.activeProjectId || "",
    jsonStringify({ ...(workspace.settings || {}), persistence: "sqlite" }, {}),
    timestamp,
    teamId,
  );

  const existingAuthMembers = db
    .prepare(
      `SELECT team_members.user_id, team_members.role, team_members.created_at
       FROM team_members
       JOIN users ON users.id = team_members.user_id
       WHERE team_members.team_id = ? AND users.password_hash <> ''`,
    )
    .all(teamId);
  db.prepare("DELETE FROM team_members WHERE team_id = ?").run(teamId);
  for (const member of existingAuthMembers) {
    db.prepare("INSERT OR REPLACE INTO team_members(team_id, user_id, role, created_at, updated_at) VALUES(?, ?, ?, ?, ?)").run(
      teamId,
      member.user_id,
      member.role,
      member.created_at || timestamp,
      timestamp,
    );
  }
  const authUserIds = new Set(existingAuthMembers.map((member) => member.user_id));
  (workspace.team?.members || []).forEach((member, index) => {
    if (member?.id && authUserIds.has(member.id)) return;
    if (member?.email) {
      const authUser = db.prepare("SELECT id FROM users WHERE email = ? AND password_hash <> ''").get(String(member.email).toLowerCase());
      if (authUser?.id) return;
    }
    const userId = ensureDisplayMemberUser(db, member, index);
    db.prepare("INSERT OR REPLACE INTO team_members(team_id, user_id, role, created_at, updated_at) VALUES(?, ?, ?, ?, ?)").run(
      teamId,
      userId,
      normalizeRole(member.role),
      timestamp,
      timestamp,
    );
  });

  db.prepare("DELETE FROM projects WHERE team_id = ?").run(teamId);
  for (const project of workspace.projects) {
    insertProject(db, teamId, ownerUserId, project);
  }

  db.prepare("DELETE FROM custom_templates WHERE team_id = ?").run(teamId);
  for (const template of workspace.customTemplates || []) {
    insertCustomTemplate(db, teamId, template);
  }
}

function insertProject(db, teamId, ownerUserId, project) {
  const timestamp = nowIso();
  const createdAt = project.createdAt || project.updatedAt || timestamp;
  const updatedAt = project.updatedAt || createdAt;
  const projectPayload = stripProjectCollections(project);
  db.prepare(
    `INSERT INTO projects(id, team_id, owner_user_id, name, status, active_version_id, brief_json, params_json, payload_json, created_at, updated_at)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    project.id,
    teamId,
    ownerUserId,
    project.name || "未命名项目",
    project.status || "草稿",
    project.activeVersionId || project.versions?.[0]?.id || "",
    jsonStringify(project.brief, {}),
    jsonStringify(project.params, {}),
    jsonStringify(projectPayload, {}),
    createdAt,
    updatedAt,
  );

  (project.versions || []).forEach((version, index) => {
    db.prepare(
      `INSERT INTO versions(id, project_id, position, name, template_name, source, model, request_id, usage_json, cost_usd, score_json, payload_json, created_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      version.id,
      project.id,
      index,
      version.name || `版本 ${index + 1}`,
      version.templateName || "",
      version.source || "",
      version.model || "",
      version.requestId || "",
      jsonStringify(version.usage, {}),
      Number(version.costUsd || 0),
      jsonStringify(version.score, {}),
      jsonStringify(version, {}),
      version.createdAt || updatedAt,
    );
  });

  (project.comments || []).forEach((comment, index) => {
    db.prepare("INSERT INTO comments(id, project_id, position, author, text, created_at) VALUES(?, ?, ?, ?, ?, ?)").run(
      comment.id || randomId("comment"),
      project.id,
      index,
      comment.author || "团队成员",
      comment.text || "",
      comment.createdAt || updatedAt,
    );
  });

  (project.exports || []).forEach((item, index) => {
    db.prepare("INSERT INTO exports(id, project_id, position, type, version, created_at) VALUES(?, ?, ?, ?, ?, ?)").run(
      item.id || randomId("export"),
      project.id,
      index,
      item.type || "JSON",
      item.version || "",
      item.createdAt || updatedAt,
    );
  });

  (project.campaignResults || []).forEach((item) => {
    db.prepare(
      "INSERT INTO campaign_results(id, project_id, version_id, version_name, template_name, payload_json, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)",
    ).run(
      item.id || randomId("campaign"),
      project.id,
      item.versionId || "",
      item.versionName || "",
      item.templateName || "",
      jsonStringify(item, {}),
      item.createdAt || updatedAt,
    );
  });
}

function stripProjectCollections(project) {
  return {
    ...project,
    versions: undefined,
    comments: undefined,
    exports: undefined,
    campaignResults: undefined,
  };
}

function normalizeProjectPayload(project, fallback = {}) {
  const timestamp = nowIso();
  const source = project && typeof project === "object" ? project : {};
  const merged = {
    ...fallback,
    ...source,
    id: fallback.id || source.id || randomId("proj"),
    name: String(source.name || fallback.name || "未命名项目").trim().slice(0, 80) || "未命名项目",
    status: String(source.status || fallback.status || "草稿").trim().slice(0, 24) || "草稿",
    createdAt: fallback.createdAt || source.createdAt || timestamp,
    updatedAt: timestamp,
    brief: source.brief && typeof source.brief === "object" ? source.brief : fallback.brief || {},
    params: source.params && typeof source.params === "object" ? source.params : fallback.params || {},
    versions: Array.isArray(source.versions) ? source.versions : fallback.versions || [],
    comments: Array.isArray(source.comments) ? source.comments : fallback.comments || [],
    exports: Array.isArray(source.exports) ? source.exports : fallback.exports || [],
    campaignResults: Array.isArray(source.campaignResults) ? source.campaignResults : fallback.campaignResults || [],
  };
  merged.activeVersionId = source.activeVersionId || fallback.activeVersionId || merged.versions[0]?.id || "";
  return merged;
}

function readProjectById(db, teamId, projectId) {
  const projectRow = db.prepare("SELECT * FROM projects WHERE id = ? AND team_id = ?").get(projectId, teamId);
  if (!projectRow) {
    throw createDatabaseError(404, "项目不存在或不属于当前团队", "PROJECT_NOT_FOUND");
  }
  return readProject(db, projectRow);
}

function replaceProject(db, teamId, ownerUserId, project) {
  db.prepare("DELETE FROM versions WHERE project_id = ?").run(project.id);
  db.prepare("DELETE FROM comments WHERE project_id = ?").run(project.id);
  db.prepare("DELETE FROM exports WHERE project_id = ?").run(project.id);
  db.prepare("DELETE FROM campaign_results WHERE project_id = ?").run(project.id);
  db.prepare("DELETE FROM projects WHERE id = ? AND team_id = ?").run(project.id, teamId);
  insertProject(db, teamId, ownerUserId, project);
}

function insertCustomTemplate(db, teamId, template) {
  const timestamp = nowIso();
  db.prepare(
    `INSERT INTO custom_templates(id, team_id, name, type, category, heat_rank, heat_score, tags_json, payload_json, created_at, updated_at)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    template.id || randomId("tpl"),
    teamId,
    template.name || "未命名模板",
    template.type || "自定义",
    template.category || template.type || "自定义",
    Number(template.heatRank || 900),
    Number(template.heatScore || 70),
    jsonStringify(template.tags || [], []),
    jsonStringify(template, {}),
    template.createdAt || timestamp,
    template.updatedAt || timestamp,
  );
}

function migrateJsonIfNeeded(db, rootDir, env, bootstrap) {
  if (getMeta(db, "json_migrated_v1") === "true") return;
  const paths = getDataPaths(rootDir);
  const hasProjects = Number(db.prepare("SELECT COUNT(*) AS count FROM projects WHERE team_id = ?").get(bootstrap.teamId)?.count || 0) > 0;
  if (!hasProjects) {
    const seed = createSeedWorkspace();
    const workspace = readJsonFile(paths.workspaceFile, null) || {
      ...seed,
      team: { ...seed.team, name: getBootstrapConfig(env).teamName },
    };
    insertWorkspace(db, workspace, bootstrap.teamId, bootstrap.userId);
  }

  if (Number(db.prepare("SELECT COUNT(*) AS count FROM ai_logs WHERE team_id = ?").get(bootstrap.teamId)?.count || 0) === 0) {
    for (const log of readJsonFile(paths.logsFile, []) || []) {
      insertAiLog(db, bootstrap.teamId, bootstrap.userId, log);
    }
  }

  if (Number(db.prepare("SELECT COUNT(*) AS count FROM analytics_events").get()?.count || 0) === 0) {
    migrateAnalyticsJson(db, readJsonFile(paths.analyticsFile, null));
  }

  setMeta(db, "json_migrated_v1", "true");
}

function migrateAnalyticsJson(db, analyticsStore) {
  if (!analyticsStore?.pages) return;
  const timestamp = nowIso();
  for (const page of ["landing", "workbench"]) {
    const pageData = analyticsStore.pages[page] || {};
    const hashes = Array.isArray(pageData.visitorHashes) ? pageData.visitorHashes : [];
    const pageViews = Math.max(0, Number(pageData.pageViews || 0));
    for (let index = 0; index < pageViews; index += 1) {
      db.prepare("INSERT INTO analytics_events(id, page, visitor_hash, created_at) VALUES(?, ?, ?, ?)").run(
        `pv_migrated_${page}_${index}`,
        page,
        hashes[index % Math.max(hashes.length, 1)] || null,
        index === 0 && pageData.lastVisitedAt ? pageData.lastVisitedAt : timestamp,
      );
    }
  }
}

function insertAiLog(db, teamId, userId, logItem) {
  const id = logItem.id || randomId("ai");
  db.prepare(
    `INSERT OR REPLACE INTO ai_logs(id, team_id, user_id, status, model, instruction, market, template, usage_json, cost_usd, duration_ms, error, payload_json, created_at)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    teamId,
    userId || null,
    logItem.status || "unknown",
    logItem.model || "",
    logItem.instruction || "",
    logItem.market || "",
    logItem.template || "",
    jsonStringify(logItem.usage, {}),
    Number(logItem.costUsd || 0),
    Number(logItem.durationMs || 0),
    logItem.error || "",
    jsonStringify({ ...logItem, id }, {}),
    logItem.createdAt || nowIso(),
  );
}

export function getDatabase(rootDir, env = {}) {
  const key = path.resolve(rootDir);
  if (databaseHandles.has(key)) return databaseHandles.get(key);
  const paths = getDataPaths(rootDir);
  mkdirSync(paths.dataDir, { recursive: true });
  const db = new DatabaseSync(paths.databaseFile);
  initSchema(db);
  execTransaction(db, () => {
    const bootstrap = ensureBootstrapIdentity(db, env);
    migrateJsonIfNeeded(db, rootDir, env, bootstrap);
  });
  databaseHandles.set(key, db);
  return db;
}

export function closeDatabase(rootDir) {
  const key = path.resolve(rootDir);
  const db = databaseHandles.get(key);
  if (db) {
    db.close();
    databaseHandles.delete(key);
  }
}

export function readWorkspaceFromDatabase(rootDir, env, session) {
  const db = getDatabase(rootDir, env);
  const teamId = session.team.id;
  const team = db.prepare("SELECT * FROM teams WHERE id = ?").get(teamId);
  const memberRows = db
    .prepare(
      `SELECT users.id, users.name, users.email, team_members.role
       FROM team_members
       JOIN users ON users.id = team_members.user_id
       WHERE team_members.team_id = ?
       ORDER BY CASE team_members.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, users.created_at`,
    )
    .all(teamId);
  const projects = db
    .prepare("SELECT * FROM projects WHERE team_id = ? ORDER BY updated_at DESC, created_at DESC")
    .all(teamId)
    .map((projectRow) => readProject(db, projectRow));
  const customTemplates = db
    .prepare("SELECT * FROM custom_templates WHERE team_id = ? ORDER BY COALESCE(heat_rank, 900), created_at DESC")
    .all(teamId)
    .map((row) => ({ ...parseJson(row.payload_json, {}), id: row.id, name: row.name, type: row.type, category: row.category }));
  const settings = { ...parseJson(team?.settings_json, {}), persistence: "sqlite" };
  const activeProjectId = projects.some((project) => project.id === team?.active_project_id) ? team.active_project_id : projects[0]?.id || "";

  return normalizeWorkspace({
    activeProjectId,
    projects,
    team: {
      id: team?.id,
      name: team?.name || "未命名团队",
      members: memberRows.map((member) => ({ id: member.id, name: member.name, email: member.email, role: roleLabel(member.role) })),
    },
    settings,
    customTemplates,
  });
}

function readProject(db, projectRow) {
  const base = parseJson(projectRow.payload_json, {});
  const versions = db
    .prepare("SELECT * FROM versions WHERE project_id = ? ORDER BY position ASC, created_at DESC")
    .all(projectRow.id)
    .map((row) => ({ ...parseJson(row.payload_json, {}), id: row.id, name: row.name }));
  const comments = db
    .prepare("SELECT * FROM comments WHERE project_id = ? ORDER BY position ASC, created_at DESC")
    .all(projectRow.id)
    .map((row) => ({ id: row.id, author: row.author, text: row.text, createdAt: row.created_at }));
  const exports = db
    .prepare("SELECT * FROM exports WHERE project_id = ? ORDER BY position ASC, created_at DESC")
    .all(projectRow.id)
    .map((row) => ({ id: row.id, type: row.type, version: row.version, createdAt: row.created_at }));
  const campaignResults = db
    .prepare("SELECT * FROM campaign_results WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectRow.id)
    .map((row) => ({ ...parseJson(row.payload_json, {}), id: row.id, createdAt: row.created_at }));
  const project = {
    ...base,
    id: projectRow.id,
    name: projectRow.name,
    status: projectRow.status,
    activeVersionId: projectRow.active_version_id || versions[0]?.id || "",
    brief: parseJson(projectRow.brief_json, base.brief || {}),
    params: parseJson(projectRow.params_json, base.params || {}),
    createdAt: projectRow.created_at,
    updatedAt: projectRow.updated_at,
    versions,
    comments,
    exports,
    campaignResults,
  };
  return {
    ...project,
    name: normalizeProjectName(project),
  };
}

export function writeWorkspaceToDatabase(rootDir, env, session, workspace) {
  const db = getDatabase(rootDir, env);
  execTransaction(db, () => insertWorkspace(db, workspace, session.team.id, session.user.id));
  return readWorkspaceFromDatabase(rootDir, env, session);
}

export function listProjectsFromDatabase(rootDir, env, session) {
  const db = getDatabase(rootDir, env);
  return db
    .prepare("SELECT * FROM projects WHERE team_id = ? ORDER BY updated_at DESC, created_at DESC")
    .all(session.team.id)
    .map((projectRow) => readProject(db, projectRow));
}

export function getProjectFromDatabase(rootDir, env, session, projectId) {
  const db = getDatabase(rootDir, env);
  return readProjectById(db, session.team.id, projectId);
}

export function createProjectInDatabase(rootDir, env, session, projectValue) {
  const db = getDatabase(rootDir, env);
  const project = normalizeProjectPayload(projectValue);
  execTransaction(db, () => {
    const existing = db.prepare("SELECT id FROM projects WHERE id = ?").get(project.id);
    if (existing) {
      throw createDatabaseError(409, "项目 ID 已存在，请刷新后重试", "PROJECT_ID_EXISTS");
    }
    insertProject(db, session.team.id, session.user.id, project);
    db.prepare("UPDATE teams SET active_project_id = ?, updated_at = ? WHERE id = ?").run(project.id, nowIso(), session.team.id);
  });
  return readProjectById(db, session.team.id, project.id);
}

export function updateProjectInDatabase(rootDir, env, session, projectId, patchValue = {}) {
  const db = getDatabase(rootDir, env);
  let updatedProject;
  execTransaction(db, () => {
    const existing = readProjectById(db, session.team.id, projectId);
    const { activate, project: fullProject, ...partialPatch } = patchValue && typeof patchValue === "object" ? patchValue : {};
    const patchProject = fullProject && typeof fullProject === "object" ? fullProject : partialPatch;
    if (activate === true && Object.keys(patchProject).length === 0) {
      db.prepare("UPDATE teams SET active_project_id = ?, updated_at = ? WHERE id = ?").run(existing.id, nowIso(), session.team.id);
      updatedProject = existing;
      return;
    }
    const project = normalizeProjectPayload(
      {
        ...existing,
        ...patchProject,
        id: existing.id,
        createdAt: existing.createdAt,
      },
      existing,
    );
    const shouldReplaceCollections =
      Boolean(fullProject) || ["versions", "comments", "exports", "campaignResults"].some((key) => Array.isArray(patchProject[key]));
    if (!shouldReplaceCollections) {
      db.prepare(
        `UPDATE projects
         SET name = ?, status = ?, active_version_id = ?, brief_json = ?, params_json = ?, payload_json = ?, updated_at = ?
         WHERE id = ? AND team_id = ?`,
      ).run(
        project.name,
        project.status,
        project.activeVersionId,
        jsonStringify(project.brief, {}),
        jsonStringify(project.params, {}),
        jsonStringify(stripProjectCollections(project), {}),
        project.updatedAt,
        project.id,
        session.team.id,
      );
      if (activate === true) {
        db.prepare("UPDATE teams SET active_project_id = ?, updated_at = ? WHERE id = ?").run(project.id, nowIso(), session.team.id);
      }
      updatedProject = readProjectById(db, session.team.id, project.id);
      return;
    }
    replaceProject(db, session.team.id, session.user.id, project);
    if (activate === true) {
      db.prepare("UPDATE teams SET active_project_id = ?, updated_at = ? WHERE id = ?").run(project.id, nowIso(), session.team.id);
    }
    updatedProject = readProjectById(db, session.team.id, project.id);
  });
  return updatedProject;
}

export function deleteProjectFromDatabase(rootDir, env, session, projectId) {
  const db = getDatabase(rootDir, env);
  execTransaction(db, () => {
    readProjectById(db, session.team.id, projectId);
    const count = Number(db.prepare("SELECT COUNT(*) AS count FROM projects WHERE team_id = ?").get(session.team.id)?.count || 0);
    if (count <= 1) {
      throw createDatabaseError(409, "至少需要保留一个项目", "LAST_PROJECT_REQUIRED");
    }
    db.prepare("DELETE FROM projects WHERE id = ? AND team_id = ?").run(projectId, session.team.id);
    const team = db.prepare("SELECT active_project_id FROM teams WHERE id = ?").get(session.team.id);
    if (team?.active_project_id === projectId) {
      const nextProject = db
        .prepare("SELECT id FROM projects WHERE team_id = ? ORDER BY updated_at DESC, created_at DESC LIMIT 1")
        .get(session.team.id);
      db.prepare("UPDATE teams SET active_project_id = ?, updated_at = ? WHERE id = ?").run(nextProject?.id || "", nowIso(), session.team.id);
    }
  });
  return readWorkspaceFromDatabase(rootDir, env, session);
}

export function appendAiLogToDatabase(rootDir, env, logItem, session = null) {
  const db = getDatabase(rootDir, env);
  const bootstrap = getBootstrapConfig(env);
  insertAiLog(db, session?.team?.id || bootstrap.teamId, session?.user?.id || null, logItem);
}

export function readAiLogsFromDatabase(rootDir, env, session) {
  const db = getDatabase(rootDir, env);
  const logs = db
    .prepare("SELECT * FROM ai_logs WHERE team_id = ? ORDER BY created_at DESC LIMIT 300")
    .all(session.team.id)
    .map((row) => ({
      ...parseJson(row.payload_json, {}),
      id: row.id,
      status: row.status,
      model: row.model,
      instruction: row.instruction,
      market: row.market,
      template: row.template,
      usage: parseJson(row.usage_json, {}),
      costUsd: Number(row.cost_usd || 0),
      durationMs: Number(row.duration_ms || 0),
      error: row.error,
      createdAt: row.created_at,
    }));
  const totals = logs.reduce(
    (acc, item) => {
      acc.count += 1;
      acc.success += item.status === "success" ? 1 : 0;
      acc.tokens += Number(item.usage?.total_tokens || 0);
      acc.costUsd += Number(item.costUsd || 0);
      return acc;
    },
    { count: 0, success: 0, tokens: 0, costUsd: 0 },
  );
  return { logs, totals: { ...totals, costUsd: Number(totals.costUsd.toFixed(6)) } };
}

export function recordAnalyticsEventToDatabase(rootDir, env, event) {
  const page = typeof event?.page === "string" ? event.page.trim() : "";
  if (!["landing", "workbench"].includes(page)) {
    const error = new Error("不支持的埋点页面");
    error.statusCode = 400;
    error.code = "INVALID_ANALYTICS_PAGE";
    throw error;
  }
  const visitorHash = hashVisitorId(event.visitorId);
  const db = getDatabase(rootDir, env);
  db.prepare("INSERT INTO analytics_events(id, page, visitor_hash, created_at) VALUES(?, ?, ?, ?)").run(
    randomId("pv"),
    page,
    visitorHash || null,
    nowIso(),
  );
  return readAnalyticsSummaryFromDatabase(rootDir, env);
}

function hashVisitorId(visitorId) {
  if (typeof visitorId !== "string") return "";
  const normalized = visitorId.trim().slice(0, 128);
  if (normalized.length < 8) return "";
  return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 40);
}

export function readAnalyticsSummaryFromDatabase(rootDir, env) {
  const db = getDatabase(rootDir, env);
  const rows = db.prepare("SELECT page, COUNT(*) AS pageViews, COUNT(DISTINCT visitor_hash) AS uniqueVisitors, MAX(created_at) AS lastVisitedAt FROM analytics_events GROUP BY page").all();
  const pages = {
    landing: { pageViews: 0, uniqueVisitors: 0, lastVisitedAt: null },
    workbench: { pageViews: 0, uniqueVisitors: 0, lastVisitedAt: null },
  };
  for (const row of rows) {
    if (pages[row.page]) {
      pages[row.page] = {
        pageViews: Number(row.pageViews || 0),
        uniqueVisitors: Number(row.uniqueVisitors || 0),
        lastVisitedAt: row.lastVisitedAt || null,
      };
    }
  }
  const totalRow = db.prepare("SELECT COUNT(*) AS pageViews, COUNT(DISTINCT visitor_hash) AS uniqueVisitors FROM analytics_events").get();
  const recentEvents = db
    .prepare("SELECT id, page, created_at FROM analytics_events ORDER BY created_at DESC LIMIT 10")
    .all()
    .map((row) => ({ id: row.id, page: row.page, createdAt: row.created_at }));
  return {
    totals: {
      pageViews: Number(totalRow?.pageViews || 0),
      uniqueVisitors: Number(totalRow?.uniqueVisitors || 0),
    },
    pages,
    recentEvents,
  };
}

export function createSession(rootDir, env, email, password) {
  const db = getDatabase(rootDir, env);
  const normalizedEmail = normalizeEmail(email);
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(normalizedEmail);
  if (!user || !verifyPassword(password, user.password_hash)) {
    const error = new Error("账号或密码不正确");
    error.statusCode = 401;
    error.code = "INVALID_CREDENTIALS";
    throw error;
  }
  const membership = db
    .prepare(
      `SELECT team_members.role, teams.id AS team_id, teams.name AS team_name
       FROM team_members
       JOIN teams ON teams.id = team_members.team_id
       WHERE team_members.user_id = ?
       ORDER BY CASE team_members.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END
       LIMIT 1`,
    )
    .get(user.id);
  if (!membership) {
    const error = new Error("账号未加入任何团队");
    error.statusCode = 403;
    error.code = "TEAM_REQUIRED";
    throw error;
  }
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.prepare("INSERT INTO sessions(token_hash, user_id, expires_at, created_at) VALUES(?, ?, ?, ?)").run(hashToken(token), user.id, expiresAt, nowIso());
  return { token, expiresAt, ...sessionPayload(user, membership) };
}

export function registerUser(rootDir, env, { email, password, name, teamName } = {}) {
  const db = getDatabase(rootDir, env);
  const normalizedEmail = normalizeEmail(email);
  assertValidEmail(normalizedEmail);
  assertValidPassword(password);

  const displayName = String(name || normalizedEmail.split("@")[0] || "新用户").trim().slice(0, 40);
  const ownedTeamName = String(teamName || `${displayName} 的团队`).trim().slice(0, 60);
  const timestamp = nowIso();
  const userId = stableId("user", normalizedEmail);
  const teamId = stableId("team", normalizedEmail);

  execTransaction(db, () => {
    const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(normalizedEmail);
    if (existing) {
      const error = new Error("该邮箱已经注册，请直接登录");
      error.statusCode = 409;
      error.code = "EMAIL_EXISTS";
      throw error;
    }

    db.prepare(
      `INSERT INTO users(id, email, name, password_hash, created_at, updated_at)
       VALUES(?, ?, ?, ?, ?, ?)`,
    ).run(userId, normalizedEmail, displayName, hashPassword(password), timestamp, timestamp);
    db.prepare(
      `INSERT INTO teams(id, name, settings_json, created_at, updated_at)
       VALUES(?, ?, ?, ?, ?)`,
    ).run(teamId, ownedTeamName, jsonStringify({ persistence: "sqlite", language: "zh-CN" }, {}), timestamp, timestamp);
    db.prepare("INSERT INTO team_members(team_id, user_id, role, created_at, updated_at) VALUES(?, ?, ?, ?, ?)").run(
      teamId,
      userId,
      "owner",
      timestamp,
      timestamp,
    );

    const seed = createSeedWorkspace();
    insertWorkspace(
      db,
      {
        ...seed,
        team: {
          ...seed.team,
          name: ownedTeamName,
          members: [{ id: userId, email: normalizedEmail, name: displayName, role: "所有者" }],
        },
      },
      teamId,
      userId,
    );
  });

  return createSession(rootDir, env, normalizedEmail, password);
}

export function readSession(rootDir, env, token) {
  if (!token) return null;
  const db = getDatabase(rootDir, env);
  const row = db
    .prepare(
      `SELECT sessions.token_hash, sessions.expires_at, users.id, users.email, users.name,
              team_members.role, teams.id AS team_id, teams.name AS team_name
       FROM sessions
       JOIN users ON users.id = sessions.user_id
       JOIN team_members ON team_members.user_id = users.id
       JOIN teams ON teams.id = team_members.team_id
       WHERE sessions.token_hash = ?
       ORDER BY CASE team_members.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END
       LIMIT 1`,
    )
    .get(hashToken(token));
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(row.token_hash);
    return null;
  }
  return {
    expiresAt: row.expires_at,
    ...sessionPayload({ id: row.id, email: row.email, name: row.name }, row),
  };
}

export function destroySession(rootDir, env, token) {
  if (!token) return;
  const db = getDatabase(rootDir, env);
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}

function sessionPayload(user, membership) {
  const role = normalizeRole(membership.role);
  return {
    user: { id: user.id, email: user.email, name: user.name },
    team: { id: membership.team_id, name: membership.team_name },
    membership: { role, roleLabel: roleLabel(role) },
  };
}
