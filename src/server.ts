import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

// Origins allowed to embed the app (the Yani editor preview). Everything else is blocked.
const FRAME_ANCESTORS =
  "'self' https://yani.app https://*.yani.app https://*.yani.dev https://gptengineer.app https://*.gptengineer.app";

function supabaseOrigins(): string {
  const url = process.env.SUPABASE_URL;
  try {
    if (url) {
      const { host } = new URL(url);
      return `https://${host} wss://${host}`;
    }
  } catch {
    /* fall through */
  }
  return "https://*.supabase.co wss://*.supabase.co";
}

function contentSecurityPolicy(): string {
  return [
    "default-src 'self'",
    // TanStack Start streams inline hydration scripts; external scripts stay blocked.
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    `connect-src 'self' ${supabaseOrigins()}`,
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${FRAME_ANCESTORS}`,
    "upgrade-insecure-requests",
  ].join("; ");
}

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  const set = (name: string, value: string) => {
    if (!headers.has(name)) headers.set(name, value);
  };
  if ((headers.get("content-type") ?? "").includes("text/html")) {
    set("Content-Security-Policy", contentSecurityPolicy());
  }
  set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  set("X-Content-Type-Options", "nosniff");
  set("Referrer-Policy", "strict-origin-when-cross-origin");
  set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  set("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return withSecurityHeaders(await normalizeCatastrophicSsrResponse(response));
    } catch (error) {
      console.error(error);
      return withSecurityHeaders(
        new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      );
    }
  },
};
