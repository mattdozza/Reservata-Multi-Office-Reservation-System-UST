import { STORAGE_KEYS } from "../config.js";

const LOCAL_TOKEN_KEY = "reservata.localAccessToken.v1";

function localToken() {
  return sessionStorage.getItem(LOCAL_TOKEN_KEY) || "";
}

export function setLocalAccessToken(token) {
  if (token) sessionStorage.setItem(LOCAL_TOKEN_KEY, token);
  else sessionStorage.removeItem(LOCAL_TOKEN_KEY);
}

async function parseResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "The local RESERVATA service could not complete the request.");
  return payload;
}

async function authenticatedFetch(path, options = {}) {
  const token = localToken();
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    cache: "no-store"
  });
  return response;
}

export async function restoreLocalAccount() {
  if (!localToken()) return null;
  const response = await authenticatedFetch("/api/auth/session");
  if (response.status === 401 || response.status === 403) {
    setLocalAccessToken(null);
    return null;
  }
  return (await parseResponse(response)).user;
}

export async function logoutLocalAccount() {
  if (localToken()) {
    await authenticatedFetch("/api/auth/logout", { method: "POST" }).catch(() => null);
  }
  setLocalAccessToken(null);
}

export async function loadDatabase() {
  const response = await authenticatedFetch("/api/state");
  const data = await parseResponse(response);
  return { data, apiAvailable: true };
}

export async function loadResourceAvailability(resourceId, date, start, end) {
  const params = new URLSearchParams({ date, start, end });
  const response = await authenticatedFetch(`/api/resources/${encodeURIComponent(resourceId)}/availability?${params}`);
  return parseResponse(response);
}

export async function uploadLocalResourcePhoto(data) {
  return parseResponse(await authenticatedFetch("/api/resource-photos", { method: "POST", body: JSON.stringify({ data }) }));
}

export async function loadLocalResourcePhoto(key) {
  return parseResponse(await authenticatedFetch(`/api/resource-photos/${encodeURIComponent(key)}`));
}

export async function saveDatabase(data, apiAvailable) {
  localStorage.setItem(STORAGE_KEYS.offlineData, JSON.stringify(data));
  if (!apiAvailable) return false;
  const response = await authenticatedFetch("/api/state", {
    method: "PUT",
    body: JSON.stringify(data)
  });
  await parseResponse(response);
  return true;
}

export async function markLocalNotificationsRead(id = null) {
  const response = await authenticatedFetch("/api/notifications/read", {
    method: "PATCH",
    body: JSON.stringify(id ? { id } : {})
  });
  return parseResponse(response);
}

export async function createLocalUserAccount(person) {
  return parseResponse(await authenticatedFetch("/api/users", { method: "POST", body: JSON.stringify(person) }));
}

export function loadSession() {
  const stored = localStorage.getItem(STORAGE_KEYS.session);
  return stored ? JSON.parse(stored) : { activeRole: null, activeView: "dashboard" };
}

export function saveSession(session) {
  localStorage.setItem(STORAGE_KEYS.session, JSON.stringify(session));
}
