/**
 * Single source of the client's default game-server address.
 *
 * Resolution order:
 * 1. A page served from a non-local http(s) origin (the hosted web client)
 *    talks to the server that served it.
 * 2. `VITE_RIFTBOUND_SERVER_URL`, when set at build time, overrides the
 *    release default.
 * 3. Production builds (`vite build` / `tauri build`) use the hosted beta
 *    server.
 * 4. Everything else — `vite dev`, `tauri dev`, tests — keeps the local
 *    development server.
 *
 * Users can still type any address into the connection fields; this only
 * decides what those fields start with.
 */

export const LOCAL_SERVER_URL = "http://127.0.0.1:8787";
export const RELEASE_SERVER_URL = "https://rift-beta.xjerryx.com";

export interface ServerDefaultsInput {
  /** `window.location` of the running page, or null outside a browser. */
  readonly location: Pick<Location, "protocol" | "hostname" | "origin"> | null;
  /** Build-time override (`VITE_RIFTBOUND_SERVER_URL`). */
  readonly configuredUrl?: string | undefined;
  /** True for production builds. */
  readonly production: boolean;
}

export function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1";
}

/** Normalises an http(s) URL to its origin; anything else yields null. */
export function toHttpOrigin(input: string | undefined): string | null {
  if (!input || !input.trim()) return null;
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname) return null;
  return url.origin;
}

/** Resolves the default server as an http(s) origin without a trailing slash. */
export function resolveDefaultServerOrigin(input: ServerDefaultsInput): string {
  const page = input.location;
  if (page && (page.protocol === "http:" || page.protocol === "https:") && !isLocalHostname(page.hostname)) {
    return page.origin;
  }
  const configured = toHttpOrigin(input.configuredUrl);
  if (configured) return configured;
  return input.production ? RELEASE_SERVER_URL : LOCAL_SERVER_URL;
}

/** The WebSocket form of an http(s) origin: http → ws, https → wss. */
export function toWebSocketOrigin(httpOrigin: string): string {
  return httpOrigin.replace(/^http(s?):/u, "ws$1:");
}

export const DEFAULT_SERVER_ORIGIN = resolveDefaultServerOrigin({
  location: typeof window === "undefined" ? null : window.location,
  configuredUrl: import.meta.env.VITE_RIFTBOUND_SERVER_URL,
  production: import.meta.env.PROD
});

/** Default card catalog / HTTP API base, e.g. `https://rift-beta.xjerryx.com`. */
export const DEFAULT_HTTP_SERVER_URL = DEFAULT_SERVER_ORIGIN;

/** Default WebSocket server base without the `/ws` path, e.g. `wss://rift-beta.xjerryx.com`. */
export const DEFAULT_WS_SERVER_URL = toWebSocketOrigin(DEFAULT_SERVER_ORIGIN);
