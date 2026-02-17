import { expect, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";

const APP_USER = process.env.PLAYWRIGHT_APP_USER ?? "admin";
const APP_PASS = process.env.PLAYWRIGHT_APP_PASS ?? "admin123";
const API_BASE = process.env.PLAYWRIGHT_API_BASE?.replace(/\/+$/, "") ?? "";
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL?.replace(/\/+$/, "") ?? "http://localhost:8080";
const AUTH_SESSION_STORAGE_KEY = "portfolio.auth.session";
const LOGIN_RETRY_DELAYS_MS = [0, 800, 2000, 4000];
const UI_LOGIN_RETRY_DELAYS_MS = [0, 600, 1600];
const requestAuthState = new WeakMap<APIRequestContext, boolean>();
let cachedAuthState: CachedAuthState | null = null;
let authBootstrapPromise: Promise<CachedAuthState> | null = null;

interface AuthSession {
  expires_at: string;
  user: {
    id: number;
    username: string;
    role: string;
    is_active: boolean;
    last_login_at: string | null;
    created_at: string;
    updated_at: string;
  };
}

interface CachedAuthState {
  session: AuthSession;
  cookieName: string;
  cookieValue: string;
}

function resolveApiUrl(path: string): string {
  if (!API_BASE || /^https?:\/\//.test(path)) {
    return path;
  }
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

function resolveAbsoluteUrl(path: string): string {
  if (/^https?:\/\//.test(path)) {
    return path;
  }
  return new URL(path, `${BASE_URL}/`).toString();
}

function resolveAbsoluteApiUrl(path: string): string {
  return resolveAbsoluteUrl(resolveApiUrl(path));
}

function readSetCookieHeader(response: Response): string | null {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") {
    const setCookies = headers.getSetCookie();
    if (setCookies.length > 0) {
      return setCookies[0];
    }
  }
  return response.headers.get("set-cookie");
}

function parseCookiePair(setCookieHeader: string | null): { name: string; value: string } | null {
  if (!setCookieHeader) {
    return null;
  }
  const match = setCookieHeader.match(/^\s*([^=;,\s]+)=([^;]+)/);
  if (!match) {
    return null;
  }
  return { name: match[1], value: match[2] };
}

function parseAuthSession(raw: string): AuthSession | null {
  try {
    const parsed = JSON.parse(raw) as Partial<AuthSession>;
    if (!parsed.expires_at || !parsed.user) {
      return null;
    }
    return parsed as AuthSession;
  } catch {
    return null;
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function bootstrapAuthState(forceRefresh = false): Promise<CachedAuthState> {
  if (!forceRefresh && cachedAuthState && Date.parse(cachedAuthState.session.expires_at) > Date.now() + 60_000) {
    return cachedAuthState;
  }
  if (!forceRefresh && authBootstrapPromise) {
    return authBootstrapPromise;
  }

  const runner = (async () => {
    let lastStatus: number | null = null;
    let lastBody = "";

    for (const delay of LOGIN_RETRY_DELAYS_MS) {
      if (delay > 0) {
        await sleep(delay);
      }

      const response = await fetch(resolveAbsoluteApiUrl("/api/v1/auth/login"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          username: APP_USER,
          password: APP_PASS
        })
      });
      const bodyText = await response.text();
      if (response.ok) {
        const session = parseAuthSession(bodyText);
        const cookiePair = parseCookiePair(readSetCookieHeader(response));
        if (session && cookiePair) {
          cachedAuthState = {
            session,
            cookieName: cookiePair.name,
            cookieValue: cookiePair.value
          };
          return cachedAuthState;
        }
        throw new Error("E2E login bootstrap succeeded but response payload is invalid");
      }

      lastStatus = response.status;
      lastBody = bodyText.slice(0, 200);

      if (lastStatus !== 429 && lastStatus < 500) {
        break;
      }
    }

    throw new Error(`E2E login bootstrap failed with status ${lastStatus ?? "unknown"}: ${lastBody}`);
  })();

  authBootstrapPromise = runner;
  try {
    return await runner;
  } finally {
    if (authBootstrapPromise === runner) {
      authBootstrapPromise = null;
    }
  }
}

async function ensureAuthenticated(request: APIRequestContext, forceRefresh = false): Promise<CachedAuthState> {
  if (!forceRefresh && requestAuthState.get(request) && cachedAuthState) {
    return cachedAuthState;
  }
  const authState = await bootstrapAuthState(forceRefresh);
  requestAuthState.set(request, true);
  return authState;
}

function resolveCookieOrigins(): string[] {
  const origins = new Set<string>();
  origins.add(new URL(resolveAbsoluteUrl("/")).origin);
  origins.add(new URL(resolveAbsoluteApiUrl("/api/v1/auth/login")).origin);
  return [...origins];
}

async function primePageAuthState(page: Page): Promise<void> {
  const authState = await bootstrapAuthState();
  const expiresSeconds = Math.floor(Date.parse(authState.session.expires_at) / 1000);
  const domains = [...new Set(resolveCookieOrigins().map((origin) => new URL(origin).hostname))];
  const cookies = domains.map((domain) => ({
    name: authState.cookieName,
    value: authState.cookieValue,
    domain,
    path: "/",
    httpOnly: true,
    sameSite: "Lax" as const,
    expires: expiresSeconds
  }));
  await page.context().addCookies(cookies);
  await page.addInitScript(
    ({ session, storageKey }: { session: AuthSession; storageKey: string }) => {
      window.localStorage.setItem(storageKey, JSON.stringify(session));
    },
    { session: authState.session, storageKey: AUTH_SESSION_STORAGE_KEY }
  );
}

async function attachAuthCookieHeaders(
  request: APIRequestContext,
  init: Omit<Parameters<APIRequestContext["fetch"]>[1], "method"> & { method: string },
  forceRefresh = false
): Promise<Record<string, string>> {
  const authState = await ensureAuthenticated(request, forceRefresh);
  const headers = new Headers(init.headers as HeadersInit | undefined);
  headers.set("Cookie", `${authState.cookieName}=${authState.cookieValue}`);
  return Object.fromEntries(headers.entries());
}

async function authedFetch(
  request: APIRequestContext,
  url: string,
  init: Omit<Parameters<APIRequestContext["fetch"]>[1], "method"> & { method: string }
): Promise<APIResponse> {
  let lastResponse: APIResponse | null = null;
  const resolvedUrl = resolveApiUrl(url);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const headers = await attachAuthCookieHeaders(request, init, attempt > 0);
    const response = await request.fetch(resolvedUrl, {
      ...init,
      headers
    });
    lastResponse = response;

    if (response.status() !== 401 && response.status() !== 429) {
      return response;
    }

    if (response.status() === 401) {
      requestAuthState.set(request, false);
      cachedAuthState = null;
    }
    await sleep((attempt + 1) * 700);
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

  async function closeBlockingModalIfPresent() {
    const modal = page.locator(".ant-modal-confirm:visible").last();
    if (!(await modal.isVisible().catch(() => false))) {
      return;
    }
    const okButton = modal.getByRole("button", { name: /确\s*定/ }).first();
    if (await okButton.isVisible().catch(() => false)) {
      await okButton.click({ force: true });
      await page.waitForTimeout(120);
    }
  }

  let lastStatus: number | null = null;
  for (const delay of UI_LOGIN_RETRY_DELAYS_MS) {
    if (delay > 0) {
      await page.waitForTimeout(delay);
    }
    await closeBlockingModalIfPresent();

    await usernameInput.fill(APP_USER);
    await page.locator("#login-password").first().fill(APP_PASS);

    const loginResponsePromise = page
      .waitForResponse(
        (response) => response.url().includes("/api/v1/auth/login") && response.request().method() === "POST",
        { timeout: 5000 }
      )
      .catch(() => null);
    await page.getByRole("button", { name: /登录系统/ }).first().click();
    const loginResponse = await loginResponsePromise;
    if (!loginResponse) {
      if ((await page.locator("#login-username").count()) === 0) {
        return;
      }
      continue;
    }

    lastStatus = loginResponse.status();

    if (loginResponse.ok()) {
      await expect(page.locator("#login-username")).toHaveCount(0, { timeout: 8000 });
      return;
    }

    await closeBlockingModalIfPresent();
    if (lastStatus !== 429 && lastStatus < 500) {
      break;
    }
  }

  throw new Error(`E2E UI login failed with status ${lastStatus ?? "unknown"}`);
}

export async function gotoWithLogin(page: Page, path: string) {
  await primePageAuthState(page);
  await page.goto(path);
  await loginIfNeeded(page);
}
