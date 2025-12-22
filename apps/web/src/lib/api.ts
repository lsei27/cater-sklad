export type ApiError = { error: { code: string; message: string } };

const RAW_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL as string | undefined;
const API_BASE_URL = (RAW_BASE_URL ?? "").replace(/\/+$/, "");

export function apiBaseUrl() {
  return API_BASE_URL;
}

export function apiUrl(pathOrUrl: string) {
  if (!pathOrUrl) return pathOrUrl;
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const p = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  return `${API_BASE_URL}${p}`;
}

export function getToken() {
  return localStorage.getItem("token");
}

export function setToken(token: string | null) {
  if (!token) localStorage.removeItem("token");
  else localStorage.setItem("token", token);
}

export type CurrentUser = { id: string; email: string; role: string };

export function getCurrentUser(): CurrentUser | null {
  const raw = localStorage.getItem("user");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CurrentUser;
  } catch {
    return null;
  }
}

export function setCurrentUser(user: CurrentUser | null) {
  if (!user) localStorage.removeItem("user");
  else localStorage.setItem("user", JSON.stringify(user));
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const fullUrl = url.startsWith("http") ? url : `${API_BASE_URL}${url}`;

  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type") && init?.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const res = await fetch(fullUrl, {
    ...init,
    headers
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw data as ApiError;
  return data as T;
}

export function withToken(url: string) {
  const token = getToken();
  if (!token) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}token=${token}`;
}
