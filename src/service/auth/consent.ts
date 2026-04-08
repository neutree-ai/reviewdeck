import { Hono } from "hono";
import { randomBytes, randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { hashPassword, verifyPassword, getSigningKey } from "./token.ts";
import type { ReviewDeckOAuthProvider } from "./provider.ts";
import type { Storage } from "../storage/interface.ts";

const SESSION_COOKIE = "rd_session";
const SESSION_TTL = 600; // 10 minutes

interface SessionPayload {
  userId: string;
  username: string;
  csrf: string;
}

async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ username: payload.username, csrf: payload.csrf })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.userId)
    .setExpirationTime(Math.floor(Date.now() / 1000) + SESSION_TTL)
    .sign(getSigningKey());
}

async function verifySessionToken(token: string): Promise<SessionPayload | undefined> {
  try {
    const { payload } = await jwtVerify(token, getSigningKey(), { algorithms: ["HS256"] });
    return {
      userId: payload.sub!,
      username: payload.username as string,
      csrf: payload.csrf as string,
    };
  } catch {
    return undefined;
  }
}

function page(body: string, title = "ReviewDeck"): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f5f5f5; margin: 0; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    .card { background: #fff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); padding: 2rem; max-width: 400px; width: 100%; }
    h1 { font-size: 1.25rem; margin: 0 0 1.5rem; color: #111; }
    label { display: block; font-size: 0.875rem; font-weight: 500; color: #333; margin-bottom: 0.25rem; }
    input[type="text"], input[type="password"] { width: 100%; padding: 0.5rem 0.75rem; border: 1px solid #ddd; border-radius: 6px; font-size: 0.875rem; margin-bottom: 1rem; }
    input:focus { outline: none; border-color: #666; }
    .btn { display: inline-block; padding: 0.5rem 1.25rem; border: none; border-radius: 6px; font-size: 0.875rem; font-weight: 500; cursor: pointer; text-decoration: none; }
    .btn-primary { background: #111; color: #fff; }
    .btn-secondary { background: #eee; color: #333; }
    .btn-danger { background: #fee; color: #c00; }
    .btn:hover { opacity: 0.9; }
    .actions { display: flex; gap: 0.75rem; margin-top: 0.5rem; }
    .error { background: #fee; color: #c00; padding: 0.5rem 0.75rem; border-radius: 6px; font-size: 0.875rem; margin-bottom: 1rem; }
    .scope-list { background: #f9f9f9; border-radius: 6px; padding: 0.75rem 1rem; margin-bottom: 1rem; }
    .scope-list code { background: #eee; padding: 0.125rem 0.375rem; border-radius: 3px; font-size: 0.8rem; }
    .toggle { font-size: 0.8rem; color: #666; margin-bottom: 1rem; display: block; }
    .toggle a { color: #111; }
  </style>
</head>
<body>
  <div class="card">${body}</div>
</body>
</html>`;
}

export function createConsentRouter(storage: Storage, provider: ReviewDeckOAuthProvider): Hono {
  const app = new Hono();

  // --- Login / Register page ---
  app.get("/login", (c) => {
    const req = c.req.query("req") ?? "";
    const mode = c.req.query("mode") ?? "login";
    const error = c.req.query("error");

    const isRegister = mode === "register";
    const toggleUrl = `/auth/login?req=${encodeURIComponent(req)}&mode=${isRegister ? "login" : "register"}`;

    return c.html(
      page(
        `<h1>${isRegister ? "Register" : "Sign in"} to ReviewDeck</h1>
        ${error ? `<div class="error">${escapeHtml(error)}</div>` : ""}
        <form method="POST" action="/auth/login">
          <input type="hidden" name="req" value="${escapeAttr(req)}">
          <input type="hidden" name="mode" value="${isRegister ? "register" : "login"}">
          <label for="username">Username</label>
          <input type="text" id="username" name="username" required autocomplete="username">
          <label for="password">Password</label>
          <input type="password" id="password" name="password" required autocomplete="${isRegister ? "new-password" : "current-password"}">
          ${isRegister ? `<label for="confirm">Confirm password</label><input type="password" id="confirm" name="confirm" required autocomplete="new-password">` : ""}
          <div class="actions">
            <button type="submit" class="btn btn-primary">${isRegister ? "Register" : "Sign in"}</button>
          </div>
          <span class="toggle">${isRegister ? 'Already have an account? <a href="' + toggleUrl + '">Sign in</a>' : 'No account? <a href="' + toggleUrl + '">Register</a>'}</span>
        </form>`,
      ),
    );
  });

  // --- Handle login / register form ---
  app.post("/login", async (c) => {
    const body = await c.req.parseBody();
    const reqId = (body.req as string) ?? "";
    const mode = (body.mode as string) ?? "login";
    const username = ((body.username as string) ?? "").trim();
    const password = (body.password as string) ?? "";

    const errorRedirect = (msg: string) => {
      const url = new URL("/auth/login", provider["baseUrl"]);
      url.searchParams.set("req", reqId);
      url.searchParams.set("mode", mode);
      url.searchParams.set("error", msg);
      return c.redirect(url.toString());
    };

    if (!username || !password) return errorRedirect("Username and password are required");
    if (username.length > 64) return errorRedirect("Username too long");

    let userId: string;
    let resolvedUsername: string;

    if (mode === "register") {
      const confirm = (body.confirm as string) ?? "";
      if (password !== confirm) return errorRedirect("Passwords do not match");
      if (password.length < 8) return errorRedirect("Password must be at least 8 characters");

      const existing = await storage.getUserByUsername(username);
      if (existing) return errorRedirect("Username already taken");

      userId = randomUUID();
      resolvedUsername = username;
      await storage.saveUser({
        id: userId,
        username,
        passwordHash: await hashPassword(password),
        createdAt: new Date(),
      });
    } else {
      const user = await storage.getUserByUsername(username);
      if (!user) return errorRedirect("Invalid username or password");
      const valid = await verifyPassword(password, user.passwordHash);
      if (!valid) return errorRedirect("Invalid username or password");
      userId = user.id;
      resolvedUsername = user.username;
    }

    // Set session cookie and redirect to consent page
    const csrf = randomBytes(16).toString("hex");
    const sessionToken = await createSessionToken({
      userId,
      username: resolvedUsername,
      csrf,
    });

    const consentUrl = new URL("/auth/consent", provider["baseUrl"]);
    consentUrl.searchParams.set("req", reqId);

    c.header(
      "Set-Cookie",
      `${SESSION_COOKIE}=${sessionToken}; HttpOnly; SameSite=Lax; Path=/auth; Max-Age=${SESSION_TTL}`,
    );
    return c.redirect(consentUrl.toString());
  });

  // --- Consent page ---
  app.get("/consent", async (c) => {
    const reqId = c.req.query("req") ?? "";
    const cookie = parseCookie(c.req.header("cookie"), SESSION_COOKIE);
    if (!cookie) return c.redirect(`/auth/login?req=${encodeURIComponent(reqId)}`);

    const session = await verifySessionToken(cookie);
    if (!session) return c.redirect(`/auth/login?req=${encodeURIComponent(reqId)}`);

    const pending = provider.getPendingRequest(reqId);
    if (!pending) {
      return c.html(page(`<h1>Error</h1><p>Authorization request expired or not found.</p>`), 400);
    }

    const client = await storage.getOAuthClient(pending.clientId);
    const clientName = client?.client_name ?? pending.clientId;
    const scopes = pending.params.scopes ?? [];

    return c.html(
      page(
        `<h1>Authorize application</h1>
        <p><strong>${escapeHtml(clientName)}</strong> wants to access your ReviewDeck account as <strong>${escapeHtml(session.username)}</strong>.</p>
        ${scopes.length > 0 ? `<div class="scope-list">Requested scopes: ${scopes.map((s) => `<code>${escapeHtml(s)}</code>`).join(" ")}</div>` : ""}
        <form method="POST" action="/auth/consent">
          <input type="hidden" name="req" value="${escapeAttr(reqId)}">
          <input type="hidden" name="csrf" value="${escapeAttr(session.csrf)}">
          <div class="actions">
            <button type="submit" name="action" value="approve" class="btn btn-primary">Approve</button>
            <button type="submit" name="action" value="deny" class="btn btn-danger">Deny</button>
          </div>
        </form>`,
      ),
    );
  });

  // --- Handle consent decision ---
  app.post("/consent", async (c) => {
    const body = await c.req.parseBody();
    const reqId = (body.req as string) ?? "";
    const csrfToken = (body.csrf as string) ?? "";
    const action = (body.action as string) ?? "";

    const cookie = parseCookie(c.req.header("cookie"), SESSION_COOKIE);
    if (!cookie) return c.redirect(`/auth/login?req=${encodeURIComponent(reqId)}`);

    const session = await verifySessionToken(cookie);
    if (!session) return c.redirect(`/auth/login?req=${encodeURIComponent(reqId)}`);

    if (csrfToken !== session.csrf) {
      return c.html(page(`<h1>Error</h1><p>Invalid CSRF token. Please try again.</p>`), 403);
    }

    const pending = provider.consumePendingRequest(reqId);
    if (!pending) {
      return c.html(page(`<h1>Error</h1><p>Authorization request expired or not found.</p>`), 400);
    }

    if (action !== "approve") {
      // Deny — redirect back to client with error
      const redirectUri = new URL(pending.params.redirectUri);
      redirectUri.searchParams.set("error", "access_denied");
      redirectUri.searchParams.set("error_description", "User denied authorization");
      if (pending.params.state) redirectUri.searchParams.set("state", pending.params.state);
      return c.redirect(redirectUri.toString());
    }

    // Approve — generate auth code and redirect
    const code = randomBytes(32).toString("hex");
    const now = Math.floor(Date.now() / 1000);

    await storage.saveAuthCode({
      code,
      clientId: pending.clientId,
      userId: session.userId,
      codeChallenge: pending.params.codeChallenge,
      redirectUri: pending.params.redirectUri,
      scopes: pending.params.scopes ?? [],
      resource: pending.params.resource?.toString(),
      expiresAt: now + 600, // 10 minutes
    });

    const redirectUri = new URL(pending.params.redirectUri);
    redirectUri.searchParams.set("code", code);
    if (pending.params.state) redirectUri.searchParams.set("state", pending.params.state);

    // Clear session cookie
    c.header("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/auth; Max-Age=0`);
    return c.redirect(redirectUri.toString());
  });

  return app;
}

// --- Helpers ---

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match?.[1];
}
