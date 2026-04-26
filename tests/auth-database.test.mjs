import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  appendAiLogToDatabase,
  closeDatabase,
  createProjectInDatabase,
  createSession,
  deleteProjectFromDatabase,
  destroySession,
  getProjectFromDatabase,
  listProjectsFromDatabase,
  readAiLogsFromDatabase,
  readSession,
  readWorkspaceFromDatabase,
  registerUser,
  updateProjectInDatabase,
  writeWorkspaceToDatabase,
} from "../server/database.mjs";

const env = {
  DJCYTOOLS_ADMIN_EMAIL: "owner@example.test",
  DJCYTOOLS_ADMIN_PASSWORD: "CorrectHorseBatteryStaple",
  DJCYTOOLS_ADMIN_NAME: "项目所有者",
  DJCYTOOLS_TEAM_NAME: "测试团队",
};

test("SQLite store seeds auth, migrates workspace shape and enforces sessions", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "djcytools-db-"));
  try {
    assert.throws(() => createSession(rootDir, env, env.DJCYTOOLS_ADMIN_EMAIL, "wrong"), /账号或密码不正确/);
    const session = createSession(rootDir, env, env.DJCYTOOLS_ADMIN_EMAIL, env.DJCYTOOLS_ADMIN_PASSWORD);

    assert.equal(session.user.email, env.DJCYTOOLS_ADMIN_EMAIL);
    assert.equal(session.membership.role, "owner");
    assert.equal(readSession(rootDir, env, session.token).user.email, env.DJCYTOOLS_ADMIN_EMAIL);

    const workspace = readWorkspaceFromDatabase(rootDir, env, session);
    assert.equal(workspace.settings.persistence, "sqlite");
    assert.equal(workspace.team.name, env.DJCYTOOLS_TEAM_NAME);
    assert.ok(workspace.projects.length >= 1);

    const renamed = {
      ...workspace,
      team: { ...workspace.team, name: "改名后的团队" },
      projects: [{ ...workspace.projects[0], name: "数据库项目", updatedAt: new Date().toISOString() }],
      activeProjectId: workspace.projects[0].id,
    };
    writeWorkspaceToDatabase(rootDir, env, session, renamed);
    const saved = readWorkspaceFromDatabase(rootDir, env, session);

    assert.equal(saved.team.name, "改名后的团队");
    assert.equal(saved.projects[0].name, "数据库项目");

    const createdProject = createProjectInDatabase(rootDir, env, session, {
      id: "proj_crud_1",
      name: "CRUD 项目",
      status: "草稿",
      brief: { title: "CRUD 项目" },
      params: {},
      versions: [],
      comments: [],
      exports: [],
      campaignResults: [],
    });
    assert.equal(createdProject.name, "CRUD 项目");
    assert.equal(getProjectFromDatabase(rootDir, env, session, "proj_crud_1").status, "草稿");
    assert.ok(listProjectsFromDatabase(rootDir, env, session).some((project) => project.id === "proj_crud_1"));

    const updatedProject = updateProjectInDatabase(rootDir, env, session, "proj_crud_1", {
      name: "CRUD 改名项目",
      status: "评审中",
    });
    assert.equal(updatedProject.name, "CRUD 改名项目");
    assert.equal(updatedProject.status, "评审中");

    const afterProjectDelete = deleteProjectFromDatabase(rootDir, env, session, "proj_crud_1");
    assert.equal(afterProjectDelete.projects.some((project) => project.id === "proj_crud_1"), false);
    assert.throws(() => getProjectFromDatabase(rootDir, env, session, "proj_crud_1"), /项目不存在/);

    appendAiLogToDatabase(rootDir, env, { id: "log_1", status: "success", model: "deepseek", usage: { total_tokens: 10 }, costUsd: 0.01 }, session);
    const logs = readAiLogsFromDatabase(rootDir, env, session);
    assert.equal(logs.totals.count, 1);
    assert.equal(logs.totals.tokens, 10);

    const registered = registerUser(rootDir, env, {
      email: "new-user@example.test",
      password: "AnotherStrongPassword",
      name: "新用户",
      teamName: "新用户团队",
    });
    assert.equal(registered.user.email, "new-user@example.test");
    assert.equal(registered.membership.role, "owner");
    const registeredWorkspace = readWorkspaceFromDatabase(rootDir, env, registered);
    assert.equal(registeredWorkspace.team.name, "新用户团队");
    assert.notEqual(registeredWorkspace.team.id, saved.team.id);
    assert.throws(
      () => registerUser(rootDir, env, { email: "new-user@example.test", password: "AnotherStrongPassword" }),
      /该邮箱已经注册/,
    );

    destroySession(rootDir, env, session.token);
    assert.equal(readSession(rootDir, env, session.token), null);
  } finally {
    closeDatabase(rootDir);
    await rm(rootDir, { recursive: true, force: true });
  }
});
