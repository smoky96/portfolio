import { expect, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";

const APP_USER = process.env.PLAYWRIGHT_APP_USER ?? "admin";
const APP_PASS = process.env.PLAYWRIGHT_APP_PASS ?? "admin123";
let cachedAccessToken: string | null = null;

interface LoginResponse {
  access_token: string;
}

async function getAccessToken(request: APIRequestContext): Promise<string> {
  if (cachedAccessToken) {
    return cachedAccessToken;
  }

  const response = await request.post("/api/v1/auth/login", {
    data: {
      username: APP_USER,
      password: APP_PASS
    }
  });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as LoginResponse;
  cachedAccessToken = payload.access_token;
  return cachedAccessToken;
}

async function authedFetch(
  request: APIRequestContext,
  url: string,
  init: Omit<Parameters<APIRequestContext["fetch"]>[1], "method"> & { method: string }
): Promise<APIResponse> {
  const token = await getAccessToken(request);
  const response = await request.fetch(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
  });

  if (response.status() !== 401) {
    return response;
  }

  cachedAccessToken = null;
  const refreshedToken = await getAccessToken(request);
  return request.fetch(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${refreshedToken}`,
    },
  });
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

  await usernameInput.fill(APP_USER);
  await page.locator("#login-password").first().fill(APP_PASS);
  await page.getByRole("button", { name: "登录系统", exact: true }).click();
  await expect(page.locator("#login-username")).toHaveCount(0, { timeout: 10000 });
}

export async function gotoWithLogin(page: Page, path: string) {
  await page.goto(path);
  await loginIfNeeded(page);
}
