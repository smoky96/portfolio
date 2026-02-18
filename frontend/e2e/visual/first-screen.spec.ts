import { expect, test, type Locator, type Page } from "@playwright/test";

import { gotoWithLogin } from "../helpers/auth";

test.describe("Visual first screen @visual", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  async function expectFirstScreen(page: Page, path: string, snapshot: string, extraMasks: Locator[] = []) {
    await gotoWithLogin(page, path);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot(snapshot, {
      fullPage: false,
      animations: "disabled",
      mask: [page.locator(".header-meta-tag"), page.locator(".ant-spin-spinning"), ...extraMasks]
    });
  }

  test("login page", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator(".login-page")).toBeVisible();
    await expect(page).toHaveScreenshot("login-first-screen.png", {
      fullPage: false,
      animations: "disabled"
    });
  });

  test("app shell and dashboard", async ({ page }) => {
    await expectFirstScreen(page, "/", "dashboard-first-screen.png", [page.locator(".dashboard-echart")]);
  });

  test("transactions first screen", async ({ page }) => {
    await expectFirstScreen(page, "/transactions", "transactions-first-screen.png");
  });

  test("holdings first screen", async ({ page }) => {
    await expectFirstScreen(page, "/holdings", "holdings-first-screen.png");
  });
});
