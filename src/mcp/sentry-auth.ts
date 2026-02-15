import crypto from "node:crypto";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { auth, type OAuthClientInformation, type OAuthClientMetadata, type OAuthClientProvider, type OAuthTokens } from "@ai-sdk/mcp";

const SENTRY_OAUTH_PATH = path.join(os.homedir(), ".frogo", "oauth", "sentry.json");
const SENTRY_REDIRECT_PORT = 8976;

type StoredOAuthState = {
  tokens?: OAuthTokens;
  clientInformation?: OAuthClientInformation;
  codeVerifier?: string;
  state?: string;
};

async function readOAuthState(): Promise<StoredOAuthState> {
  try {
    const raw = await fs.readFile(SENTRY_OAUTH_PATH, "utf-8");
    return JSON.parse(raw) as StoredOAuthState;
  } catch {
    return {};
  }
}

async function writeOAuthState(state: StoredOAuthState): Promise<void> {
  await fs.mkdir(path.dirname(SENTRY_OAUTH_PATH), { recursive: true, mode: 0o700 });
  await fs.writeFile(SENTRY_OAUTH_PATH, JSON.stringify(state, null, 2), {
    encoding: "utf-8",
    mode: 0o600
  });
  await fs.chmod(SENTRY_OAUTH_PATH, 0o600).catch(() => {
    /* ignore chmod failures */
  });
}

function openUrl(url: string): void {
  const platform = process.platform;
  if (platform === "darwin") {
    spawn("open", [url], { stdio: "ignore", detached: true }).unref();
    return;
  }
  if (platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true }).unref();
    return;
  }
  spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
}

async function waitForOAuthCode(port: number): Promise<{ code: string; state?: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end();
        return;
      }

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state") ?? undefined;
      if (!code) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Missing code");
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><body><h2>Authorized. You can close this window.</h2></body></html>");
      server.close();
      resolve({ code, state });
    });

    server.on("error", (error) => reject(error));
    server.listen(port, "127.0.0.1");
  });
}

export async function getSentryOAuthProvider(): Promise<{ provider: OAuthClientProvider; state: StoredOAuthState }> {
  const state = await readOAuthState();
  const redirectUrl = `http://127.0.0.1:${SENTRY_REDIRECT_PORT}/callback`;

  const provider: OAuthClientProvider = {
    tokens: async () => state.tokens,
    saveTokens: async (tokens) => {
      state.tokens = tokens;
      await writeOAuthState(state);
    },
    redirectToAuthorization: async (authorizationUrl) => {
      openUrl(authorizationUrl.toString());
    },
    saveCodeVerifier: async (codeVerifier) => {
      state.codeVerifier = codeVerifier;
      await writeOAuthState(state);
    },
    codeVerifier: async () => {
      if (!state.codeVerifier) {
        throw new Error("Missing OAuth code verifier.");
      }
      return state.codeVerifier;
    },
    redirectUrl,
    clientMetadata: {
      client_name: "Frogo CLI",
      redirect_uris: [redirectUrl],
      token_endpoint_auth_method: "none",
      response_types: ["code"],
      grant_types: ["authorization_code", "refresh_token"]
    } satisfies OAuthClientMetadata,
    clientInformation: async () => state.clientInformation,
    saveClientInformation: async (info) => {
      state.clientInformation = info;
      await writeOAuthState(state);
    },
    state: async () => {
      state.state = state.state ?? crypto.randomBytes(8).toString("hex");
      await writeOAuthState(state);
      return state.state;
    }
  };

  return { provider, state };
}

export async function runSentryOAuth(serverUrl: string): Promise<void> {
  const { provider, state } = await getSentryOAuthProvider();
  await auth(provider, { serverUrl });
  const { code, state: returnedState } = await waitForOAuthCode(SENTRY_REDIRECT_PORT);
  if (state.state && returnedState && state.state !== returnedState) {
    throw new Error("OAuth state mismatch. Please retry Sentry authentication.");
  }
  await auth(provider, { serverUrl, authorizationCode: code });
}

export async function hasSentryTokens(): Promise<boolean> {
  const state = await readOAuthState();
  return Boolean(state.tokens?.access_token);
}
