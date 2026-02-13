export type UserRole = "ADMIN" | "MEMBER";

export interface AuthUser {
  id: number;
  username: string;
  role: UserRole;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuthSession {
  access_token: string;
  token_type: "bearer";
  expires_at: string;
  user: AuthUser;
}

const SESSION_KEY = "portfolio.auth.session";
const REMEMBERED_USER_KEY = "portfolio.auth.remembered.username";
const AUTH_EXPIRED_EVENT = "portfolio.auth.expired";

function safeStorage() {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage;
}

function parseSession(raw: string): AuthSession | null {
  try {
    const parsed = JSON.parse(raw) as Partial<AuthSession>;
    if (!parsed.access_token || !parsed.expires_at || !parsed.user) {
      return null;
    }
    return {
      access_token: String(parsed.access_token),
      token_type: "bearer",
      expires_at: String(parsed.expires_at),
      user: parsed.user as AuthUser
    };
  } catch {
    return null;
  }
}

export function getStoredSession(): AuthSession | null {
  const storage = safeStorage();
  if (!storage) {
    return null;
  }
  const raw = storage.getItem(SESSION_KEY);
  if (!raw) {
    return null;
  }
  const session = parseSession(raw);
  if (!session) {
    return null;
  }
  if (Date.parse(session.expires_at) <= Date.now()) {
    storage.removeItem(SESSION_KEY);
    return null;
  }
  return session;
}

export function saveSession(session: AuthSession, rememberUsername: boolean) {
  const storage = safeStorage();
  if (!storage) {
    return;
  }
  storage.setItem(SESSION_KEY, JSON.stringify(session));
  if (rememberUsername) {
    storage.setItem(REMEMBERED_USER_KEY, session.user.username);
  } else {
    storage.removeItem(REMEMBERED_USER_KEY);
  }
}

export function clearSession() {
  const storage = safeStorage();
  storage?.removeItem(SESSION_KEY);
}

export function getRememberedUsername() {
  const storage = safeStorage();
  return storage?.getItem(REMEMBERED_USER_KEY) ?? "";
}

export function getAccessToken() {
  const session = getStoredSession();
  return session?.access_token ?? null;
}

export function dispatchAuthExpired() {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
}

export function onAuthExpired(callback: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }
  const listener = () => callback();
  window.addEventListener(AUTH_EXPIRED_EVENT, listener);
  return () => window.removeEventListener(AUTH_EXPIRED_EVENT, listener);
}
