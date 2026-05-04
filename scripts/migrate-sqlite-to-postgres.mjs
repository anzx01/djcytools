import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";
import { createSession, exportPostgresMigrationSql, closeDatabase } from "../server/database.mjs";

const { Client } = pg;

function parseDotEnv(raw = "") {
  const parsed = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

async function loadEnv(rootDir) {
  const raw = await readFile(path.join(rootDir, ".env"), "utf8").catch(() => "");
  return { ...parseDotEnv(raw), ...process.env };
}

function requirePostgresUrl(env) {
  const url = String(env.DJCYTOOLS_DATABASE_URL || "").trim();
  if (!/^postgres(?:ql)?:\/\//.test(url)) {
    throw new Error("DJCYTOOLS_DATABASE_URL must be a postgresql:// or postgres:// connection string.");
  }
  return url;
}

async function main() {
  const rootDir = process.cwd();
  const env = await loadEnv(rootDir);
  const email = env.DJCYTOOLS_ADMIN_EMAIL || "admin@djcytools.local";
  const password = env.DJCYTOOLS_ADMIN_PASSWORD || "DJCYTools@2026";
  const dryRun = process.argv.includes("--dry-run");
  const databaseUrl = dryRun ? "" : requirePostgresUrl(env);
  const outArg = process.argv.find((item) => item.startsWith("--out="));
  const outFile = outArg ? outArg.slice("--out=".length) : path.join(rootDir, "data", `djcytools-postgres-${new Date().toISOString().slice(0, 10)}.sql`);

  const session = createSession(rootDir, env, email, password);
  const sql = exportPostgresMigrationSql(rootDir, env, session);

  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, sql, "utf8");

  if (dryRun) {
    console.log(`PostgreSQL migration SQL written to ${outFile}`);
    closeDatabase(rootDir, env);
    return;
  }

  const client = new Client({
    connectionString: databaseUrl,
    ssl: env.DJCYTOOLS_DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  try {
    await client.query(sql);
    const { rows } = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'users', 'teams', 'team_members', 'projects', 'versions', 'comments',
          'exports', 'campaign_results', 'custom_templates', 'ai_logs',
          'analytics_events', 'team_invites', 'password_reset_tokens',
          'notification_outbox', 'public_api_tokens', 'trend_snapshots', 'audit_logs',
          'app_meta', 'sessions'
        )
      ORDER BY table_name
    `);
    console.log(`PostgreSQL migration completed for team ${session.team.name} (${session.team.id}).`);
    console.log(`SQL backup: ${outFile}`);
    console.log(`Verified tables: ${rows.map((row) => row.table_name).join(", ")}`);
  } finally {
    await client.end();
    closeDatabase(rootDir, env);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
