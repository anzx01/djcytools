import { expect, test } from "@playwright/test";

const adminEmail = "e2e-owner@example.test";
const adminPassword = "E2EPassword2026";

async function login(page) {
  await page.goto("/#workbench");
  await expect(page.getByRole("heading", { name: "登录短剧叙事工厂" })).toBeVisible();
  await page.getByLabel("邮箱").fill(adminEmail);
  await page.getByLabel("密码").fill(adminPassword);
  await page.getByRole("button", { name: /登录工作台/ }).click();
  await expect(page.getByRole("heading", { name: "项目设置" })).toBeVisible();
  await expect(page.locator(".user-pill")).toContainText("E2E 所有者");
}

test("landing CTA opens the authenticated workbench entry", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /一人公司也能把短剧创意生成/ })).toBeVisible();
  await expect(page.getByLabel("首页真实视频轮播")).toContainText("真实视频轮播");
  await expect(page.getByRole("heading", { name: "登录短剧叙事工厂" })).toHaveCount(0);

  await page.getByRole("button", { name: "进入工作台" }).first().click();

  await expect(page).toHaveURL(/#workbench$/);
  await expect(page.getByRole("heading", { name: /一人公司也能把短剧创意生成/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "登录短剧叙事工厂" })).toBeVisible();
});

test("owner can log in and create a local draft project", async ({ page }) => {
  await login(page);
  const projectName = `E2E 草稿 ${Date.now()}`;

  await page.locator(".setup-step").getByLabel("项目名").fill(projectName);
  await page.getByRole("button", { name: "保存草稿" }).click();

  await expect(page.locator(".workflow-global-notice")).toContainText("已创建项目草稿。");
  await expect(page.locator(".script-step")).toContainText("剧本与分镜");
  await expect(page.locator(".script-step")).toContainText("核心对白");
  await expect(page.locator(".script-step .inline-storyboard").first()).toContainText("分镜");
});

test("owner sees real video controls without local preview or sample generation", async ({ page }) => {
  await login(page);
  await page.locator(".workflow-step").filter({ hasText: "生成视频" }).click();

  await expect(page.getByRole("heading", { name: "生成视频" })).toBeVisible();
  await expect(page.getByLabel("当前生成片段")).toContainText("准备生成");
  await expect(page.getByLabel("当前生成片段")).toContainText("15s");
  await expect(page.getByRole("button", { name: /生成 15 秒样片/ })).toHaveCount(0);
  await expect(page.locator(".canvas-video-preview")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /生成当前第1集/ }).first()).toBeVisible();
  await expect(page.getByLabel("单独生成集数")).toBeVisible();
  await expect(page.getByLabel("起始集")).toBeVisible();
  await expect(page.getByLabel("结束集")).toBeVisible();
  await expect(page.getByRole("button", { name: /生成第1(?:-\d+)?集/ })).toBeVisible();
  await expect(page.locator(".generated-video-list")).toContainText("当前剧本已生成视频");
  await expect(page.locator(".generated-video-list-head")).toContainText(/生成完成后显示在这里|条可查看/);
  await expect(page.getByText("生成音频")).toHaveCount(0);
  await expect(page.getByPlaceholder("首帧参考图 URL")).toHaveCount(0);
  await expect(page.getByPlaceholder("尾帧参考图 URL")).toHaveCount(0);
  await expect(page.getByPlaceholder("参考视频 URL")).toHaveCount(0);
  await expect(page.getByPlaceholder("参考音频 URL")).toHaveCount(0);
});

test("solo workbench hides team and delivery interface panels", async ({ page }) => {
  await login(page);
  await page.locator(".workflow-step").filter({ hasText: "剧本确认" }).click();

  await expect(page.getByRole("tab", { name: "团队/上线" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "评分" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "增长" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "团队权限" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "交付接口" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "版本实验" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "AI 评分" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "数据洞察" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "投流回流" })).toHaveCount(0);
  await expect(page.getByText("互动短剧")).toHaveCount(0);
  await expect(page.getByText("导出与备注")).toBeVisible();
  await expect(page.locator(".workbench-sticky-head")).toHaveCSS("position", "sticky");
  await expect(page.locator(".workbench-tabs [role='tab']")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "草稿" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "评审中" })).toHaveCount(0);
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
