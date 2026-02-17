import { expect, test, type Locator, type Page } from "@playwright/test";

import { gotoWithLogin } from "./helpers/auth";

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

test.describe("Error modals", () => {
  test("accounts load failures are shown in modal dialogs", async ({ page }) => {
    await page.route("**/api/v1/accounts", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "text/plain; charset=utf-8",
        body: "Mock accounts load failure"
      });
    });

    await gotoWithLogin(page, "/accounts");

    const errorModal = page.locator(".ant-modal-confirm-error").last();
    await expect(errorModal).toBeVisible();
    await expect(errorModal).toContainText("请求失败");
    await expect(errorModal).toContainText("Mock accounts load failure");
    await expect(page.locator(".accounts-page .ant-alert-error")).toHaveCount(0);
    await errorModal.getByRole("button", { name: /确\s*定/ }).click();
  });

  test("transactions validation failures are shown in modal dialogs", async ({ page }) => {
    await page.route("**/api/v1/quotes/lookup**", async (route) => {
      const reqUrl = new URL(route.request().url());
      const symbol = (reqUrl.searchParams.get("symbol") ?? "").toUpperCase();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          symbol,
          matched_symbol: symbol,
          found: false,
          provider_status: "not_found",
          name: null,
          price: null,
          currency: null,
          market: null,
          quote_type: null,
          quoted_at: null,
          message: null
        })
      });
    });

    await gotoWithLogin(page, "/transactions");

    const manualCard = page.locator(".ant-card").filter({ hasText: "手工录入流水" }).first();
    await expect(manualCard).toBeVisible();

    await selectFormOption(page, manualCard, "流水类型", "买入");
    await selectFormOption(page, manualCard, "账户", "A股券商账户");
    await formItem(manualCard, "标的代码").locator("input").first().fill("NOTFOUND123");
    await formItem(manualCard, "数量").locator("input").first().fill("1");
    await formItem(manualCard, "价格").locator("input").first().fill("1");
    await safeClick(manualCard.getByRole("button", { name: "新增流水" }));

    const errorModal = page.locator(".ant-modal-confirm-error").last();
    await expect(errorModal).toBeVisible();
    await expect(errorModal).toContainText("未找到标的代码 NOTFOUND123，请确认代码后重试");
    await expect(page.locator(".transactions-page .ant-alert-error")).toHaveCount(0);
    await errorModal.getByRole("button", { name: /确\s*定/ }).click();
  });
});
