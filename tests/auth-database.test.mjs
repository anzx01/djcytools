import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  appendAiLogToDatabase,
  acceptTeamInvite,
  appendAuditLogToDatabase,
  changePassword,
  closeDatabase,
  createPublicApiToken,
  createTrendSnapshotInDatabase,
  createTeamInvite,
  createProjectInDatabase,
  createSession,
  deleteProjectFromDatabase,
  destroySession,
  getProjectFromDatabase,
  listTeamInvites,
  listProjectsFromDatabase,
  readAuditLogsFromDatabase,
  readAiLogsFromDatabase,
  readTemplateInsightsFromDatabase,
  readLatestTrendSnapshotFromDatabase,
  readNotificationOutboxFromDatabase,
  readSession,
  readTrendSnapshotsFromDatabase,
  listPublicApiTokens,
  resolvePublicApiToken,
  revokePublicApiToken,
  readWorkspaceFromDatabase,
  registerUser,
  requestPasswordReset,
  resetPassword,
  removeTeamMemberFromDatabase,
  updateNotificationDeliveryStatus,
  updateTeamMemberInDatabase,
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
    const secondSession = createSession(rootDir, env, env.DJCYTOOLS_ADMIN_EMAIL, env.DJCYTOOLS_ADMIN_PASSWORD);

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
    assert.equal(registered.registrationNotification.kind, "registration_welcome");
    assert.match(registered.registrationNotification.body, /new-user@example\.test/);
    const registeredWorkspace = readWorkspaceFromDatabase(rootDir, env, registered);
    assert.equal(registeredWorkspace.team.name, "新用户团队");
    assert.notEqual(registeredWorkspace.team.id, saved.team.id);
    assert.throws(
      () => registerUser(rootDir, env, { email: "new-user@example.test", password: "AnotherStrongPassword" }),
      /该邮箱已经注册/,
    );

    const invite = createTeamInvite(rootDir, env, session, {
      email: "writer@example.test",
      name: "新编剧",
      role: "editor",
    });
    assert.equal(invite.email, "writer@example.test");
    assert.ok(invite.token);
    assert.equal(invite.notification.kind, "team_invite");
    assert.match(invite.notification.body, new RegExp(invite.token));
    assert.ok(listTeamInvites(rootDir, env, session).some((item) => item.id === invite.id));
    assert.equal(readNotificationOutboxFromDatabase(rootDir, env, session).some((item) => item.targetId === invite.id), true);

    const invited = acceptTeamInvite(rootDir, env, {
      token: invite.token,
      password: "InvitePassword2026",
      name: "新编剧",
    });
    assert.equal(invited.team.id, session.team.id);
    assert.equal(invited.membership.role, "editor");

    const reset = requestPasswordReset(rootDir, env, { email: "writer@example.test" });
    assert.ok(reset.token);
    const resetNotification = readNotificationOutboxFromDatabase(rootDir, env, session).find((item) => item.kind === "password_reset");
    assert.ok(resetNotification);
    assert.match(resetNotification.body, new RegExp(reset.token));
    assert.equal(updateNotificationDeliveryStatus(rootDir, env, session, resetNotification.id, { status: "sent" }).status, "sent");
    assert.deepEqual(resetPassword(rootDir, env, { token: reset.token, password: "ResetPassword2026" }).ok, true);
    assert.throws(() => createSession(rootDir, env, "writer@example.test", "InvitePassword2026"), /账号或密码不正确/);
    assert.equal(createSession(rootDir, env, "writer@example.test", "ResetPassword2026").user.email, "writer@example.test");

    const roleUpdatedWorkspace = updateTeamMemberInDatabase(rootDir, env, session, invited.user.id, { role: "viewer", name: "只读编剧" });
    const updatedMember = roleUpdatedWorkspace.team.members.find((member) => member.id === invited.user.id);
    assert.equal(updatedMember.role, "查看者");
    assert.equal(updatedMember.name, "只读编剧");
    assert.throws(() => updateTeamMemberInDatabase(rootDir, env, session, session.user.id, { role: "viewer" }), /不能降级最后一个所有者/);

    const afterMemberRemove = removeTeamMemberFromDatabase(rootDir, env, session, invited.user.id);
    assert.equal(afterMemberRemove.team.members.some((member) => member.id === invited.user.id), false);
    assert.throws(() => removeTeamMemberFromDatabase(rootDir, env, session, session.user.id), /不能移除当前登录账号/);

    const projectWithCampaign = updateProjectInDatabase(rootDir, env, session, saved.projects[0].id, {
      project: {
        ...saved.projects[0],
        campaignResults: [
          {
            id: "campaign_template_1",
            versionId: saved.projects[0].versions[0].id,
            versionName: saved.projects[0].versions[0].name,
            templateName: saved.projects[0].versions[0].templateName,
            spend: 100,
            impressions: 1000,
            clicks: 100,
            completions: 500,
            conversions: 10,
            revenue: 250,
            metrics: { ctr: 10, completionRate: 50, cpa: 10, roas: 2.5 },
            createdAt: new Date().toISOString(),
          },
        ],
      },
    });
    assert.equal(projectWithCampaign.campaignResults.length, 1);
    assert.ok(readTemplateInsightsFromDatabase(rootDir, env, session)[0].avgRoas >= 2.5);

    appendAuditLogToDatabase(rootDir, env, session, { action: "test.audit", targetType: "project", targetId: saved.projects[0].id });
    assert.ok(readAuditLogsFromDatabase(rootDir, env, session).some((item) => item.action === "test.audit"));

    const snapshot = createTrendSnapshotInDatabase(rootDir, env, session, {
      source: "manual-test",
      tags: [{ tag: "测试趋势", market: "美国", heat: 91, change: 5, fit: "强钩子" }],
      templateSignals: [{ name: "测试模板", saveRate: 60, exportRate: 30, score: 88 }],
      marketNotes: [{ market: "美国", note: "测试市场提示" }],
    });
    assert.equal(snapshot.source, "manual-test");
    assert.equal(readLatestTrendSnapshotFromDatabase(rootDir, env, session).source, "manual-test");
    assert.ok(readTrendSnapshotsFromDatabase(rootDir, env, session).some((item) => item.id === snapshot.id));

    const publicToken = createPublicApiToken(rootDir, env, session, { name: "测试交付 Token" });
    assert.ok(publicToken.token.startsWith("djcy_"));
    assert.equal(listPublicApiTokens(rootDir, env, session).some((item) => item.id === publicToken.id), true);
    assert.equal(resolvePublicApiToken(rootDir, env, publicToken.token).teamId, session.team.id);
    assert.equal(revokePublicApiToken(rootDir, env, session, publicToken.id).ok, true);
    assert.equal(resolvePublicApiToken(rootDir, env, publicToken.token), null);

    assert.throws(
      () => changePassword(rootDir, env, session, { currentPassword: "wrong", newPassword: "NewOwnerPassword2026" }, session.token),
      /当前密码不正确/,
    );
    assert.equal(
      changePassword(rootDir, env, session, {
        currentPassword: env.DJCYTOOLS_ADMIN_PASSWORD,
        newPassword: "NewOwnerPassword2026",
      }, session.token).ok,
      true,
    );
    assert.throws(() => createSession(rootDir, env, env.DJCYTOOLS_ADMIN_EMAIL, env.DJCYTOOLS_ADMIN_PASSWORD), /账号或密码不正确/);
    assert.equal(createSession(rootDir, env, env.DJCYTOOLS_ADMIN_EMAIL, "NewOwnerPassword2026").user.email, env.DJCYTOOLS_ADMIN_EMAIL);
    assert.equal(readSession(rootDir, env, session.token).user.email, env.DJCYTOOLS_ADMIN_EMAIL);
    assert.equal(readSession(rootDir, env, secondSession.token), null);

    destroySession(rootDir, env, session.token);
    assert.equal(readSession(rootDir, env, session.token), null);
  } finally {
    closeDatabase(rootDir);
    await rm(rootDir, { recursive: true, force: true });
  }
});
