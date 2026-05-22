/**
 * `workbook auth chatgpt` — run the loopback OAuth dance against
 * OpenAI's Codex client so a user can sign in with their ChatGPT
 * Plus/Pro/Team subscription and use it for inference.
 *
 * Why a CLI command and not a Studio web flow: ChatGPT's OAuth uses
 * a fixed loopback redirect_uri (http://localhost:1455/auth/callback)
 * — it doesn't accept arbitrary hosted redirect URLs. Zed, Cursor,
 * and opencode all reuse the Codex CLI's OAuth client for the same
 * reason. Studio can't do this directly; the CLI captures the token
 * locally and emits a paste-able bundle the user pastes into
 * Studio → Integrations.
 *
 * Reference impl: Zed PR #56811 (crates/language_models/src/provider/
 * openai_subscribed.rs). Memory key: sign-in-with-chatgpt-oauth-flow.
 *
 * wb-3l4.
 */

import http from "node:http";
import { spawn } from "node:child_process";

// Codex CLI's published OAuth client — same id every third-party
// reimplementation reuses. We're a third-party app reusing it the
// way Zed et al. do; OpenAI hasn't shipped an official "Sign in with
// ChatGPT" client yet (openai/codex#10974).
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTH_URL = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
// Fixed port — the Codex OAuth client only accepts this exact
// redirect_uri. Conflicts with other apps using port 1455 will
// fail with a clear error.
const REDIRECT_PORT = 1455;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/auth/callback`;
const SCOPES = "openid profile email";

export async function runAuthChatgpt(_opts = {}) {
  const { verifier, challenge } = await makePkce();
  const state = base64url(crypto.getRandomValues(new Uint8Array(16)));
  const authUrl =
    `${AUTH_URL}?` +
    new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      scope: SCOPES,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();

  const { server, codePromise } = await startListener(state);
  process.stdout.write(`Opening browser to sign in with ChatGPT…\n  ${authUrl}\n`);
  openInBrowser(authUrl);

  let code;
  try {
    code = await codePromise;
  } finally {
    server.close();
  }

  // Exchange code for tokens. The token endpoint accepts
  // application/x-www-form-urlencoded.
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: verifier,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`workbook auth chatgpt: token exchange ${res.status} — ${text.slice(0, 300)}`);
  }
  const json = await res.json();
  if (!json.access_token || !json.refresh_token) {
    throw new Error(
      `workbook auth chatgpt: token response missing access_token/refresh_token — ${JSON.stringify(json).slice(0, 300)}`,
    );
  }

  // Emit a paste-able bundle. Authors paste the JSON into Studio's
  // Sign in with ChatGPT dialog; Studio writes a providerKeys row
  // (provider="chatgpt-subscription") with these fields.
  const bundle = {
    provider: "chatgpt-subscription",
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresIn: json.expires_in ?? null,
    idToken: json.id_token ?? null,
    tokenType: json.token_type ?? "Bearer",
    scope: json.scope ?? SCOPES,
    capturedAt: new Date().toISOString(),
  };
  process.stdout.write("\n");
  process.stdout.write(
    "Sign-in complete. Paste the JSON below into Studio → Integrations → Sign in with ChatGPT:\n\n",
  );
  process.stdout.write(JSON.stringify(bundle, null, 2));
  process.stdout.write("\n\n");
  process.stdout.write(
    "Keep this terminal output private — these tokens are bound to your ChatGPT account.\n",
  );
}

function startListener(expectedState) {
  return new Promise((resolve, reject) => {
    let resolveCode;
    let rejectCode;
    const codePromise = new Promise((res, rej) => {
      resolveCode = res;
      rejectCode = rej;
    });
    const deadline = setTimeout(
      () => rejectCode(new Error("auth timed out after 5m")),
      5 * 60_000,
    );

    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
      if (url.pathname !== "/auth/callback") {
        res.writeHead(404).end();
        return;
      }
      const err = url.searchParams.get("error");
      if (err) {
        const desc = url.searchParams.get("error_description") ?? "";
        res.writeHead(400, { "content-type": "text/html; charset=utf-8" }).end(
          `<html><body><h1>Sign-in failed</h1><p>${escapeHtml(err)}</p><p>${escapeHtml(desc)}</p></body></html>`,
        );
        clearTimeout(deadline);
        rejectCode(new Error(`oauth error: ${err} ${desc}`));
        return;
      }
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (!code) {
        res.writeHead(400, { "content-type": "text/html; charset=utf-8" }).end(
          "<html><body>Missing code.</body></html>",
        );
        return;
      }
      if (state !== expectedState) {
        res.writeHead(400, { "content-type": "text/html; charset=utf-8" }).end(
          "<html><body>State mismatch — possible CSRF. Run the command again.</body></html>",
        );
        clearTimeout(deadline);
        rejectCode(new Error("state mismatch"));
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(
        "<html><body><h1>You're signed in</h1><p>Return to your terminal and paste the JSON output into Studio.</p></body></html>",
      );
      clearTimeout(deadline);
      resolveCode(code);
    });

    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        reject(
          new Error(
            `workbook auth chatgpt: port ${REDIRECT_PORT} is in use. ` +
              `Close the other app on that port and retry — OpenAI's OAuth client requires this exact port.`,
          ),
        );
      } else {
        reject(err);
      }
    });
    server.listen(REDIRECT_PORT, "127.0.0.1", () => {
      resolve({ server, codePromise });
    });
  });
}

async function makePkce() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = base64url(new Uint8Array(digest));
  return { verifier, challenge };
}

function base64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function openInBrowser(url) {
  const platform = process.platform;
  const cmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
  } catch {
    // No browser available — user can manually copy/paste the URL.
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
