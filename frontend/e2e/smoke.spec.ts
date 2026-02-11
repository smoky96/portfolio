import { expect, test, type Page } from "@playwright/test";

interface DashboardSummaryFixture {
  total_assets: string;
  total_cash: string;
}

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

function toNumber(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
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

function buildExpectedRootPie(params: {
  summary: DashboardSummaryFixture;
  holdings: HoldingFixture[];
  instruments: InstrumentFixture[];
  nodes: NodeFixture[];
}): Map<string, string> {
  const totalAssets = toNumber(params.summary.total_assets);
  const totalCash = toNumber(params.summary.total_cash);
  if (totalAssets <= 0) {
    return new Map();
  }

  const instrumentMap = new Map(params.instruments.map((item) => [item.id, item]));
  const nodeMap = new Map(params.nodes.map((item) => [item.id, item]));
  const valueMap = new Map<string, number>();

  const addAmount = (label: string, amount: number) => {
    if (!Number.isFinite(amount) || amount <= 0) {
      return;
    }
    valueMap.set(label, (valueMap.get(label) ?? 0) + amount);
  };

  for (const holding of params.holdings) {
    const value = toNumber(holding.market_value);
    if (value <= 0) {
      continue;
    }
    const instrument = instrumentMap.get(holding.instrument_id);
    if (!instrument || instrument.allocation_node_id === null) {
      addAmount("未配置标的", value);
      continue;
    }
    const rootName = getRootName(instrument.allocation_node_id, nodeMap);
    addAmount(rootName ?? "未配置标的", value);
  }

  addAmount("账户现金", totalCash);
  const assignedTotal = [...valueMap.values()].reduce((sum, value) => sum + value, 0);
  const remaining = totalAssets - assignedTotal;
  if (remaining > 0.0001) {
    addAmount("未归集", remaining);
  }

  return new Map(
    [...valueMap.entries()].map(([label, amount]) => [
      label,
      `${((amount / totalAssets) * 100).toFixed(3)}%`
    ])
  );
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
  test("dashboard and allocation pages render", async ({ page }) => {
    await page.goto("/");

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
    await page.goto("/accounts");
    await expect(page.getByText("A股券商账户")).toBeVisible();
    await expect(page.getByText("美股券商账户")).toBeVisible();
  });

  test("asset structure can switch to any allocation level", async ({ page, request }) => {
    const nodesResp = await request.get("/api/v1/allocation/nodes");
    expect(nodesResp.ok()).toBeTruthy();
    const nodes = (await nodesResp.json()) as NodeFixture[];
    expect(nodes.length).toBeGreaterThan(0);

    const nodeMap = new Map(nodes.map((item) => [item.id, item]));
    const candidateNode = nodes.find((item) => item.parent_id !== null) ?? nodes[0];
    const candidatePath = buildNodePath(candidateNode.id, nodeMap);

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "仪表盘" })).toBeVisible();

    const card = page.locator(".ant-card").filter({ hasText: "资产结构" }).first();
    await expect(card).toBeVisible();
    await card.locator(".ant-select-selector").first().click();
    const dropdown = page.locator(".ant-select-dropdown:visible").last();
    await dropdown.locator(".ant-select-item-option").filter({ hasText: candidatePath }).first().click();

    await expect(card.locator(".ant-select-selection-item").first()).toContainText(candidatePath);
  });

  test("asset structure root view can toggle cash slice", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "仪表盘" })).toBeVisible();

    const card = page.locator(".ant-card").filter({ hasText: "资产结构" }).first();
    await expect(card).toBeVisible();

    const cashLegendRow = card.locator(".donut-legend-item").filter({ hasText: "账户现金" }).first();
    await expect(cashLegendRow).toBeVisible();

    const cashToggle = card.getByRole("checkbox", { name: "显示账户现金" });
    await expect(cashToggle).toBeChecked();
    await cashToggle.uncheck();
    await expect(cashLegendRow).toHaveCount(0);

    await cashToggle.check();
    await expect(cashLegendRow).toBeVisible();
  });

  test("root allocation pie follows instrument mapping changes", async ({ page, request }) => {
    const [summaryResp, holdingsResp, instrumentsResp, nodesResp] = await Promise.all([
      request.get("/api/v1/dashboard/summary"),
      request.get("/api/v1/holdings"),
      request.get("/api/v1/instruments"),
      request.get("/api/v1/allocation/nodes")
    ]);
    expect(summaryResp.ok()).toBeTruthy();
    expect(holdingsResp.ok()).toBeTruthy();
    expect(instrumentsResp.ok()).toBeTruthy();
    expect(nodesResp.ok()).toBeTruthy();

    const summary = (await summaryResp.json()) as DashboardSummaryFixture;
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
      const patchResp = await request.patch(`/api/v1/instruments/${movedInstrument.id}`, {
        data: { allocation_node_id: targetCategoryId }
      });
      expect(patchResp.ok()).toBeTruthy();

      await page.goto("/");
      await expect(page.getByRole("heading", { name: "仪表盘" })).toBeVisible();
      const rootCard = page.locator(".ant-card").filter({ hasText: "资产结构" }).first();
      await expect(rootCard).toBeVisible();

      const [afterSummaryResp, afterHoldingsResp, afterInstrumentsResp] = await Promise.all([
        request.get("/api/v1/dashboard/summary"),
        request.get("/api/v1/holdings"),
        request.get("/api/v1/instruments")
      ]);
      expect(afterSummaryResp.ok()).toBeTruthy();
      expect(afterHoldingsResp.ok()).toBeTruthy();
      expect(afterInstrumentsResp.ok()).toBeTruthy();

      const expectedMap = buildExpectedRootPie({
        summary: (await afterSummaryResp.json()) as DashboardSummaryFixture,
        holdings: (await afterHoldingsResp.json()) as HoldingFixture[],
        instruments: (await afterInstrumentsResp.json()) as InstrumentFixture[],
        nodes
      });

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
      const legendMap = new Map(legendRows.map((item) => [item.label, item.value]));

      for (const label of [sourceRootName, targetRootName, "账户现金"]) {
        const expected = expectedMap.get(label);
        if (!expected) {
          continue;
        }
        const actual = legendMap.get(label);
        expect(actual).toBe(expected);
      }
    } finally {
      const rollbackResp = await request.patch(`/api/v1/instruments/${movedInstrument.id}`, {
        data: { allocation_node_id: originalCategoryId }
      });
      expect(rollbackResp.ok()).toBeTruthy();
    }
  });

  test("mobile navigation drawer works @mobile", async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.includes("mobile"));

    await page.goto("/");
    await expect(page.getByLabel("打开导航菜单")).toBeVisible();

    await clickNav(page, "流水");
    await expect(page.getByText("流水明细")).toBeVisible();

    await clickNav(page, "资产配置");
    await expect(page.getByText("资产层级配置")).toBeVisible();
  });
});
