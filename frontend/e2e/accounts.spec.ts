import { expect, test, type Locator } from "@playwright/test";

import { gotoWithLogin } from "./helpers/auth";

function formItem(container: Locator, label: string): Locator {
  return container.locator(`.ant-form-item:has(label:has-text("${label}"))`).first();
}

async function safeClick(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  await locator.click({ force: true });
}

test.describe("Accounts management @accounts", () => {
  test("accounts with transactions cannot be deleted in UI", async ({ page }) => {
    await gotoWithLogin(page, "/accounts");
    await expect(page.getByText("账户列表")).toBeVisible();

    const tableCard = page.locator(".accounts-table-card");
    const blockedHint = tableCard.getByText("有流水不可删").first();
    await expect(blockedHint).toBeVisible();

    const blockedRow = blockedHint.locator("xpath=ancestor::tr[1]");
    await expect(blockedRow.getByRole("button", { name: /删\s*除/ })).toBeDisabled();
  });

  test("account without transactions can be created and deleted from UI", async ({ page }, testInfo) => {
    const unique = `${testInfo.project.name.replace(/[^A-Za-z0-9]/g, "").toUpperCase()}_${Date.now().toString().slice(-6)}`;
    const accountName = `E2E删除账户_${unique}`;

    await gotoWithLogin(page, "/accounts");
    await expect(page.getByText("账户列表")).toBeVisible();

    const createCard = page.locator(".accounts-create-card");
    await formItem(createCard, "账户名称").locator("input").first().fill(accountName);
    await safeClick(createCard.getByRole("button", { name: "创建账户" }));

    await expect(page.getByText("账户已创建")).toBeVisible();

    const tableCard = page.locator(".accounts-table-card");
    await tableCard.getByPlaceholder("按账户名称搜索").fill(accountName);

    const targetRow = tableCard.locator(".ant-table-tbody tr.ant-table-row").filter({ hasText: accountName }).first();
    await expect(targetRow).toBeVisible();
    await expect(targetRow.getByText("有流水不可删")).toHaveCount(0);

    await safeClick(targetRow.getByRole("button", { name: /删\s*除/ }));
    await safeClick(page.locator(".ant-popover:visible").getByRole("button", { name: /删\s*除/ }));

    await expect(page.getByText("账户已删除")).toBeVisible();
    await expect(
      tableCard.locator(".ant-table-tbody tr.ant-table-row").filter({ hasText: accountName })
    ).toHaveCount(0);
  });
});
