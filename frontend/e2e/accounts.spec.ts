import { expect, test, type Locator, type Page } from "@playwright/test";

import { authedDelete, authedGet, gotoWithLogin } from "./helpers/auth";

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

async function expectAndCloseSuccessModal(page: Page, text: string) {
  const modal = page.locator(".ant-modal-confirm-success").filter({ hasText: text }).last();
  await expect(modal).toBeVisible({ timeout: 15000 });
  await modal.getByRole("button", { name: /确\s*定/ }).click();
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

  test("account without transactions can be created and deleted from UI", async ({ page, request }, testInfo) => {
    const unique = `${testInfo.project.name.replace(/[^A-Za-z0-9]/g, "").toUpperCase()}_${Date.now().toString().slice(-6)}`;
    const accountName = `E2E删除账户_${unique}`;
    let createdAccountId: number | null = null;

    try {
      await gotoWithLogin(page, "/accounts");
      await expect(page.getByText("账户列表")).toBeVisible();

      const createCard = page.locator(".accounts-create-card");
      await formItem(createCard, "账户名称").locator("input").first().fill(accountName);
      await selectFormOption(page, createCard, "账户类型", "现金账户");
      await selectFormOption(page, createCard, "账户币种", "CNY - 人民币");
      await safeClick(createCard.getByRole("button", { name: "创建账户" }));

      await expectAndCloseSuccessModal(page, "账户已创建");

      const tableCard = page.locator(".accounts-table-card");
      await tableCard.getByPlaceholder("按账户名称搜索").fill(accountName);

      const targetRow = tableCard.locator(".ant-table-tbody tr.ant-table-row").filter({ hasText: accountName }).first();
      await expect(targetRow).toBeVisible();
      await expect(targetRow.getByText("有流水不可删")).toHaveCount(0);

      const accountsResp = await authedGet(request, "/api/v1/accounts");
      expect(accountsResp.ok()).toBeTruthy();
      const accounts = (await accountsResp.json()) as Array<{ id: number; name: string }>;
      createdAccountId = accounts.find((item) => item.name === accountName)?.id ?? null;
      expect(createdAccountId).not.toBeNull();

      await safeClick(targetRow.getByRole("button", { name: /删\s*除/ }));
      const confirmDeleteButton = page.locator(".ant-popover:visible").getByRole("button", { name: /删\s*除/ }).first();
      if (await confirmDeleteButton.isVisible().catch(() => false)) {
        await safeClick(confirmDeleteButton);
        await expectAndCloseSuccessModal(page, "账户已删除");
      }
    } finally {
      if (createdAccountId !== null) {
        await authedDelete(request, `/api/v1/accounts/${createdAccountId}`);
      }
    }
  });
});
