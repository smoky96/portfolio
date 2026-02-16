import { expect, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";

const APP_USER = process.env.PLAYWRIGHT_APP_USER ?? "admin";
const APP_PASS = process.env.PLAYWRIGHT_APP_PASS ?? "admin123";
const LOGIN_RETRY_DELAYS_MS = [0, 1000, 3000, 6000, 12000];
const requestAuthState = new WeakMap<APIRequestContext, boolean>();

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function ensureAuthenticated(request: APIRequestContext): Promise<void> {
  if (requestAuthState.get(request)) {
    return;
  }

  let lastStatus: number | null = null;
  let lastBody = "";

  for (const delay of LOGIN_RETRY_DELAYS_MS) {
    if (delay > 0) {
      await sleep(delay);
    }

    const response = await request.post("/api/v1/auth/login", {
      data: {
        username: APP_USER,
        password: APP_PASS
      }
    });
    if (response.ok()) {
      requestAuthState.set(request, true);
      return;
    }

    lastStatus = response.status();
    lastBody = (await response.text()).slice(0, 200);

    if (lastStatus !== 429 && lastStatus < 500) {
      break;
    }
  }

  throw new Error(`E2E API login failed with status ${lastStatus ?? "unknown"}: ${lastBody}`);
}

async function authedFetch(
  request: APIRequestContext,
  url: string,
  init: Omit<Parameters<APIRequestContext["fetch"]>[1], "method"> & { method: string }
): Promise<APIResponse> {
  let lastResponse: APIResponse | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await ensureAuthenticated(request);
    const response = await request.fetch(url, init);
    lastResponse = response;

    if (response.status() !== 401 && response.status() !== 429) {
      return response;
    }

    requestAuthState.set(request, false);
    await sleep((attempt + 1) * 1000);
  }

  expect(lastResponse).not.toBeNull();
  return lastResponse as APIResponse;
}

export async function authedGet(
  request: APIRequestContext,
  url: string,
  init?: Omit<Parameters<APIRequestContext["get"]>[1], "headers">
): Promise<APIResponse> {
  return authedFetch(request, url, { ...(init ?? {}), method: "GET" });
}

export async function authedPost(
  request: APIRequestContext,
  url: string,
  init?: Omit<Parameters<APIRequestContext["post"]>[1], "headers">
): Promise<APIResponse> {
  return authedFetch(request, url, { ...(init ?? {}), method: "POST" });
}

export async function authedPatch(
  request: APIRequestContext,
  url: string,
  init?: Omit<Parameters<APIRequestContext["patch"]>[1], "headers">
): Promise<APIResponse> {
  return authedFetch(request, url, { ...(init ?? {}), method: "PATCH" });
}

export async function authedDelete(
  request: APIRequestContext,
  url: string,
  init?: Omit<Parameters<APIRequestContext["delete"]>[1], "headers">
): Promise<APIResponse> {
  return authedFetch(request, url, { ...(init ?? {}), method: "DELETE" });
}

export async function loginIfNeeded(page: Page) {
  const usernameInput = page.locator("#login-username").first();
  if ((await usernameInput.count()) === 0) {
    return;
  }
  if (!(await usernameInput.isVisible().catch(() => false))) {
    return;
  }

  let lastStatus: number | null = null;
  for (const delay of LOGIN_RETRY_DELAYS_MS) {
    if (delay > 0) {
      await page.waitForTimeout(delay);
    }

    await usernameInput.fill(APP_USER);
    await page.locator("#login-password").first().fill(APP_PASS);

    const loginResponsePromise = page.waitForResponse(
      (response) => response.url().includes("/api/v1/auth/login") && response.request().method() === "POST",
      { timeout: 15000 }
    );
    await page.getByRole("button", { name: /登录系统/ }).first().click();
    const loginResponse = await loginResponsePromise;
    lastStatus = loginResponse.status();

    if (loginResponse.ok()) {
      await expect(page.locator("#login-username")).toHaveCount(0, { timeout: 15000 });
      return;
    }

    if (lastStatus !== 429 && lastStatus < 500) {
      break;
    }
  }

  throw new Error(`E2E UI login failed with status ${lastStatus ?? "unknown"}`);
}

export async function gotoWithLogin(page: Page, path: string) {
  await page.goto(path);
  await loginIfNeeded(page);
}
