// GitHub Copilot OAuth device-flow login + on-disk token cache.
//
// Use case: user has no GITHUB_COPILOT_TOKEN / GITHUB_TOKEN and is not logged
// in via `gh`. We start the device-code OAuth flow against the public Copilot
// client id, print the verification URL + user code, and poll until the user
// authorizes. The resulting GitHub access token is cached under
// ~/.open-agent/copilot-token.json so subsequent runs skip the dance.
//
// Public Copilot OAuth client id used by the official editor plugins; this is
// the same id documented in countless community Copilot clients.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const COPILOT_CLIENT_ID = "Iv1.b507a08c87ecfe98";
const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";

const CACHE_DIR = path.join(os.homedir(), ".open-agent");
const CACHE_FILE = path.join(CACHE_DIR, "copilot-token.json");

interface CachedToken {
  github_token: string;
  saved_at: string;
}

// ---- cache --------------------------------------------------------------

export async function loadCachedToken(): Promise<string | null> {
  try {
    const raw = await fs.readFile(CACHE_FILE, "utf8");
    const data = JSON.parse(raw) as CachedToken;
    return data.github_token ?? null;
  } catch {
    return null;
  }
}

export async function saveCachedToken(token: string): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const data: CachedToken = { github_token: token, saved_at: new Date().toISOString() };
  await fs.writeFile(CACHE_FILE, JSON.stringify(data, null, 2), "utf8");
  try {
    // Best-effort: tighten permissions on POSIX.
    await fs.chmod(CACHE_FILE, 0o600);
  } catch {
    /* Windows etc -- ignore */
  }
}

export async function clearCachedToken(): Promise<void> {
  try {
    await fs.unlink(CACHE_FILE);
  } catch {
    /* not present -- fine */
  }
}

// ---- device flow --------------------------------------------------------

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface AccessTokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
  interval?: number;
}

export async function deviceFlowLogin(): Promise<string> {
  // 1. Request a device code.
  const dcRes = await fetch(DEVICE_CODE_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ client_id: COPILOT_CLIENT_ID, scope: "read:user" }),
  });
  if (!dcRes.ok) {
    throw new Error(`Device code request failed: HTTP ${dcRes.status} ${dcRes.statusText}`);
  }
  const dc = (await dcRes.json()) as DeviceCodeResponse;

  // 2. Show the user what to do (and try to open the browser).
  const banner = [
    "",
    "════════════════════════════════════════════════════════════",
    "  GitHub Copilot sign-in required",
    "────────────────────────────────────────────────────────────",
    `  Open this URL:  ${dc.verification_uri}`,
    `  Enter the code: ${dc.user_code}`,
    "",
    "  Waiting for you to authorize... (Ctrl+C to cancel)",
    "════════════════════════════════════════════════════════════",
    "",
  ].join("\n");
  // eslint-disable-next-line no-console
  console.log(banner);
  tryOpenBrowser(dc.verification_uri);

  // 3. Poll for the access token.
  let interval = (dc.interval ?? 5) * 1000;
  const deadline = Date.now() + dc.expires_in * 1000;

  while (Date.now() < deadline) {
    await sleep(interval);
    const tokRes = await fetch(ACCESS_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        client_id: COPILOT_CLIENT_ID,
        device_code: dc.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });
    // GitHub always returns 200 on this endpoint; check the body.
    const tok = (await tokRes.json()) as AccessTokenResponse;
    if (tok.access_token) {
      return tok.access_token;
    }
    switch (tok.error) {
      case "authorization_pending":
        continue;
      case "slow_down":
        interval += 5_000;
        continue;
      case "expired_token":
        throw new Error("Device code expired before authorization. Please try again.");
      case "access_denied":
        throw new Error("Authorization denied by user.");
      default:
        throw new Error(
          `Device flow failed: ${tok.error ?? "unknown"} - ${tok.error_description ?? ""}`,
        );
    }
  }
  throw new Error("Device code expired before authorization. Please try again.");
}

// ---- helpers ------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function tryOpenBrowser(url: string): void {
  try {
    const platform = process.platform;
    if (platform === "win32") {
      // `start` is a cmd builtin; spawn cmd directly so it doesn't open a window.
      spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true }).unref();
    } else if (platform === "darwin") {
      spawn("open", [url], { stdio: "ignore", detached: true }).unref();
    } else {
      spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
    }
  } catch {
    /* user can still copy/paste the URL */
  }
}
