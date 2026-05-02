import { expect, test } from "@playwright/test";

const adminEmail = "e2e-owner@example.test";
const adminPassword = "E2EPassword2026";

async function login(page) {
  await page.goto("/#workbench");
  await expect(page.getByRole("heading", { name: "登录短剧叙事工厂" })).toBeVisible();
  await page.getByLabel("邮箱").fill(adminEmail);
  await page.getByLabel("密码").fill(adminPassword);
  await page.getByRole("button", { name: /登录工作台/ }).click();
  await expect(page.getByRole("heading", { name: "创意输入" })).toBeVisible();
  await expect(page.locator(".user-pill")).toContainText("E2E 所有者");
}

test("landing CTA opens the authenticated workbench entry", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /把短剧创意变成/ })).toBeVisible();

  await page.getByRole("button", { name: "进入工作台" }).first().click();

  await expect(page).toHaveURL(/#workbench$/);
  await expect(page.getByRole("heading", { name: "登录短剧叙事工厂" })).toBeVisible();
});

test("owner can log in and create a local draft project", async ({ page }) => {
  await login(page);
  const projectName = `E2E 草稿 ${Date.now()}`;
  const projectRows = page.locator(".project-list .project-row");
  const beforeCount = await projectRows.count();

  await page.locator(".input-panel").getByLabel("项目名").fill(projectName);
  await page.getByRole("button", { name: "新建草稿" }).click();

  await expect(page.getByText("已创建项目草稿。")).toBeVisible();
  await expect(projectRows).toHaveCount(beforeCount + 1);
  await expect(page.locator(".editor-panel")).toContainText("核心对白");
});

test("owner can create an invite and mark its notification as sent", async ({ page }) => {
  await login(page);
  const email = `invite-${Date.now()}@example.test`;

  await page.getByLabel("邀请邮箱").fill(email);
  await page.getByLabel("姓名").fill("E2E 编剧");
  await page.getByRole("button", { name: "生成邀请" }).click();

  await expect(page.getByText("本地通知发件箱")).toBeVisible();
  const notification = page.locator(".notification-item").filter({ hasText: email }).first();
  await expect(notification).toContainText("待发送");
  await notification.getByRole("button", { name: "已发送" }).click();
  await expect(notification).toContainText("已发送");
});

test("public delivery health requires and accepts the configured API token", async ({ request }) => {
  const denied = await request.get("/api/public/health");
  expect(denied.status()).toBe(401);

  const health = await request.get("/api/public/health", {
    headers: { "X-DJCYTOOLS-API-KEY": "e2e-public-token" },
  });
  expect(health.ok()).toBe(true);
  await expect(await health.json()).toEqual(
    expect.objectContaining({
      ok: true,
      service: "djcytools-public-api",
    }),
  );
});
