import { expect, test, type Page } from "@playwright/test";

function toNumber(value: string): number {
  const normalized = value.replace(/,/g, "").replace(/[%\s]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cardValueByTitle(page: Page, title: string): Promise<string> {
  const card = page.locator(".page-grid .ant-card").filter({ hasText: title }).first();
  return card.locator(".ant-card-body .ant-typography").nth(1).innerText();
}

async function safeClick(locator: ReturnType<Page["locator"]>) {
  await locator.scrollIntoViewIfNeeded();
  await locator.click({ force: true });
}

test.describe("Holdings and custom instruments @holdings", () => {
  test("holdings summary matches detail table and no instrument-config sections", async ({ page }) => {
    await page.goto("/holdings");
    await expect(page.getByText("持仓明细")).toBeVisible();

    await expect(page.locator(".ant-card-head-title").filter({ hasText: "流水标的" })).toHaveCount(0);
    await expect(page.locator(".ant-card-head-title").filter({ hasText: "自定义标的" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "创建自定义标的" })).toHaveCount(0);

    const detailCard = page.locator(".ant-card").filter({ hasText: "持仓明细" }).first();
    await expect(detailCard.locator(".ant-table-tbody tr.ant-table-row").first()).toBeVisible();

    const holdingsResponse = await page.request.get("/api/v1/holdings");
    expect(holdingsResponse.ok()).toBeTruthy();
    const holdings = (await holdingsResponse.json()) as Array<{
      market_value: string;
      cost_value: string;
      unrealized_pnl: string;
    }>;

    const totalMarket = holdings.reduce((sum, row) => sum + Number(row.market_value || 0), 0);
    const totalCost = holdings.reduce((sum, row) => sum + Number(row.cost_value || 0), 0);
    const totalPnl = holdings.reduce((sum, row) => sum + Number(row.unrealized_pnl || 0), 0);

    const marketText = await cardValueByTitle(page, "组合市值");
    const costText = await cardValueByTitle(page, "组合成本");
    const pnlText = await cardValueByTitle(page, "浮盈亏");

    expect(toNumber(marketText)).toBeCloseTo(totalMarket, 3);
    expect(toNumber(costText)).toBeCloseTo(totalCost, 3);
    expect(toNumber(pnlText)).toBeCloseTo(totalPnl, 3);

    const driftResponse = await page.request.get("/api/v1/rebalance/drift");
    expect(driftResponse.ok()).toBeTruthy();
    const driftItems = (await driftResponse.json()) as Array<{
      is_alerted: boolean;
    }>;
    const alertCount = driftItems.filter((item) => item.is_alerted).length;
    const alertCardText = await cardValueByTitle(page, "偏离提醒");
    expect(toNumber(alertCardText)).toBe(alertCount);
  });

  test("custom instruments page supports create and manual quote update", async ({ page }, testInfo) => {
    const unique = Date.now().toString().slice(-6);
    const symbol = `CUST_${testInfo.project.name.replace(/[^A-Za-z0-9]/g, "").toUpperCase()}_${unique}`;
    const instrumentName = `自定义测试标的${unique}`;
    const updatedPrice = "12.345";

    await page.goto("/custom-instruments");
    await expect(page.getByText("新增自定义标的")).toBeVisible();
    await expect(page.getByText("自定义标的一览")).toBeVisible();

    await page.locator("#symbol").fill(symbol);
    await page.locator("#name").fill(instrumentName);
    await page.getByRole("button", { name: "创建自定义标的" }).click();

    await expect(page.getByText("自定义标的已创建")).toBeVisible();
    await page.getByPlaceholder("按代码或名称搜索").fill(symbol);

    const row = page.locator(".ant-table-tbody tr.ant-table-row").filter({ hasText: symbol }).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText(instrumentName);

    const priceInput = row.locator("input").first();
    await priceInput.fill(updatedPrice);
    await safeClick(row.locator("button.ant-btn-primary").first());

    await expect(page.getByText("现价已更新")).toBeVisible();
    await expect(row).toContainText("手动");
    await expect(row).toContainText("12.345");
  });
});
