import { expect, test, type Page } from "@playwright/test";

import { authedGet, gotoWithLogin } from "./helpers/auth";

function toNumber(value: string): number {
  const normalized = value.replace(/,/g, "").replace(/[%\s]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cardValueByTitle(page: Page, title: string): Promise<string> {
  const card = page.locator(".page-grid .ant-card").filter({ hasText: title }).first();
  return card.locator(".ant-card-body .ant-typography").nth(1).innerText();
}

async function expectAndCloseSuccessModal(page: Page, text: string) {
  const modal = page.locator(".ant-modal-confirm-success").filter({ hasText: text }).last();
  await expect(modal).toBeVisible({ timeout: 15000 });
  await modal.getByRole("button", { name: /确\s*定/ }).click();
}

test.describe("Holdings and custom instruments @holdings", () => {
  test("holdings summary matches detail table and no instrument-config sections", async ({ page }) => {
    await gotoWithLogin(page, "/holdings");
    await expect(page.getByText("持仓明细")).toBeVisible();

    await expect(page.locator(".ant-card-head-title").filter({ hasText: "流水标的" })).toHaveCount(0);
    await expect(page.locator(".ant-card-head-title").filter({ hasText: "自定义标的" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "创建自定义标的" })).toHaveCount(0);

    const detailCard = page.locator(".ant-card").filter({ hasText: "持仓明细" }).first();
    await expect(detailCard.locator(".ant-table-tbody tr.ant-table-row").first()).toBeVisible();

    const holdingsResponse = await authedGet(page.request, "/api/v1/holdings");
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

    const driftResponse = await authedGet(page.request, "/api/v1/rebalance/drift");
    expect(driftResponse.ok()).toBeTruthy();
    const driftItems = (await driftResponse.json()) as Array<{
      is_alerted: boolean;
    }>;
    const alertCount = driftItems.filter((item) => item.is_alerted).length;
    const alertCardText = await cardValueByTitle(page, "偏离提醒");
    expect(toNumber(alertCardText)).toBe(alertCount);
  });

  test("custom instruments page supports create and manual quote update", async ({ page, request }, testInfo) => {
    const unique = Date.now().toString().slice(-6);
    const symbol = `CUST_${testInfo.project.name.replace(/[^A-Za-z0-9]/g, "").toUpperCase()}_${unique}`;
    const instrumentName = `自定义测试标的${unique}`;
    const updatedPrice = "12.345";

    await gotoWithLogin(page, "/custom-instruments");
    await expect(page.getByText("新增自定义标的")).toBeVisible();
    await expect(page.getByText("自定义标的一览")).toBeVisible();

    await page.locator("#symbol").fill(symbol);
    await page.locator("#name").fill(instrumentName);
    await page.getByRole("button", { name: "创建自定义标的" }).click();

    await expectAndCloseSuccessModal(page, "自定义标的已创建");
    await page.getByPlaceholder("按代码或名称搜索").fill(symbol);

    const row = page.locator(".ant-table-tbody tr.ant-table-row").filter({ hasText: symbol }).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText(instrumentName);

    const instrumentsResp = await authedGet(request, "/api/v1/instruments");
    expect(instrumentsResp.ok()).toBeTruthy();
    const instruments = (await instrumentsResp.json()) as Array<{ id: number; symbol: string }>;
    const targetInstrument = instruments.find((item) => item.symbol === symbol);
    expect(targetInstrument).toBeTruthy();
    if (!targetInstrument) {
      return;
    }

    const priceInput = row.locator("input").first();
    await priceInput.click();
    await priceInput.press("ControlOrMeta+A");
    await priceInput.type(updatedPrice);
    await priceInput.press("Enter");
    const saveButton = row.getByRole("button", { name: /保\s*存/ }).first();
    await expect(saveButton).toBeEnabled();
    const updateResponsePromise = page.waitForResponse(
      (response) => response.url().includes("/api/v1/quotes/manual-overrides") && response.request().method() === "POST",
      { timeout: 15000 }
    );
    await saveButton.click();
    const updateResponse = await updateResponsePromise;
    expect(updateResponse.ok()).toBeTruthy();

    await expectAndCloseSuccessModal(page, "现价已更新");
    await expect(row).toContainText("手动", { timeout: 15000 });
    await expect(row).toContainText("12.345", { timeout: 15000 });
  });
});
