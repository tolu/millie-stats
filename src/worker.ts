/// <reference types="@solidjs/vite-plugin/virtual-solid-manifest" />
// The Cloudflare-side entry.
//
// Solid's start mode hands server-function dispatch to us
// (serverFunctions.devMiddleware: false) so "use server" code runs inside
// workerd and sees the real D1 binding in dev, exactly as in production. The
// Cloudflare plugin owns every dev request, so this entry also serves the
// document shell — Solid's own dev middleware stands down when a provider
// takes the environment. In production the static assets binding answers
// first and only these routes reach here.
//
// Authentication is enforced HERE rather than inside each server function.
// One gate in front of the whole data surface fails closed by construction; a
// check repeated in every function fails open the first time someone forgets
// one. It also protects the summary endpoint, which spends real money.
//
// The manifest import is a side effect on purpose: without it, functions only
// referenced from client code never register.
import { handleRequest } from "virtual:solid-ssr-handler";
import { handleServerFunctionRequest } from "virtual:solid-server-function-handler";
import "virtual:solid-server-function-manifest";
import { createToken, readCookie, verifyToken } from "./lib/token";

const COOKIE = "millie_session";
const SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000;

type Env = {
  APP_PASSPHRASE?: string;
  COOKIE_SECRET?: string;
  /** Set only in .dev.vars. Never define it in wrangler.jsonc. */
  DEV_BYPASS_AUTH?: string;
};

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

async function isAuthorised(request: Request, env: Env): Promise<boolean> {
  if (env.DEV_BYPASS_AUTH === "1") return true;
  // Fail closed. A deployment missing its secrets is locked, not open.
  if (!env.APP_PASSPHRASE || !env.COOKIE_SECRET) return false;
  const token = readCookie(request.headers.get("cookie"), COOKIE);
  if (!token) return false;
  return verifyToken(token, env.COOKIE_SECRET);
}

async function login(request: Request, env: Env): Promise<Response> {
  if (!env.APP_PASSPHRASE || !env.COOKIE_SECRET) {
    return json({ ok: false, reason: "not-configured" }, { status: 503 });
  }
  let passphrase = "";
  try {
    const body = (await request.json()) as { passphrase?: unknown };
    if (typeof body.passphrase === "string") passphrase = body.passphrase;
  } catch {
    return json({ ok: false }, { status: 400 });
  }

  if (passphrase !== env.APP_PASSPHRASE) {
    // A deliberate delay: this endpoint is the only thing between the open
    // internet and the journal, and it is guessable by construction.
    await new Promise((resolve) => setTimeout(resolve, 700));
    return json({ ok: false }, { status: 401 });
  }

  const token = await createToken(env.COOKIE_SECRET, SESSION_TTL_MS);
  const secure = new URL(request.url).protocol === "https:" ? " Secure;" : "";
  return json(
    { ok: true },
    {
      headers: {
        "set-cookie": `${COOKIE}=${token}; Path=/; Max-Age=${Math.floor(
          SESSION_TTL_MS / 1000,
        )}; HttpOnly;${secure} SameSite=Lax`,
      },
    },
  );
}

export { handleRequest };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_login") {
      if (request.method !== "POST") return new Response(null, { status: 405 });
      return login(request, env);
    }

    if (url.pathname === "/_auth") {
      return json({
        authorised: await isAuthorised(request, env),
        configured: Boolean(env.APP_PASSPHRASE && env.COOKIE_SECRET) ||
          env.DEV_BYPASS_AUTH === "1",
      });
    }

    if (url.pathname === "/_server" || url.pathname.startsWith("/_server/")) {
      if (!(await isAuthorised(request, env))) {
        return json({ error: "unauthorised" }, { status: 401 });
      }
      return handleServerFunctionRequest(request);
    }

    return handleRequest(request);
  },
};
