import fs from "node:fs/promises";

import { expect, test, type Locator, type Page } from "@playwright/test";

function formItem(container: Locator, label: string): Locator {
  return container.locator(`.ant-form-item:has(label:has-text("${label}"))`).first();
}

async function safeClick(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  await locator.click({ force: true });
}

async function selectFormOption(page: Page, container: Locator, label: string, optionText: string) {
  const item = formItem(container, label);
  await expect(item).toBeVisible();
  await safeClick(item.locator(".ant-select-selector"));
  const dropdown = page.locator(".ant-select-dropdown:visible").last();
  await safeClick(dropdown.locator(".ant-select-item-option").filter({ hasText: optionText }).first());
}

async function selectToolbarOption(page: Page, toolbar: Locator, index: number, optionText: string) {
  const select = toolbar.locator(".ant-select").nth(index);
  await safeClick(select);
  const dropdown = page.locator(".ant-select-dropdown:visible").last();
  await safeClick(dropdown.locator(".ant-select-item-option").filter({ hasText: optionText }).first());
}

test.describe("Transactions interactions @transactions", () => {
  test("manual form adapts by type and auto-fills instrument/amount", async ({ page }) => {
    await page.goto("/transactions");

    const manualCard = page.locator(".ant-card").filter({ hasText: "手工录入流水" }).first();
    await expect(manualCard).toBeVisible();

    await selectFormOption(page, manualCard, "流水类型", "内部转账");
    await expect(formItem(manualCard, "对手账户")).toBeVisible();
    await expect(formItem(manualCard, "标的代码")).toHaveCount(0);

    await selectFormOption(page, manualCard, "流水类型", "买入");
    await expect(formItem(manualCard, "对手账户")).toHaveCount(0);
    await expect(formItem(manualCard, "标的代码")).toBeVisible();
    await expect(formItem(manualCard, "数量")).toBeVisible();
    await expect(formItem(manualCard, "价格")).toBeVisible();

    await selectFormOption(page, manualCard, "账户", "A股券商账户");

    const symbolInput = formItem(manualCard, "标的代码").locator("input").first();
    await symbolInput.fill("600519.SS");

    const nameInput = formItem(manualCard, "标的名称").locator("input").first();
    await expect(nameInput).toHaveValue(/贵州茅台/i);

    const qtyInput = formItem(manualCard, "数量").locator("input").first();
    const priceInput = formItem(manualCard, "价格").locator("input").first();
    const autoAmountInput = formItem(manualCard, "成交金额（自动）").locator("input").first();

    const defaultPrice = Number((await priceInput.inputValue()).replace(/,/g, ""));
    expect(defaultPrice).toBeGreaterThan(0);

    await qtyInput.fill("2");
    await priceInput.fill("100.5");

    const amountValue = Number((await autoAmountInput.inputValue()).replace(/,/g, ""));
    expect(amountValue).toBeCloseTo(201, 6);

    await expect(manualCard.getByText("结算金额（含费税）")).toBeVisible();
  });

  test("custom instruments can be selected and recorded in manual transactions", async ({ page, request }, testInfo) => {
    const unique = Date.now().toString().slice(-6);
    const symbol = `CUST_TX_${testInfo.project.name.replace(/[^A-Za-z0-9]/g, "").toUpperCase()}_${unique}`;
    const customName = `流水自定义标的${unique}`;

    const createResp = await request.post("/api/v1/instruments", {
      data: {
        symbol,
        market: "CUSTOM",
        type: "FUND",
        currency: "CNY",
        name: customName,
        default_account_id: null,
        allocation_node_id: null
      }
    });
    expect(createResp.ok()).toBeTruthy();

    await page.goto("/transactions");

    const manualCard = page.locator(".ant-card").filter({ hasText: "手工录入流水" }).first();
    await expect(manualCard).toBeVisible();

    await selectFormOption(page, manualCard, "流水类型", "买入");
    await selectFormOption(page, manualCard, "账户", "A股券商账户");
    const symbolInput = formItem(manualCard, "标的代码").locator("input").first();
    await symbolInput.fill(symbol);
    await symbolInput.blur();
    await expect(symbolInput).toHaveValue(symbol);

    const nameInput = formItem(manualCard, "标的名称").locator("input").first();
    await expect(nameInput).toHaveValue(customName);

    await formItem(manualCard, "数量").locator("input").first().fill("10");
    await formItem(manualCard, "价格").locator("input").first().fill("1.23");
    await safeClick(manualCard.getByRole("button", { name: "新增流水" }));

    await expect(page.getByText("流水已创建")).toBeVisible();
    await expect(page.locator(".ant-card").filter({ hasText: "流水明细" }).first()).toContainText(symbol);
  });

  test("symbol lookup is triggered only by explicit query action", async ({ page }) => {
    const lookupSymbols: string[] = [];
    await page.route("**/api/v1/quotes/lookup**", async (route) => {
      const reqUrl = new URL(route.request().url());
      const symbol = (reqUrl.searchParams.get("symbol") ?? "").toUpperCase();
      lookupSymbols.push(symbol);

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          symbol,
          found: true,
          provider_status: "success",
          name: symbol === "TSLA" ? "Tesla, Inc." : "Unknown",
          price: "245.31000000",
          currency: "USD",
          market: "NASDAQ",
          quote_type: "EQUITY",
          quoted_at: "2026-02-08T08:00:00Z",
          message: null
        })
      });
    });

    await page.goto("/transactions");

    const manualCard = page.locator(".ant-card").filter({ hasText: "手工录入流水" }).first();
    await expect(manualCard).toBeVisible();

    await selectFormOption(page, manualCard, "流水类型", "买入");
    await selectFormOption(page, manualCard, "账户", "A股券商账户");

    const baselineLookupCalls = lookupSymbols.length;
    const symbolInput = formItem(manualCard, "标的代码").locator("input").first();
    await symbolInput.fill("tsla");

    await page.waitForTimeout(700);
    expect(lookupSymbols.length).toBe(baselineLookupCalls);

    await symbolInput.press("Enter");
    await expect.poll(() => lookupSymbols.length).toBe(baselineLookupCalls + 1);
    expect(lookupSymbols.at(-1)).toBe("TSLA");

    const nameInput = formItem(manualCard, "标的名称").locator("input").first();
    await expect(nameInput).toHaveValue(/Tesla/i);

    const priceInput = formItem(manualCard, "价格").locator("input").first();
    const priceValue = Number((await priceInput.inputValue()).replace(/,/g, ""));
    expect(priceValue).toBeCloseTo(245.31, 6);
  });

  test("first lookup keeps name when matched_symbol differs from input", async ({ page }) => {
    const lookupSymbols: string[] = [];
    await page.route("**/api/v1/quotes/lookup**", async (route) => {
      const reqUrl = new URL(route.request().url());
      const symbol = (reqUrl.searchParams.get("symbol") ?? "").toUpperCase();
      lookupSymbols.push(symbol);

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          symbol,
          matched_symbol: symbol === "CNX001" ? "CNX001.SS" : symbol,
          found: true,
          provider_status: "success",
          name: "CNX Test Asset",
          price: "123.45000000",
          currency: "CNY",
          market: "SHH",
          quote_type: "EQUITY",
          quoted_at: "2026-02-08T08:00:00Z",
          message: null
        })
      });
    });

    await page.goto("/transactions");

    const manualCard = page.locator(".ant-card").filter({ hasText: "手工录入流水" }).first();
    await expect(manualCard).toBeVisible();

    await selectFormOption(page, manualCard, "流水类型", "买入");
    await selectFormOption(page, manualCard, "账户", "A股券商账户");

    const symbolInput = formItem(manualCard, "标的代码").locator("input").first();
    await symbolInput.fill("cnx001");
    await symbolInput.press("Enter");

    await expect.poll(() => lookupSymbols.length).toBeGreaterThan(0);
    expect(lookupSymbols.at(-1)).toBe("CNX001");

    await expect(symbolInput).toHaveValue("CNX001.SS");

    const nameInput = formItem(manualCard, "标的名称").locator("input").first();
    await expect(nameInput).toHaveValue("CNX Test Asset");
  });

  test("csv template can be downloaded", async ({ page }) => {
    await page.goto("/transactions");

    const downloadBtn = page.getByRole("button", { name: "下载 CSV 模板" });
    await expect(downloadBtn).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      safeClick(downloadBtn)
    ]);

    expect(download.suggestedFilename()).toBe("transactions_template.csv");
    await expect(download.failure()).resolves.toBeNull();

    const downloadPath = await download.path();
    expect(downloadPath).not.toBeNull();

    const content = await fs.readFile(downloadPath!, "utf8");
    expect(content).toContain("type,account_id,instrument_id");
    expect(content).toContain("executed_tz");
  });

  test("details support multi-filters and colored tags", async ({ page }) => {
    await page.goto("/transactions");

    const detailCard = page.locator(".ant-card").filter({ hasText: "流水明细" }).first();
    await expect(detailCard).toBeVisible();

    const toolbar = detailCard.locator(".page-toolbar").first();
    await selectToolbarOption(page, toolbar, 0, "买入");
    await selectToolbarOption(page, toolbar, 1, "A股券商账户");
    await selectToolbarOption(page, toolbar, 2, "600519.SS");
    await selectToolbarOption(page, toolbar, 3, "CNY");

    const rows = detailCard.locator(".ant-table-tbody tr.ant-table-row");
    await expect(rows.first()).toBeVisible();

    const rowValues = await rows.evaluateAll((trs) =>
      trs.map((tr) =>
        Array.from(tr.querySelectorAll("td")).map((td) => (td.textContent || "").replace(/\s+/g, " ").trim())
      )
    );

    expect(rowValues.length).toBeGreaterThan(0);
    for (const row of rowValues) {
      expect(row[0]).toContain("买入");
      expect(row[1]).toContain("A股券商账户");
      expect(row[2]).toContain("600519.SS");
      expect(row[8]).toContain("CNY");
    }

    const firstTypeTag = rows.first().locator("td").nth(0).locator(".ant-tag");
    const firstCurrencyTag = rows.first().locator("td").nth(8).locator(".ant-tag");
    await expect(firstTypeTag).toHaveClass(/ant-tag-green/);
    await expect(firstCurrencyTag).toHaveClass(/ant-tag-blue/);
  });
});
