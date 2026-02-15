import { expect, test, type Page } from "@playwright/test";

import { authedGet, authedPatch, gotoWithLogin } from "./helpers/auth";

interface HoldingFixture {
  instrument_id: number;
  market_value: string;
}

interface InstrumentFixture {
  id: number;
  allocation_node_id: number | null;
}

interface NodeFixture {
  id: number;
  parent_id: number | null;
  name: string;
}

function getRootName(nodeId: number, nodeMap: Map<number, NodeFixture>): string | null {
  let current = nodeMap.get(nodeId) ?? null;
  if (!current) {
    return null;
  }
  while (current.parent_id !== null) {
    const parent = nodeMap.get(current.parent_id);
    if (!parent) {
      break;
    }
    current = parent;
  }
  return current.name;
}

function buildNodePath(nodeId: number, nodeMap: Map<number, NodeFixture>): string {
  const node = nodeMap.get(nodeId);
  if (!node) {
    return String(nodeId);
  }
  const path: string[] = [node.name];
  let parentId = node.parent_id;
  while (parentId !== null) {
    const parent = nodeMap.get(parentId);
    if (!parent) {
      break;
    }
    path.unshift(parent.name);
    parentId = parent.parent_id;
  }
  return path.join(" / ");
}

async function clickNav(page: Page, label: string) {
  const desktopItem = page.locator(".app-sider .side-nav-item, .app-sider .ant-menu-item").filter({ hasText: label }).first();
  if (await desktopItem.count()) {
    await desktopItem.click();
    return;
  }

  const mobileMenuBtn = page.getByLabel("打开导航菜单");
  if (await mobileMenuBtn.count()) {
    await mobileMenuBtn.click();
    await page
      .locator(".ant-drawer .side-nav-item, .ant-drawer .ant-menu-item")
      .filter({ hasText: label })
      .first()
      .click();
    return;
  }

  await page.locator(".side-nav-item, .ant-menu-item").filter({ hasText: label }).first().click();
}

test.describe("Portfolio smoke @smoke", () => {
  const readRootLegendMap = async (page: Page): Promise<Map<string, number>> => {
    const rootCard = page.locator(".ant-card").filter({ hasText: "资产结构" }).first();
    await expect(rootCard).toBeVisible();

    const legendRows = await rootCard.locator(".donut-legend-item").evaluateAll((rows) =>
      rows.map((row) => {
        const texts = Array.from(row.querySelectorAll(".ant-typography"))
          .map((item) => (item.textContent || "").trim())
          .filter((item) => item.length > 0);
        return {
          label: texts[0] ?? "",
          value: texts[texts.length - 1] ?? ""
        };
      })
    );

    return new Map(
      legendRows.map((item) => {
        const numeric = Number(item.value.replace("%", ""));
        return [item.label, Number.isFinite(numeric) ? numeric : 0];
      })
    );
  };

  test("login gate works and logout returns to login page", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator(".login-page")).toBeVisible();

    await page.locator("#login-username").fill("wrong");
    await page.locator("#login-password").fill("wrong");
    await page.getByRole("button", { name: "登录系统" }).click();
    await expect(page.getByText("账号或密码错误，请重试。")).toBeVisible();

    await page.locator("#login-username").fill("admin");
    await page.locator("#login-password").fill("admin123");
    await page.getByRole("button", { name: "登录系统" }).click();
    await expect(page.getByRole("heading", { name: "仪表盘" })).toBeVisible();

    await page.getByRole("button", { name: /退出/ }).first().click();
    await expect(page.locator(".login-page")).toBeVisible();
  });

  test("dashboard and allocation pages render", async ({ page }) => {
    await gotoWithLogin(page, "/");

    await expect(page.getByRole("heading", { name: "仪表盘" })).toBeVisible();
    await expect(page.getByText("收益率曲线")).toBeVisible();
    await expect(page.getByText("资产结构")).toBeVisible();

    await clickNav(page, "资产配置");
    await expect(page.getByText("资产层级配置")).toBeVisible();
    await expect(page.locator(".ant-card-head-title").filter({ hasText: "当前层级资产结构" }).first()).toBeVisible();

    await clickNav(page, "标签组");
    await expect(page.getByText("标签组配置")).toBeVisible();

    await clickNav(page, "账户");
    await expect(page.getByText("账户列表")).toBeVisible();

    await clickNav(page, "持仓");
    await expect(page.getByText("持仓明细")).toBeVisible();

    await clickNav(page, "自定义标的");
    await expect(page.getByRole("button", { name: "创建自定义标的" })).toBeVisible();

    await clickNav(page, "仪表盘");
    const kpiRate = await page
      .locator(".dashboard-kpi-card")
      .filter({ hasText: "累计收益率" })
      .locator(".kpi-value")
      .first()
      .innerText();
    const snapshotRate = await page
      .locator(".dashboard-snapshot-card .snapshot-row")
      .filter({ hasText: "当前收益率" })
      .locator(".ant-tag")
      .first()
      .innerText();
    expect(kpiRate.trim()).toBe(snapshotRate.trim());
  });

  test("seeded accounts are visible", async ({ page }) => {
    await gotoWithLogin(page, "/accounts");
    await expect(page.getByText("A股券商账户")).toBeVisible();
    await expect(page.getByText("美股券商账户")).toBeVisible();
  });

  test("asset structure can switch to any allocation level", async ({ page, request }) => {
    const nodesResp = await authedGet(request, "/api/v1/allocation/nodes");
    expect(nodesResp.ok()).toBeTruthy();
    const nodes = (await nodesResp.json()) as NodeFixture[];
    expect(nodes.length).toBeGreaterThan(0);

    const nodeMap = new Map(nodes.map((item) => [item.id, item]));
    const candidateNode = nodes.find((item) => item.parent_id !== null) ?? nodes[0];
    const candidatePath = buildNodePath(candidateNode.id, nodeMap);

    await gotoWithLogin(page, "/");
    await expect(page.getByRole("heading", { name: "仪表盘" })).toBeVisible();

    const card = page.locator(".ant-card").filter({ hasText: "资产结构" }).first();
    await expect(card).toBeVisible();
    await card.locator(".ant-select-selector").first().click();
    const dropdown = page.locator(".ant-select-dropdown:visible").last();
    await dropdown.locator(".ant-select-item-option").filter({ hasText: candidatePath }).first().click();

    await expect(card.locator(".ant-select-selection-item").first()).toContainText(candidatePath);
  });

  test("asset structure root view no longer shows global cash toggle", async ({ page }) => {
    await gotoWithLogin(page, "/");
    await expect(page.getByRole("heading", { name: "仪表盘" })).toBeVisible();

    const card = page.locator(".ant-card").filter({ hasText: "资产结构" }).first();
    await expect(card).toBeVisible();
    await expect(card.getByRole("checkbox", { name: "显示账户现金" })).toHaveCount(0);
  });

  test("root allocation pie follows instrument mapping changes", async ({ page, request }) => {
    const [holdingsResp, instrumentsResp, nodesResp] = await Promise.all([
      authedGet(request, "/api/v1/holdings"),
      authedGet(request, "/api/v1/instruments"),
      authedGet(request, "/api/v1/allocation/nodes")
    ]);
    expect(holdingsResp.ok()).toBeTruthy();
    expect(instrumentsResp.ok()).toBeTruthy();
    expect(nodesResp.ok()).toBeTruthy();

    const holdings = (await holdingsResp.json()) as HoldingFixture[];
    const instruments = (await instrumentsResp.json()) as InstrumentFixture[];
    const nodes = (await nodesResp.json()) as NodeFixture[];

    const nodeMap = new Map(nodes.map((item) => [item.id, item]));
    const holdingInstrumentIds = [...new Set(holdings.map((item) => item.instrument_id))];
    const instrumentMap = new Map(instruments.map((item) => [item.id, item]));

    let sourceRootName: string | null = null;
    let targetRootName: string | null = null;
    let movedInstrument: InstrumentFixture | null = null;
    let targetCategoryId: number | null = null;
    for (const instrumentId of holdingInstrumentIds) {
      const instrument = instrumentMap.get(instrumentId);
      if (!instrument || instrument.allocation_node_id === null) {
        continue;
      }
      const sourceRoot = getRootName(instrument.allocation_node_id, nodeMap);
      if (!sourceRoot) {
        continue;
      }
      const targetNode = nodes.find((item) => {
        const root = getRootName(item.id, nodeMap);
        return root && root !== sourceRoot;
      });
      if (!targetNode) {
        continue;
      }
      sourceRootName = sourceRoot;
      targetRootName = getRootName(targetNode.id, nodeMap);
      movedInstrument = instrument;
      targetCategoryId = targetNode.id;
      break;
    }

    test.skip(!movedInstrument || !targetCategoryId || !sourceRootName || !targetRootName, "找不到可跨根节点迁移的持仓标的");
    if (!movedInstrument || !targetCategoryId || !sourceRootName || !targetRootName) {
      return;
    }

    const originalCategoryId = movedInstrument.allocation_node_id;
    try {
      await gotoWithLogin(page, "/");
      await expect(page.getByRole("heading", { name: "仪表盘" })).toBeVisible();
      const beforeLegend = await readRootLegendMap(page);
      const beforeSource = beforeLegend.get(sourceRootName) ?? 0;
      const beforeTarget = beforeLegend.get(targetRootName) ?? 0;

      const patchResp = await authedPatch(request, `/api/v1/instruments/${movedInstrument.id}`, {
        data: { allocation_node_id: targetCategoryId }
      });
      expect(patchResp.ok()).toBeTruthy();

      await page.reload();
      await expect(page.getByRole("heading", { name: "仪表盘" })).toBeVisible();
      const afterLegend = await readRootLegendMap(page);

      const afterSource = afterLegend.get(sourceRootName) ?? 0;
      const afterTarget = afterLegend.get(targetRootName) ?? 0;

      expect(afterTarget).toBeGreaterThan(beforeTarget);
      expect(afterSource).toBeLessThan(beforeSource);
    } finally {
      const rollbackResp = await authedPatch(request, `/api/v1/instruments/${movedInstrument.id}`, {
        data: { allocation_node_id: originalCategoryId }
      });
      expect(rollbackResp.ok()).toBeTruthy();
    }
  });

  test("mobile navigation drawer works @mobile", async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.includes("mobile"));

    await gotoWithLogin(page, "/");
    await expect(page.getByLabel("打开导航菜单")).toBeVisible();

    await clickNav(page, "流水");
    await expect(page.getByText("流水明细")).toBeVisible();

    await clickNav(page, "资产配置");
    await expect(page.getByText("资产层级配置")).toBeVisible();
  });
});
