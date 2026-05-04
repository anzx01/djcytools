import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
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
const POSTGRES_CONFLICT_TARGETS = {
  app_meta: ["key"],
  ai_logs: ["id"],
  team_members: ["team_id", "user_id"],
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

function getDataPaths(rootDir, env = {}) {
  const configuredDataDir = String(env.DJCYTOOLS_DATA_DIR || "").trim();
  const dataDir = configuredDataDir ? path.resolve(rootDir, configuredDataDir) : path.join(rootDir, "data");
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

function getPostgresConnectionString(env = {}) {
  const value = String(env.DJCYTOOLS_DATABASE_URL || "").trim();
  return /^postgres(?:ql)?:\/\//.test(value) ? value : "";
}

function storageKind(db) {
  return db?.isPostgres ? "postgresql" : "sqlite";
}

function resolvePsqlPath(env = {}) {
  const configured = String(env.DJCYTOOLS_PSQL_BIN || "").trim();
  if (configured) return configured;
  const programFiles = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter(Boolean);
  for (const base of programFiles) {
    const postgresRoot = path.join(base, "PostgreSQL");
    if (!existsSync(postgresRoot)) continue;
    const versions = readdirSync(postgresRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => Number(b) - Number(a));
    for (const version of versions) {
      const candidate = path.join(postgresRoot, version, "bin", "psql.exe");
      if (existsSync(candidate)) return candidate;
    }
  }
  return "psql";
}

function postgresLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function bindSqlParams(sql, params = []) {
  let index = 0;
  return String(sql).replace(/\?/g, () => postgresLiteral(params[index++]));
}

function quotePostgresAliases(sql) {
  return String(sql)
    .replace(/\bAS\s+pageViews\b/g, 'AS "pageViews"')
    .replace(/\bAS\s+uniqueVisitors\b/g, 'AS "uniqueVisitors"')
    .replace(/\bAS\s+lastVisitedAt\b/g, 'AS "lastVisitedAt"');
}

function replaceJsonExtract(sql) {
  return String(sql).replace(/json_extract\(([^,]+),\s*'\$\.([^']+)'\)/g, (_match, source, dottedPath) => {
    const pathLiteral = `{${String(dottedPath).split(".").join(",")}}`;
    return `(${source.trim()}::jsonb #>> '${pathLiteral}')`;
  });
}

function addPostgresConflictClause(sql, tableName, columns) {
  const target = POSTGRES_CONFLICT_TARGETS[tableName];
  if (!target?.length) return `${sql} ON CONFLICT DO NOTHING`;
  const updateColumns = columns.filter((column) => !target.includes(column));
  if (!updateColumns.length) return `${sql} ON CONFLICT (${target.join(", ")}) DO NOTHING`;
  const updates = updateColumns.map((column) => `${column} = EXCLUDED.${column}`).join(", ");
  return `${sql} ON CONFLICT (${target.join(", ")}) DO UPDATE SET ${updates}`;
}

function normalizePostgresSql(sql, params = []) {
  let normalized = bindSqlParams(sql, params).trim().replace(/;+\s*$/g, "");
  normalized = normalized.replace(/^BEGIN IMMEDIATE$/i, "BEGIN");
  normalized = replaceJsonExtract(quotePostgresAliases(normalized));

  const replaceMatch = normalized.match(/^INSERT\s+OR\s+REPLACE\s+INTO\s+([a-z_][a-z0-9_]*)\s*\(([^)]+)\)\s+VALUES\s*([\s\S]+)$/i);
  if (replaceMatch) {
    const [, tableName, rawColumns, valuesSql] = replaceMatch;
    const columns = rawColumns.split(",").map((column) => column.trim());
    const insertSql = `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES ${valuesSql}`;
    return addPostgresConflictClause(insertSql, tableName, columns);
  }

  const ignoreMatch = normalized.match(/^INSERT\s+OR\s+IGNORE\s+INTO\s+([a-z_][a-z0-9_]*)\s*\(([^)]+)\)\s+VALUES\s*([\s\S]+)$/i);
  if (ignoreMatch) {
    const [, tableName, rawColumns, valuesSql] = ignoreMatch;
    const columns = rawColumns.split(",").map((column) => column.trim());
    const insertSql = `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES ${valuesSql}`;
    return `${insertSql} ON CONFLICT DO NOTHING`;
  }

  return normalized;
}

class PostgresSyncAdapter {
  constructor(connectionString, env = {}) {
    this.connectionString = connectionString;
    this.psqlPath = resolvePsqlPath(env);
    this.psqlTimeoutMs = Math.max(3000, Number(env.DJCYTOOLS_PSQL_TIMEOUT_MS || 12000));
    this.isPostgres = true;
  }

  exec(sql) {
    const raw = String(sql || "").trim();
    if (!raw) return;
    if (/^PRAGMA\b/i.test(raw)) return;
    if (raw.includes("CREATE TABLE IF NOT EXISTS app_meta")) {
      this.runSql(postgresSchemaSql);
      return;
    }
    this.runSql(normalizePostgresSql(raw));
  }

  prepare(sql) {
    return {
      get: (...params) => this.queryRows(sql, params)[0],
      all: (...params) => this.queryRows(sql, params),
      run: (...params) => {
        this.runSql(normalizePostgresSql(sql, params));
        return { changes: 0 };
      },
    };
  }

  queryRows(sql, params = []) {
    const normalized = normalizePostgresSql(sql, params);
    const wrapped = `SELECT COALESCE(json_agg(row_to_json(_djcy_rows)), '[]'::json) FROM (${normalized}) AS _djcy_rows`;
    const output = this.runPsql(wrapped).trim();
    return JSON.parse(output || "[]");
  }

  runSql(sql) {
    const normalized = String(sql || "").trim();
    if (!normalized) return "";
    return this.runPsql(normalized);
  }

  runPsql(sql) {
    const lockTimeoutMs = Math.min(this.psqlTimeoutMs, 5000);
    const guardedSql = [
      `SET lock_timeout = ${Math.max(1000, lockTimeoutMs)}`,
      `SET statement_timeout = ${this.psqlTimeoutMs}`,
      String(sql || ""),
    ].join(";\n");
    try {
      return execFileSync(
        this.psqlPath,
        ["-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-d", this.connectionString, "-f", "-"],
        {
          encoding: "utf8",
          input: guardedSql,
          maxBuffer: 16 * 1024 * 1024,
          timeout: this.psqlTimeoutMs + 2000,
          killSignal: "SIGTERM",
          env: { ...process.env, PGCLIENTENCODING: "UTF8" },
          windowsHide: true,
        },
      );
    } catch (error) {
      if (error?.signal === "SIGTERM" || error?.code === "ETIMEDOUT") {
        throw createDatabaseError(503, "PostgreSQL 命令执行超时，请稍后重试。", "POSTGRES_PSQL_TIMEOUT");
      }
      throw error;
    }
  }

  close() {}
}

function execTransaction(db, callback) {
  if (db?.isPostgres) return callback();
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

    CREATE TABLE IF NOT EXISTS team_invites (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      invited_email TEXT NOT NULL,
      invited_name TEXT,
      role TEXT NOT NULL,
      token_hash TEXT UNIQUE NOT NULL,
      created_by_user_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      expires_at TEXT NOT NULL,
      accepted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notification_outbox (
      id TEXT PRIMARY KEY,
      team_id TEXT,
      user_id TEXT,
      kind TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'local_outbox',
      recipient TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      target_type TEXT,
      target_id TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_by_user_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sent_at TEXT,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS public_api_tokens (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      name TEXT NOT NULL,
      token_hash TEXT UNIQUE NOT NULL,
      token_prefix TEXT NOT NULL,
      created_by_user_id TEXT,
      last_used_at TEXT,
      revoked_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
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

    CREATE TABLE IF NOT EXISTS trend_snapshots (
      id TEXT PRIMARY KEY,
      team_id TEXT,
      source TEXT NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]',
      template_signals_json TEXT NOT NULL DEFAULT '[]',
      market_notes_json TEXT NOT NULL DEFAULT '[]',
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      team_id TEXT,
      user_id TEXT,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      detail_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_projects_team ON projects(team_id);
    CREATE INDEX IF NOT EXISTS idx_versions_project ON versions(project_id, position);
    CREATE INDEX IF NOT EXISTS idx_ai_logs_team_created ON ai_logs(team_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_analytics_page_created ON analytics_events(page, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_invites_team_status ON team_invites(team_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_password_reset_user_status ON password_reset_tokens(user_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notification_outbox_team_status ON notification_outbox(team_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notification_outbox_user_created ON notification_outbox(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_public_api_tokens_team ON public_api_tokens(team_id, revoked_at, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_team_created ON audit_logs(team_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_trend_snapshots_team_created ON trend_snapshots(team_id, created_at DESC);
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
    adminPassword: env.DJCYTOOLS_ADMIN_PASSWORD || "123456",
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
    jsonStringify({ persistence: storageKind(db), language: "zh-CN" }, {}),
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
    jsonStringify({ ...(workspace.settings || {}), persistence: storageKind(db) }, {}),
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

  clearTeamProjectCollections(db, teamId);
  db.prepare("DELETE FROM projects WHERE team_id = ?").run(teamId);
  for (const project of workspace.projects) {
    insertProject(db, teamId, ownerUserId, project);
  }

  db.prepare("DELETE FROM custom_templates WHERE team_id = ?").run(teamId);
  for (const template of workspace.customTemplates || []) {
    insertCustomTemplate(db, teamId, template);
  }
}

function clearTeamProjectCollections(db, teamId) {
  const projectRows = db.prepare("SELECT id FROM projects WHERE team_id = ?").all(teamId);
  for (const project of projectRows) {
    db.prepare("DELETE FROM versions WHERE project_id = ?").run(project.id);
    db.prepare("DELETE FROM comments WHERE project_id = ?").run(project.id);
    db.prepare("DELETE FROM exports WHERE project_id = ?").run(project.id);
    db.prepare("DELETE FROM campaign_results WHERE project_id = ?").run(project.id);
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
    if (version.id) db.prepare("DELETE FROM versions WHERE id = ?").run(version.id);
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
    interactiveExperiences: Array.isArray(source.interactiveExperiences) ? source.interactiveExperiences : fallback.interactiveExperiences || [],
    videoSamples: Array.isArray(source.videoSamples) ? source.videoSamples : fallback.videoSamples || [],
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

function normalizeCampaignResult(result = {}, fallback = {}) {
  const timestamp = nowIso();
  const source = result && typeof result === "object" ? result : {};
  const impressions = Number(source.impressions || 0);
  const clicks = Number(source.clicks || 0);
  const completions = Number(source.completions || 0);
  const conversions = Number(source.conversions || 0);
  const spend = Number(source.spend || 0);
  const revenue = Number(source.revenue || 0);
  const metrics = source.metrics && typeof source.metrics === "object" ? source.metrics : {
    ctr: impressions ? Number(((clicks / impressions) * 100).toFixed(2)) : 0,
    completionRate: impressions ? Number(((completions / impressions) * 100).toFixed(2)) : 0,
    conversionRate: clicks ? Number(((conversions / clicks) * 100).toFixed(2)) : 0,
    cpa: conversions ? Number((spend / conversions).toFixed(2)) : 0,
    roas: spend ? Number((revenue / spend).toFixed(2)) : 0,
  };
  return {
    id: source.id || randomId("campaign"),
    channel: String(source.channel || fallback.channel || "Public API").trim().slice(0, 80),
    materialName: String(source.materialName || fallback.materialName || "外部回流素材").trim().slice(0, 120),
    versionId: source.versionId || fallback.versionId || "",
    versionName: source.versionName || fallback.versionName || "",
    templateName: source.templateName || fallback.templateName || "",
    spend,
    impressions,
    clicks,
    completions,
    conversions,
    revenue,
    materialUrl: String(source.materialUrl || "").trim().slice(0, 500),
    note: String(source.note || "").trim().slice(0, 500),
    metrics,
    createdAt: source.createdAt || timestamp,
  };
}

function migrateJsonIfNeeded(db, rootDir, env, bootstrap) {
  if (getMeta(db, "json_migrated_v1") === "true") return;
  const paths = getDataPaths(rootDir, env);
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
  const postgresUrl = getPostgresConnectionString(env);
  if (postgresUrl) {
    const key = `postgres:${postgresUrl}`;
    if (databaseHandles.has(key)) return databaseHandles.get(key);
    const db = new PostgresSyncAdapter(postgresUrl, env);
    initSchema(db);
    execTransaction(db, () => {
      ensureBootstrapIdentity(db, env);
    });
    databaseHandles.set(key, db);
    return db;
  }

  const paths = getDataPaths(rootDir, env);
  const key = paths.databaseFile;
  if (databaseHandles.has(key)) return databaseHandles.get(key);
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

export function closeDatabase(rootDir, env = {}) {
  const postgresUrl = getPostgresConnectionString(env);
  const key = postgresUrl ? `postgres:${postgresUrl}` : getDataPaths(rootDir, env).databaseFile;
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
  const settings = { ...parseJson(team?.settings_json, {}), persistence: storageKind(db) };
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

function invitePayload(row, token = "") {
  return {
    id: row.id,
    email: row.invited_email,
    name: row.invited_name || "",
    role: roleLabel(row.role),
    roleValue: normalizeRole(row.role),
    status: row.status,
    token,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getAppEntryUrl(env = {}) {
  const value = String(env.DJCYTOOLS_APP_URL || env.DJCYTOOLS_PUBLIC_API_BASE_URL || "http://127.0.0.1:4173").trim();
  return value.includes("#") ? value : `${value.replace(/\/$/, "")}/#workbench`;
}

function notificationPayload(row) {
  return {
    id: row.id,
    teamId: row.team_id || null,
    userId: row.user_id || null,
    kind: row.kind,
    channel: row.channel,
    recipient: row.recipient,
    subject: row.subject,
    body: row.body,
    status: row.status,
    targetType: row.target_type || "",
    targetId: row.target_id || "",
    payload: parseJson(row.payload_json, {}),
    createdByUserId: row.created_by_user_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sentAt: row.sent_at || null,
  };
}

function insertNotificationOutboxEntry(
  db,
  {
    teamId = null,
    userId = null,
    kind,
    recipient,
    subject,
    body,
    payload = {},
    targetType = "",
    targetId = "",
    createdByUserId = null,
    timestamp = nowIso(),
  } = {},
) {
  if (!kind || !recipient || !subject || !body) return null;
  const row = {
    id: randomId("notification"),
    team_id: teamId,
    user_id: userId,
    kind,
    channel: "local_outbox",
    recipient,
    subject,
    body,
    status: "queued",
    target_type: targetType,
    target_id: targetId,
    payload_json: jsonStringify(payload, {}),
    created_by_user_id: createdByUserId,
    created_at: timestamp,
    updated_at: timestamp,
    sent_at: null,
  };
  db.prepare(
    `INSERT INTO notification_outbox(
       id, team_id, user_id, kind, channel, recipient, subject, body, status,
       target_type, target_id, payload_json, created_by_user_id, created_at, updated_at, sent_at
     )
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.team_id,
    row.user_id,
    row.kind,
    row.channel,
    row.recipient,
    row.subject,
    row.body,
    row.status,
    row.target_type,
    row.target_id,
    row.payload_json,
    row.created_by_user_id,
    row.created_at,
    row.updated_at,
    row.sent_at,
  );
  return notificationPayload(row);
}

function readPrimaryMembershipForUser(db, userId) {
  return db
    .prepare(
      `SELECT team_members.team_id, teams.name AS team_name, team_members.role
       FROM team_members
       JOIN teams ON teams.id = team_members.team_id
       WHERE team_members.user_id = ?
       ORDER BY CASE team_members.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END
       LIMIT 1`,
    )
    .get(userId);
}

function buildInviteNotification({ env, session, invite, token }) {
  return {
    subject: `[DJCYTools] ${session.team.name} 邀请你加入团队`,
    body: [
      `${session.user.name || session.user.email} 邀请你以「${invite.role}」身份加入「${session.team.name}」。`,
      `邀请邮箱：${invite.email}`,
      `邀请 Token：${token}`,
      `有效期至：${invite.expiresAt}`,
      `入口：${getAppEntryUrl(env)}`,
      "打开登录页后切换到「接受邀请」，粘贴 Token 并设置密码。",
    ].join("\n"),
  };
}

function buildPasswordResetNotification({ env, user, token, expiresAt }) {
  return {
    subject: "[DJCYTools] 密码重置 Token",
    body: [
      `账号：${user.email}`,
      `重置 Token：${token}`,
      `有效期至：${expiresAt}`,
      `入口：${getAppEntryUrl(env)}`,
      "打开登录页后切换到「重置密码」，粘贴 Token 并设置新密码。",
    ].join("\n"),
  };
}

function buildRegistrationNotification({ env, user, teamName }) {
  return {
    subject: "[DJCYTools] 邮箱注册成功",
    body: [
      `${user.name || user.email}，你好。`,
      `你的账号 ${user.email} 已注册成功。`,
      `工作台：${teamName}`,
      `入口：${getAppEntryUrl(env)}`,
      "现在可以登录工作台，创建项目、生成剧本并继续生成真实短视频。",
    ].join("\n"),
  };
}

export function createTeamInvite(rootDir, env, session, { email, name, role } = {}) {
  const db = getDatabase(rootDir, env);
  const invitedEmail = normalizeEmail(email);
  assertValidEmail(invitedEmail);
  const normalizedRole = normalizeRole(role || "viewer");
  if (normalizedRole === "owner") {
    throw createDatabaseError(400, "邀请不能直接授予所有者角色，请先邀请为编辑者或查看者。", "INVITE_OWNER_FORBIDDEN");
  }
  const timestamp = nowIso();
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  let invite;
  let notification;
  execTransaction(db, () => {
    db.prepare(
      `UPDATE team_invites
       SET status = 'expired', updated_at = ?
       WHERE team_id = ? AND invited_email = ? AND status = 'pending'`,
    ).run(timestamp, session.team.id, invitedEmail);
    db.prepare(
      `UPDATE notification_outbox
       SET status = 'expired', updated_at = ?
       WHERE team_id = ? AND recipient = ? AND target_type = 'team_invite' AND status = 'queued'`,
    ).run(timestamp, session.team.id, invitedEmail);
    const inviteId = randomId("invite");
    db.prepare(
      `INSERT INTO team_invites(id, team_id, invited_email, invited_name, role, token_hash, created_by_user_id, status, expires_at, created_at, updated_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    ).run(
      inviteId,
      session.team.id,
      invitedEmail,
      String(name || "").trim().slice(0, 40),
      normalizedRole,
      hashToken(token),
      session.user.id,
      expiresAt,
      timestamp,
      timestamp,
    );
    const row = db.prepare("SELECT * FROM team_invites WHERE token_hash = ?").get(hashToken(token));
    invite = invitePayload(row, token);
    const message = buildInviteNotification({ env, session, invite, token });
    notification = insertNotificationOutboxEntry(db, {
      teamId: session.team.id,
      kind: "team_invite",
      recipient: invitedEmail,
      subject: message.subject,
      body: message.body,
      payload: { email: invitedEmail, role: invite.roleValue, expiresAt, deliveryMode: "local_outbox" },
      targetType: "team_invite",
      targetId: inviteId,
      createdByUserId: session.user.id,
      timestamp,
    });
  });
  appendAuditLogToDatabase(rootDir, env, session, {
    action: "team.invite.created",
    targetType: "team_invite",
    targetId: invite.id,
    detail: { email: invitedEmail, role: invite.roleValue, notificationId: notification?.id || "" },
  });
  return { ...invite, notification };
}

export function listTeamInvites(rootDir, env, session) {
  const db = getDatabase(rootDir, env);
  const timestamp = nowIso();
  db.prepare("UPDATE team_invites SET status = 'expired', updated_at = ? WHERE team_id = ? AND status = 'pending' AND expires_at <= ?").run(
    timestamp,
    session.team.id,
    timestamp,
  );
  return db
    .prepare("SELECT * FROM team_invites WHERE team_id = ? ORDER BY created_at DESC LIMIT 100")
    .all(session.team.id)
    .map((row) => invitePayload(row));
}

function createSessionForMembership(db, user, membership) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.prepare("INSERT INTO sessions(token_hash, user_id, expires_at, created_at) VALUES(?, ?, ?, ?)").run(hashToken(token), user.id, expiresAt, nowIso());
  return { token, expiresAt, ...sessionPayload(user, membership) };
}

export function acceptTeamInvite(rootDir, env, { token, password, name } = {}) {
  const db = getDatabase(rootDir, env);
  assertValidPassword(password);
  const timestamp = nowIso();
  let accepted;
  execTransaction(db, () => {
    const invite = db
      .prepare(
        `SELECT team_invites.*, teams.name AS team_name
         FROM team_invites
         JOIN teams ON teams.id = team_invites.team_id
         WHERE team_invites.token_hash = ?`,
      )
      .get(hashToken(token || ""));
    if (!invite || invite.status !== "pending") {
      throw createDatabaseError(404, "邀请不存在或已经失效。", "INVITE_NOT_FOUND");
    }
    if (new Date(invite.expires_at).getTime() <= Date.now()) {
      db.prepare("UPDATE team_invites SET status = 'expired', updated_at = ? WHERE id = ?").run(timestamp, invite.id);
      throw createDatabaseError(410, "邀请已经过期，请让团队所有者重新发送。", "INVITE_EXPIRED");
    }

    const email = normalizeEmail(invite.invited_email);
    let user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (user?.password_hash) {
      if (!verifyPassword(password, user.password_hash)) {
        throw createDatabaseError(401, "该邮箱已注册，请输入原账号密码接受邀请。", "INVALID_CREDENTIALS");
      }
    } else if (user?.id) {
      db.prepare("UPDATE users SET name = ?, password_hash = ?, updated_at = ? WHERE id = ?").run(
        String(name || invite.invited_name || email.split("@")[0]).trim().slice(0, 40),
        hashPassword(password),
        timestamp,
        user.id,
      );
      user = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
    } else {
      const userId = stableId("user", email);
      db.prepare(
        `INSERT INTO users(id, email, name, password_hash, created_at, updated_at)
         VALUES(?, ?, ?, ?, ?, ?)`,
      ).run(
        userId,
        email,
        String(name || invite.invited_name || email.split("@")[0]).trim().slice(0, 40),
        hashPassword(password),
        timestamp,
        timestamp,
      );
      user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
    }

    db.prepare("INSERT OR REPLACE INTO team_members(team_id, user_id, role, created_at, updated_at) VALUES(?, ?, ?, COALESCE((SELECT created_at FROM team_members WHERE team_id = ? AND user_id = ?), ?), ?)").run(
      invite.team_id,
      user.id,
      normalizeRole(invite.role),
      invite.team_id,
      user.id,
      timestamp,
      timestamp,
    );
    db.prepare("UPDATE team_invites SET status = 'accepted', accepted_at = ?, updated_at = ? WHERE id = ?").run(timestamp, timestamp, invite.id);
    accepted = createSessionForMembership(db, user, {
      role: normalizeRole(invite.role),
      team_id: invite.team_id,
      team_name: invite.team_name,
    });
  });
  appendAuditLogToDatabase(rootDir, env, accepted, {
    action: "team.invite.accepted",
    targetType: "team",
    targetId: accepted.team.id,
    detail: { email: accepted.user.email },
  });
  return accepted;
}

export function requestPasswordReset(rootDir, env, { email } = {}) {
  const db = getDatabase(rootDir, env);
  const normalizedEmail = normalizeEmail(email);
  const user = normalizedEmail ? db.prepare("SELECT * FROM users WHERE email = ? AND password_hash <> ''").get(normalizedEmail) : null;
  if (!user) return { ok: true, email: normalizedEmail, token: "", expiresAt: null };
  const token = crypto.randomBytes(32).toString("base64url");
  const timestamp = nowIso();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  let notification;
  execTransaction(db, () => {
    db.prepare("UPDATE password_reset_tokens SET status = 'expired' WHERE user_id = ? AND status = 'pending'").run(user.id);
    db.prepare(
      `UPDATE notification_outbox
       SET status = 'expired', updated_at = ?
       WHERE user_id = ? AND target_type = 'password_reset' AND status = 'queued'`,
    ).run(timestamp, user.id);
    const resetId = randomId("reset");
    db.prepare("INSERT INTO password_reset_tokens(id, user_id, token_hash, status, expires_at, created_at) VALUES(?, ?, ?, 'pending', ?, ?)").run(
      resetId,
      user.id,
      hashToken(token),
      expiresAt,
      timestamp,
    );
    const membership = readPrimaryMembershipForUser(db, user.id);
    const message = buildPasswordResetNotification({ env, user, token, expiresAt });
    notification = insertNotificationOutboxEntry(db, {
      teamId: membership?.team_id || null,
      userId: user.id,
      kind: "password_reset",
      recipient: normalizedEmail,
      subject: message.subject,
      body: message.body,
      payload: { email: normalizedEmail, expiresAt, deliveryMode: "local_outbox" },
      targetType: "password_reset",
      targetId: resetId,
      createdByUserId: null,
      timestamp,
    });
  });
  appendAuditLogToDatabase(rootDir, env, { user, team: null }, {
    action: "auth.password_reset.requested",
    targetType: "user",
    targetId: user.id,
    detail: { email: normalizedEmail, notificationId: notification?.id || "" },
  });
  return {
    ok: true,
    email: normalizedEmail,
    token,
    expiresAt,
    notificationQueued: Boolean(notification),
    notificationId: notification?.id || "",
    notification: notification || null,
  };
}

export function resetPassword(rootDir, env, { token, password } = {}) {
  assertValidPassword(password);
  const db = getDatabase(rootDir, env);
  const timestamp = nowIso();
  let user;
  execTransaction(db, () => {
    const row = db
      .prepare(
        `SELECT password_reset_tokens.*, users.email, users.name
         FROM password_reset_tokens
         JOIN users ON users.id = password_reset_tokens.user_id
         WHERE password_reset_tokens.token_hash = ?`,
      )
      .get(hashToken(token || ""));
    if (!row || row.status !== "pending") {
      throw createDatabaseError(404, "重置链接不存在或已经使用。", "RESET_TOKEN_NOT_FOUND");
    }
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      db.prepare("UPDATE password_reset_tokens SET status = 'expired' WHERE id = ?").run(row.id);
      throw createDatabaseError(410, "重置链接已经过期，请重新申请。", "RESET_TOKEN_EXPIRED");
    }
    db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(hashPassword(password), timestamp, row.user_id);
    db.prepare("UPDATE password_reset_tokens SET status = 'used', used_at = ? WHERE id = ?").run(timestamp, row.id);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(row.user_id);
    user = { id: row.user_id, email: row.email, name: row.name };
  });
  appendAuditLogToDatabase(rootDir, env, { user, team: null }, {
    action: "auth.password_reset.completed",
    targetType: "user",
    targetId: user.id,
    detail: { email: user.email },
  });
  return { ok: true, email: user.email };
}

export function changePassword(rootDir, env, session, { currentPassword, newPassword } = {}, sessionToken = "") {
  assertValidPassword(newPassword);
  const db = getDatabase(rootDir, env);
  const user = db.prepare("SELECT * FROM users WHERE id = ? AND password_hash <> ''").get(session.user.id);
  if (!user || !verifyPassword(currentPassword, user.password_hash)) {
    throw createDatabaseError(401, "当前密码不正确", "INVALID_CURRENT_PASSWORD");
  }
  if (verifyPassword(newPassword, user.password_hash)) {
    throw createDatabaseError(400, "新密码不能与当前密码相同", "PASSWORD_UNCHANGED");
  }

  execTransaction(db, () => {
    db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(hashPassword(newPassword), nowIso(), user.id);
    if (sessionToken) {
      db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?").run(user.id, hashToken(sessionToken));
    } else {
      db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
    }
  });
  appendAuditLogToDatabase(rootDir, env, session, {
    action: "auth.password_changed",
    targetType: "user",
    targetId: user.id,
    detail: { email: user.email },
  });
  return { ok: true, email: user.email };
}

export function appendAuditLogToDatabase(rootDir, env, session, { action, targetType = "", targetId = "", detail = {} } = {}) {
  if (!action) return null;
  const db = getDatabase(rootDir, env);
  const row = {
    id: randomId("audit"),
    teamId: session?.team?.id || null,
    userId: session?.user?.id || null,
    action,
    targetType,
    targetId,
    detail,
    createdAt: nowIso(),
  };
  db.prepare(
    `INSERT INTO audit_logs(id, team_id, user_id, action, target_type, target_id, detail_json, created_at)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.teamId, row.userId, action, targetType, targetId, jsonStringify(detail, {}), row.createdAt);
  return row;
}

export function readAuditLogsFromDatabase(rootDir, env, session) {
  const db = getDatabase(rootDir, env);
  return db
    .prepare(
      `SELECT audit_logs.*, users.name AS user_name, users.email AS user_email
       FROM audit_logs
       LEFT JOIN users ON users.id = audit_logs.user_id
       WHERE audit_logs.team_id = ? OR audit_logs.user_id = ?
       ORDER BY audit_logs.created_at DESC
       LIMIT 300`,
    )
    .all(session.team.id, session.user.id)
    .map((row) => ({
      id: row.id,
      action: row.action,
      targetType: row.target_type || "",
      targetId: row.target_id || "",
      detail: parseJson(row.detail_json, {}),
      actor: row.user_name || row.user_email || "系统",
      createdAt: row.created_at,
    }));
}

export function readNotificationOutboxFromDatabase(rootDir, env, session) {
  const db = getDatabase(rootDir, env);
  return db
    .prepare(
      `SELECT notification_outbox.*
       FROM notification_outbox
       WHERE notification_outbox.team_id = ?
          OR notification_outbox.user_id IN (SELECT user_id FROM team_members WHERE team_id = ?)
       ORDER BY notification_outbox.created_at DESC
       LIMIT 200`,
    )
    .all(session.team.id, session.team.id)
    .map(notificationPayload);
}

function readNotificationRowForSession(db, session, notificationId) {
  return db
    .prepare(
      `SELECT *
       FROM notification_outbox
       WHERE id = ?
         AND (
           team_id = ?
           OR user_id IN (SELECT user_id FROM team_members WHERE team_id = ?)
         )`,
    )
    .get(notificationId, session.team.id, session.team.id);
}

export function readNotificationOutboxEntryFromDatabase(rootDir, env, session, notificationId) {
  const db = getDatabase(rootDir, env);
  const id = String(notificationId || "").trim();
  if (!id) throw createDatabaseError(400, "通知 ID 不能为空", "NOTIFICATION_ID_REQUIRED");
  const row = readNotificationRowForSession(db, session, id);
  if (!row) throw createDatabaseError(404, "通知不存在或不属于当前团队", "NOTIFICATION_NOT_FOUND");
  return notificationPayload(row);
}

export function updateNotificationDeliveryStatus(rootDir, env, session, notificationId, { status, channel = "", delivery = null } = {}) {
  const db = getDatabase(rootDir, env);
  const id = String(notificationId || "").trim();
  const nextStatus = String(status || "").trim();
  const nextChannel = String(channel || "").trim();
  if (!id) throw createDatabaseError(400, "通知 ID 不能为空", "NOTIFICATION_ID_REQUIRED");
  if (!["queued", "sent", "failed", "expired"].includes(nextStatus)) {
    throw createDatabaseError(400, "通知状态只能是 queued、sent、failed 或 expired", "INVALID_NOTIFICATION_STATUS");
  }

  let notification;
  execTransaction(db, () => {
    const row = readNotificationRowForSession(db, session, id);
    if (!row) throw createDatabaseError(404, "通知不存在或不属于当前团队", "NOTIFICATION_NOT_FOUND");
    const timestamp = nowIso();
    const payload = parseJson(row.payload_json, {});
    const nextPayload = delivery
      ? {
          ...payload,
          deliveryMode: nextChannel || payload.deliveryMode || row.channel,
          deliveryAttempts: [
            {
              at: timestamp,
              channel: nextChannel || row.channel,
              status: nextStatus,
              ...delivery,
            },
            ...(Array.isArray(payload.deliveryAttempts) ? payload.deliveryAttempts : []),
          ].slice(0, 10),
        }
      : payload;
    db.prepare("UPDATE notification_outbox SET status = ?, channel = ?, payload_json = ?, updated_at = ?, sent_at = ? WHERE id = ?").run(
      nextStatus,
      nextChannel || row.channel,
      jsonStringify(nextPayload, {}),
      timestamp,
      nextStatus === "sent" ? timestamp : null,
      id,
    );
    notification = notificationPayload(db.prepare("SELECT * FROM notification_outbox WHERE id = ?").get(id));
  });
  appendAuditLogToDatabase(rootDir, env, session, {
    action: "notification.delivery_status_updated",
    targetType: "notification",
    targetId: id,
    detail: { status: nextStatus, kind: notification.kind, recipient: notification.recipient },
  });
  return notification;
}

export function updateNotificationDeliveryStatusById(rootDir, env, notificationId, { status, channel = "", delivery = null } = {}) {
  const db = getDatabase(rootDir, env);
  const id = String(notificationId || "").trim();
  const nextStatus = String(status || "").trim();
  const nextChannel = String(channel || "").trim();
  if (!id) throw createDatabaseError(400, "通知 ID 不能为空", "NOTIFICATION_ID_REQUIRED");
  if (!["queued", "sent", "failed", "expired"].includes(nextStatus)) {
    throw createDatabaseError(400, "通知状态只能是 queued、sent、failed 或 expired", "INVALID_NOTIFICATION_STATUS");
  }

  let notification;
  execTransaction(db, () => {
    const row = db.prepare("SELECT * FROM notification_outbox WHERE id = ?").get(id);
    if (!row) throw createDatabaseError(404, "通知不存在", "NOTIFICATION_NOT_FOUND");
    const timestamp = nowIso();
    const payload = parseJson(row.payload_json, {});
    const nextPayload = delivery
      ? {
          ...payload,
          deliveryMode: nextChannel || payload.deliveryMode || row.channel,
          deliveryAttempts: [
            {
              at: timestamp,
              channel: nextChannel || row.channel,
              status: nextStatus,
              ...delivery,
            },
            ...(Array.isArray(payload.deliveryAttempts) ? payload.deliveryAttempts : []),
          ].slice(0, 10),
        }
      : payload;
    db.prepare("UPDATE notification_outbox SET status = ?, channel = ?, payload_json = ?, updated_at = ?, sent_at = ? WHERE id = ?").run(
      nextStatus,
      nextChannel || row.channel,
      jsonStringify(nextPayload, {}),
      timestamp,
      nextStatus === "sent" ? timestamp : null,
      id,
    );
    notification = notificationPayload(db.prepare("SELECT * FROM notification_outbox WHERE id = ?").get(id));
  });
  return notification;
}

export function readTemplateInsightsFromDatabase(rootDir, env, session) {
  const db = getDatabase(rootDir, env);
  const rows = db
    .prepare(
      `SELECT campaign_results.template_name,
              COUNT(*) AS campaigns,
              AVG(CAST(json_extract(campaign_results.payload_json, '$.metrics.roas') AS REAL)) AS avg_roas,
              AVG(CAST(json_extract(campaign_results.payload_json, '$.metrics.ctr') AS REAL)) AS avg_ctr,
              AVG(CAST(json_extract(campaign_results.payload_json, '$.metrics.completionRate') AS REAL)) AS avg_completion
       FROM campaign_results
       JOIN projects ON projects.id = campaign_results.project_id
       WHERE projects.team_id = ?
       GROUP BY campaign_results.template_name
       ORDER BY avg_roas DESC, campaigns DESC`,
    )
    .all(session.team.id);
  return rows.map((row) => ({
    templateName: row.template_name || "未命名模板",
    campaigns: Number(row.campaigns || 0),
    avgRoas: Number(Number(row.avg_roas || 0).toFixed(2)),
    avgCtr: Number(Number(row.avg_ctr || 0).toFixed(2)),
    avgCompletionRate: Number(Number(row.avg_completion || 0).toFixed(2)),
  }));
}

function countTeamOwners(db, teamId) {
  return Number(
    db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM team_members
         JOIN users ON users.id = team_members.user_id
         WHERE team_members.team_id = ? AND team_members.role = 'owner' AND users.password_hash <> ''`,
      )
      .get(teamId)?.count || 0,
  );
}

export function updateTeamMemberInDatabase(rootDir, env, session, userId, patch = {}) {
  const db = getDatabase(rootDir, env);
  const targetUserId = String(userId || "").trim();
  if (!targetUserId) throw createDatabaseError(400, "成员 ID 不能为空", "TEAM_MEMBER_ID_REQUIRED");
  let workspace;
  execTransaction(db, () => {
    const member = db
      .prepare(
        `SELECT team_members.role, users.name, users.email
         FROM team_members
         JOIN users ON users.id = team_members.user_id
         WHERE team_members.team_id = ? AND team_members.user_id = ?`,
      )
      .get(session.team.id, targetUserId);
    if (!member) throw createDatabaseError(404, "成员不存在或不属于当前团队", "TEAM_MEMBER_NOT_FOUND");

    const nextRole = patch.role ? normalizeRole(patch.role) : normalizeRole(member.role);
    if (normalizeRole(member.role) === "owner" && nextRole !== "owner" && countTeamOwners(db, session.team.id) <= 1) {
      throw createDatabaseError(409, "不能降级最后一个所有者", "LAST_OWNER_REQUIRED");
    }

    const nextName = String(patch.name || member.name || "").trim().slice(0, 40);
    if (nextName) {
      db.prepare("UPDATE users SET name = ?, updated_at = ? WHERE id = ?").run(nextName, nowIso(), targetUserId);
    }
    db.prepare("UPDATE team_members SET role = ?, updated_at = ? WHERE team_id = ? AND user_id = ?").run(
      nextRole,
      nowIso(),
      session.team.id,
      targetUserId,
    );
    workspace = readWorkspaceFromDatabase(rootDir, env, session);
  });
  appendAuditLogToDatabase(rootDir, env, session, {
    action: "team.member.updated",
    targetType: "user",
    targetId: targetUserId,
    detail: { role: patch.role || "", name: patch.name || "" },
  });
  return workspace;
}

export function removeTeamMemberFromDatabase(rootDir, env, session, userId) {
  const db = getDatabase(rootDir, env);
  const targetUserId = String(userId || "").trim();
  if (!targetUserId) throw createDatabaseError(400, "成员 ID 不能为空", "TEAM_MEMBER_ID_REQUIRED");
  if (targetUserId === session.user.id) throw createDatabaseError(409, "不能移除当前登录账号", "REMOVE_SELF_FORBIDDEN");
  let workspace;
  execTransaction(db, () => {
    const member = db.prepare("SELECT role FROM team_members WHERE team_id = ? AND user_id = ?").get(session.team.id, targetUserId);
    if (!member) throw createDatabaseError(404, "成员不存在或不属于当前团队", "TEAM_MEMBER_NOT_FOUND");
    if (normalizeRole(member.role) === "owner" && countTeamOwners(db, session.team.id) <= 1) {
      throw createDatabaseError(409, "不能移除最后一个所有者", "LAST_OWNER_REQUIRED");
    }
    db.prepare("DELETE FROM team_members WHERE team_id = ? AND user_id = ?").run(session.team.id, targetUserId);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(targetUserId);
    workspace = readWorkspaceFromDatabase(rootDir, env, session);
  });
  appendAuditLogToDatabase(rootDir, env, session, {
    action: "team.member.removed",
    targetType: "user",
    targetId: targetUserId,
  });
  return workspace;
}

export function appendCampaignResultFromPublicApi(rootDir, env, projectId, resultValue = {}, teamId = null) {
  const db = getDatabase(rootDir, env);
  let saved;
  execTransaction(db, () => {
    const row = teamId
      ? db.prepare("SELECT * FROM projects WHERE id = ? AND team_id = ?").get(projectId, teamId)
      : db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
    if (!row) throw createDatabaseError(404, "项目不存在", "PROJECT_NOT_FOUND");
    const project = readProject(db, row);
    const activeVersion = project.versions.find((version) => version.id === project.activeVersionId) || project.versions[0] || {};
    const result = normalizeCampaignResult(resultValue, {
      versionId: activeVersion.id,
      versionName: activeVersion.name,
      templateName: activeVersion.templateName,
      materialName: activeVersion.selectedTitle || project.name,
    });
    db.prepare(
      "INSERT INTO campaign_results(id, project_id, version_id, version_name, template_name, payload_json, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)",
    ).run(
      result.id,
      project.id,
      result.versionId,
      result.versionName,
      result.templateName,
      jsonStringify(result, {}),
      result.createdAt,
    );
    db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(nowIso(), project.id);
    saved = result;
  });
  appendAuditLogToDatabase(rootDir, env, null, {
    action: "public.campaign_result.received",
    targetType: "project",
    targetId: projectId,
    detail: { channel: saved.channel, materialName: saved.materialName, roas: saved.metrics?.roas || 0 },
  });
  return saved;
}

function normalizeTrendSnapshotPayload(payload = {}) {
  const source = payload && typeof payload === "object" ? payload : {};
  const normalizeArray = (value) => (Array.isArray(value) ? value.filter((item) => item && typeof item === "object").slice(0, 100) : []);
  return {
    source: String(source.source || "manual").trim().slice(0, 80) || "manual",
    tags: normalizeArray(source.tags),
    templateSignals: normalizeArray(source.templateSignals),
    marketNotes: normalizeArray(source.marketNotes),
  };
}

function trendSnapshotPayload(row) {
  return {
    id: row.id,
    source: row.source,
    tags: parseJson(row.tags_json, []),
    templateSignals: parseJson(row.template_signals_json, []),
    marketNotes: parseJson(row.market_notes_json, []),
    payload: parseJson(row.payload_json, {}),
    createdAt: row.created_at,
  };
}

export function createTrendSnapshotInDatabase(rootDir, env, session, payload) {
  const db = getDatabase(rootDir, env);
  const snapshot = normalizeTrendSnapshotPayload(payload);
  const row = {
    id: randomId("trend"),
    teamId: session.team.id,
    source: snapshot.source,
    tags: snapshot.tags,
    templateSignals: snapshot.templateSignals,
    marketNotes: snapshot.marketNotes,
    createdAt: nowIso(),
  };
  db.prepare(
    `INSERT INTO trend_snapshots(id, team_id, source, tags_json, template_signals_json, market_notes_json, payload_json, created_at)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.teamId,
    row.source,
    jsonStringify(row.tags, []),
    jsonStringify(row.templateSignals, []),
    jsonStringify(row.marketNotes, []),
    jsonStringify(payload, {}),
    row.createdAt,
  );
  appendAuditLogToDatabase(rootDir, env, session, {
    action: "trend.snapshot.imported",
    targetType: "trend_snapshot",
    targetId: row.id,
    detail: { source: row.source, tags: row.tags.length, templateSignals: row.templateSignals.length },
  });
  return {
    id: row.id,
    source: row.source,
    tags: row.tags,
    templateSignals: row.templateSignals,
    marketNotes: row.marketNotes,
    createdAt: row.createdAt,
  };
}

export function readTrendSnapshotsFromDatabase(rootDir, env, session) {
  const db = getDatabase(rootDir, env);
  return db
    .prepare("SELECT * FROM trend_snapshots WHERE team_id = ? OR team_id IS NULL ORDER BY created_at DESC LIMIT 20")
    .all(session.team.id)
    .map((row) => trendSnapshotPayload(row));
}

export function readLatestTrendSnapshotFromDatabase(rootDir, env, session) {
  const db = getDatabase(rootDir, env);
  const row = db
    .prepare("SELECT * FROM trend_snapshots WHERE team_id = ? OR team_id IS NULL ORDER BY created_at DESC LIMIT 1")
    .get(session.team.id);
  return row ? trendSnapshotPayload(row) : null;
}

function publicApiTokenPayload(row, token = "") {
  return {
    id: row.id,
    name: row.name,
    prefix: row.token_prefix,
    token,
    lastUsedAt: row.last_used_at || null,
    revokedAt: row.revoked_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createPublicApiToken(rootDir, env, session, { name } = {}) {
  const db = getDatabase(rootDir, env);
  const token = `djcy_${crypto.randomBytes(30).toString("base64url")}`;
  const timestamp = nowIso();
  const row = {
    id: randomId("api_token"),
    name: String(name || "制作流程 Token").trim().slice(0, 80) || "制作流程 Token",
    tokenPrefix: `${token.slice(0, 12)}...`,
  };
  db.prepare(
    `INSERT INTO public_api_tokens(id, team_id, name, token_hash, token_prefix, created_by_user_id, created_at, updated_at)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.id, session.team.id, row.name, hashToken(token), row.tokenPrefix, session.user.id, timestamp, timestamp);
  appendAuditLogToDatabase(rootDir, env, session, {
    action: "public_api.token.created",
    targetType: "public_api_token",
    targetId: row.id,
    detail: { name: row.name, prefix: row.tokenPrefix },
  });
  return { id: row.id, name: row.name, prefix: row.tokenPrefix, token, lastUsedAt: null, revokedAt: null, createdAt: timestamp, updatedAt: timestamp };
}

export function listPublicApiTokens(rootDir, env, session) {
  const db = getDatabase(rootDir, env);
  return db
    .prepare("SELECT * FROM public_api_tokens WHERE team_id = ? ORDER BY revoked_at IS NOT NULL, created_at DESC LIMIT 100")
    .all(session.team.id)
    .map((row) => publicApiTokenPayload(row));
}

export function revokePublicApiToken(rootDir, env, session, tokenId) {
  const db = getDatabase(rootDir, env);
  const id = String(tokenId || "").trim();
  const timestamp = nowIso();
  const row = db.prepare("SELECT * FROM public_api_tokens WHERE id = ? AND team_id = ?").get(id, session.team.id);
  if (!row) throw createDatabaseError(404, "API Token 不存在或不属于当前团队", "PUBLIC_API_TOKEN_NOT_FOUND");
  db.prepare("UPDATE public_api_tokens SET revoked_at = COALESCE(revoked_at, ?), updated_at = ? WHERE id = ?").run(timestamp, timestamp, id);
  appendAuditLogToDatabase(rootDir, env, session, {
    action: "public_api.token.revoked",
    targetType: "public_api_token",
    targetId: id,
    detail: { name: row.name, prefix: row.token_prefix },
  });
  return { ok: true };
}

export function resolvePublicApiToken(rootDir, env, token) {
  const value = String(token || "").trim();
  if (!value) return null;
  const envToken = String(env.DJCYTOOLS_PUBLIC_API_TOKEN || "").trim();
  if (envToken && value === envToken) return { source: "env", teamId: null, tokenId: "env" };
  const db = getDatabase(rootDir, env);
  const row = db.prepare("SELECT * FROM public_api_tokens WHERE token_hash = ? AND revoked_at IS NULL").get(hashToken(value));
  if (!row) return null;
  db.prepare("UPDATE public_api_tokens SET last_used_at = ?, updated_at = ? WHERE id = ?").run(nowIso(), nowIso(), row.id);
  return { source: "database", teamId: row.team_id, tokenId: row.id };
}

export function readPublicProjectExport(rootDir, env, projectId, teamId = null) {
  const db = getDatabase(rootDir, env);
  const row = teamId
    ? db.prepare("SELECT * FROM projects WHERE id = ? AND team_id = ?").get(projectId, teamId)
    : db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
  if (!row) throw createDatabaseError(404, "项目不存在", "PROJECT_NOT_FOUND");
  return readProject(db, row);
}

export function listPublicProjects(rootDir, env, teamId = null) {
  const db = getDatabase(rootDir, env);
  const sql = `SELECT projects.id, projects.name, projects.status, projects.updated_at, teams.name AS team_name,
              COUNT(versions.id) AS version_count
       FROM projects
       JOIN teams ON teams.id = projects.team_id
       LEFT JOIN versions ON versions.project_id = projects.id
       ${teamId ? "WHERE projects.team_id = ?" : ""}
       GROUP BY projects.id
       ORDER BY projects.updated_at DESC, projects.created_at DESC
       LIMIT 200`;
  return db
    .prepare(sql)
    .all(...(teamId ? [teamId] : []))
    .map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      teamName: row.team_name,
      versionCount: Number(row.version_count || 0),
      updatedAt: row.updated_at,
    }));
}

const postgresSchemaSql = `
CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS teams (id TEXT PRIMARY KEY, name TEXT NOT NULL, active_project_id TEXT, settings_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS team_members (team_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (team_id, user_id));
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS team_invites (id TEXT PRIMARY KEY, team_id TEXT NOT NULL, invited_email TEXT NOT NULL, invited_name TEXT, role TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL, created_by_user_id TEXT, status TEXT NOT NULL DEFAULT 'pending', expires_at TEXT NOT NULL, accepted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS password_reset_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL, status TEXT NOT NULL DEFAULT 'pending', expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notification_outbox (id TEXT PRIMARY KEY, team_id TEXT, user_id TEXT, kind TEXT NOT NULL, channel TEXT NOT NULL DEFAULT 'local_outbox', recipient TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', target_type TEXT, target_id TEXT, payload_json TEXT NOT NULL DEFAULT '{}', created_by_user_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, sent_at TEXT);
CREATE TABLE IF NOT EXISTS public_api_tokens (id TEXT PRIMARY KEY, team_id TEXT NOT NULL, name TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL, token_prefix TEXT NOT NULL, created_by_user_id TEXT, last_used_at TEXT, revoked_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, team_id TEXT NOT NULL, owner_user_id TEXT, name TEXT NOT NULL, status TEXT NOT NULL, active_version_id TEXT, brief_json TEXT NOT NULL DEFAULT '{}', params_json TEXT NOT NULL DEFAULT '{}', payload_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS versions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, position INTEGER NOT NULL, name TEXT NOT NULL, template_name TEXT, source TEXT, model TEXT, request_id TEXT, usage_json TEXT NOT NULL DEFAULT '{}', cost_usd DOUBLE PRECISION DEFAULT 0, score_json TEXT NOT NULL DEFAULT '{}', payload_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, position INTEGER NOT NULL, author TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS exports (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, position INTEGER NOT NULL, type TEXT NOT NULL, version TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS campaign_results (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, version_id TEXT, version_name TEXT, template_name TEXT, payload_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS custom_templates (id TEXT PRIMARY KEY, team_id TEXT NOT NULL, name TEXT NOT NULL, type TEXT, category TEXT, heat_rank INTEGER, heat_score DOUBLE PRECISION, tags_json TEXT NOT NULL DEFAULT '[]', payload_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ai_logs (id TEXT PRIMARY KEY, team_id TEXT NOT NULL, user_id TEXT, status TEXT NOT NULL, model TEXT, instruction TEXT, market TEXT, template TEXT, usage_json TEXT NOT NULL DEFAULT '{}', cost_usd DOUBLE PRECISION DEFAULT 0, duration_ms INTEGER DEFAULT 0, error TEXT, payload_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS analytics_events (id TEXT PRIMARY KEY, page TEXT NOT NULL, visitor_hash TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS trend_snapshots (id TEXT PRIMARY KEY, team_id TEXT, source TEXT NOT NULL, tags_json TEXT NOT NULL DEFAULT '[]', template_signals_json TEXT NOT NULL DEFAULT '[]', market_notes_json TEXT NOT NULL DEFAULT '[]', payload_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, team_id TEXT, user_id TEXT, action TEXT NOT NULL, target_type TEXT, target_id TEXT, detail_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_projects_team ON projects(team_id);
CREATE INDEX IF NOT EXISTS idx_versions_project ON versions(project_id, position);
CREATE INDEX IF NOT EXISTS idx_ai_logs_team_created ON ai_logs(team_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_page_created ON analytics_events(page, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invites_team_status ON team_invites(team_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_password_reset_user_status ON password_reset_tokens(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_outbox_team_status ON notification_outbox(team_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_outbox_user_created ON notification_outbox(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_public_api_tokens_team ON public_api_tokens(team_id, revoked_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_team_created ON audit_logs(team_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trend_snapshots_team_created ON trend_snapshots(team_id, created_at DESC);
`.trim();

function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

function insertStatementsForRows(tableName, rows) {
  if (!rows.length) return [`-- ${tableName}: no rows`];
  const columns = Object.keys(rows[0]);
  return rows.map((row) => {
    const values = columns.map((column) => sqlLiteral(row[column])).join(", ");
    return `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES (${values}) ON CONFLICT DO NOTHING;`;
  });
}

export function exportPostgresMigrationSql(rootDir, env, session) {
  const db = getDatabase(rootDir, env);
  const teamId = session.team.id;
  const projectIds = db.prepare("SELECT id FROM projects WHERE team_id = ?").all(teamId).map((row) => row.id);
  const memberUserIds = db.prepare("SELECT user_id FROM team_members WHERE team_id = ?").all(teamId).map((row) => row.user_id);
  const placeholders = projectIds.map(() => "?").join(", ");
  const userPlaceholders = memberUserIds.map(() => "?").join(", ");
  const tableRows = [
    ["app_meta", db.prepare("SELECT * FROM app_meta").all()],
    ["users", memberUserIds.length ? db.prepare(`SELECT * FROM users WHERE id IN (${userPlaceholders})`).all(...memberUserIds) : []],
    ["teams", db.prepare("SELECT * FROM teams WHERE id = ?").all(teamId)],
    ["team_members", db.prepare("SELECT * FROM team_members WHERE team_id = ?").all(teamId)],
    ["team_invites", db.prepare("SELECT * FROM team_invites WHERE team_id = ?").all(teamId)],
    [
      "notification_outbox",
      db
        .prepare(
          `SELECT *
           FROM notification_outbox
           WHERE team_id = ?
              OR user_id IN (SELECT user_id FROM team_members WHERE team_id = ?)`,
        )
        .all(teamId, teamId),
    ],
    ["public_api_tokens", db.prepare("SELECT * FROM public_api_tokens WHERE team_id = ?").all(teamId)],
    ["projects", db.prepare("SELECT * FROM projects WHERE team_id = ?").all(teamId)],
    ["versions", projectIds.length ? db.prepare(`SELECT * FROM versions WHERE project_id IN (${placeholders})`).all(...projectIds) : []],
    ["comments", projectIds.length ? db.prepare(`SELECT * FROM comments WHERE project_id IN (${placeholders})`).all(...projectIds) : []],
    ["exports", projectIds.length ? db.prepare(`SELECT * FROM exports WHERE project_id IN (${placeholders})`).all(...projectIds) : []],
    ["campaign_results", projectIds.length ? db.prepare(`SELECT * FROM campaign_results WHERE project_id IN (${placeholders})`).all(...projectIds) : []],
    ["custom_templates", db.prepare("SELECT * FROM custom_templates WHERE team_id = ?").all(teamId)],
    ["ai_logs", db.prepare("SELECT * FROM ai_logs WHERE team_id = ?").all(teamId)],
    ["audit_logs", db.prepare("SELECT * FROM audit_logs WHERE team_id = ?").all(teamId)],
    ["trend_snapshots", db.prepare("SELECT * FROM trend_snapshots WHERE team_id = ? OR team_id IS NULL").all(teamId)],
    ["analytics_events", db.prepare("SELECT * FROM analytics_events").all()],
  ];
  const sections = tableRows.flatMap(([tableName, rows]) => [`\n-- ${tableName}`, ...insertStatementsForRows(tableName, rows)]);
  return [
    "-- DJCYTools PostgreSQL migration pack",
    `-- Team: ${session.team.name} (${teamId})`,
    `-- Generated at: ${nowIso()}`,
    "BEGIN;",
    postgresSchemaSql,
    ...sections,
    "COMMIT;",
    "",
  ].join("\n");
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
  return createSessionForMembership(db, user, membership);
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
  let registrationNotification = null;

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
    ).run(teamId, ownedTeamName, jsonStringify({ persistence: storageKind(db), language: "zh-CN" }, {}), timestamp, timestamp);
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

    const message = buildRegistrationNotification({
      env,
      user: { id: userId, email: normalizedEmail, name: displayName },
      teamName: ownedTeamName,
    });
    registrationNotification = insertNotificationOutboxEntry(db, {
      teamId,
      userId,
      kind: "registration_welcome",
      recipient: normalizedEmail,
      subject: message.subject,
      body: message.body,
      payload: { email: normalizedEmail, deliveryMode: "local_outbox" },
      targetType: "user",
      targetId: userId,
      createdByUserId: userId,
      timestamp,
    });
  });

  const session = createSession(rootDir, env, normalizedEmail, password);
  return {
    ...session,
    registrationNotificationId: registrationNotification?.id || "",
    registrationNotification,
  };
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
