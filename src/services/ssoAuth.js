import { setSsoAccessToken } from "./awsApi.js";

const config = {
  authorizeUrl: import.meta.env.VITE_SSO_AUTHORIZE_URL,
  tokenUrl: import.meta.env.VITE_SSO_TOKEN_URL,
  clientId: import.meta.env.VITE_SSO_CLIENT_ID,
  redirectUri: import.meta.env.VITE_SSO_REDIRECT_URI || window.location.origin,
  scope: import.meta.env.VITE_SSO_SCOPE || "openid profile email"
};

const VERIFIER_KEY = "reservata.pkceVerifier";
const STATE_KEY = "reservata.oidcState";

export const ssoClientConfigured = Boolean(config.authorizeUrl && config.tokenUrl && config.clientId);

function randomValue(length = 48) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function base64Url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function challengeFor(verifier) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

export async function startSsoLogin() {
  if (!ssoClientConfigured) throw new Error("University SSO client settings are incomplete.");
  const verifier = randomValue();
  const state = randomValue(24);
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);
  const parameters = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: config.scope,
    state,
    code_challenge: await challengeFor(verifier),
    code_challenge_method: "S256"
  });
  window.location.assign(`${config.authorizeUrl}?${parameters}`);
}

export async function completeSsoLogin() {
  const currentUrl = new URL(window.location.href);
  const code = currentUrl.searchParams.get("code");
  const returnedState = currentUrl.searchParams.get("state");
  const error = currentUrl.searchParams.get("error");
  if (error) throw new Error(currentUrl.searchParams.get("error_description") || "University SSO login was not completed.");
  if (!code) return false;

  const expectedState = sessionStorage.getItem(STATE_KEY);
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  if (!expectedState || returnedState !== expectedState || !verifier) throw new Error("University SSO response validation failed.");

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      code,
      code_verifier: verifier
    })
  });
  const tokens = await response.json().catch(() => ({}));
  if (!response.ok || (!tokens.id_token && !tokens.access_token)) throw new Error(tokens.error_description || "University SSO token exchange failed.");

  setSsoAccessToken(tokens.id_token || tokens.access_token);
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
  currentUrl.searchParams.delete("code");
  currentUrl.searchParams.delete("state");
  window.history.replaceState({}, document.title, currentUrl.pathname + currentUrl.search + currentUrl.hash);
  return true;
}
