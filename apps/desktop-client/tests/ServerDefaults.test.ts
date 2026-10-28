import { describe, expect, it } from "vitest";
import {
  DEFAULT_HTTP_SERVER_URL,
  DEFAULT_WS_SERVER_URL,
  LOCAL_SERVER_URL,
  RELEASE_SERVER_URL,
  isLocalHostname,
  resolveDefaultServerOrigin,
  toHttpOrigin,
  toWebSocketOrigin
} from "../src/net/server-defaults";
import { DEFAULT_CARD_SERVER_URL } from "../src/net/CardCatalogClient";
import { DEFAULT_CONNECTION_SERVER_URL } from "../src/components/ConnectionPanel";

const page = (href: string) => {
  const url = new URL(href);
  return { protocol: url.protocol, hostname: url.hostname, origin: url.origin };
};

describe("default server address", () => {
  it("keeps the local development server outside production builds", () => {
    expect(resolveDefaultServerOrigin({ location: null, production: false })).toBe(LOCAL_SERVER_URL);
    expect(resolveDefaultServerOrigin({ location: page("http://127.0.0.1:5173/"), production: false })).toBe(LOCAL_SERVER_URL);
  });

  it("uses the hosted beta server in production builds when the page is local", () => {
    expect(RELEASE_SERVER_URL).toBe("https://rift-beta.xjerryx.com");
    expect(resolveDefaultServerOrigin({ location: null, production: true })).toBe(RELEASE_SERVER_URL);
    // Tauri serves the bundled UI from tauri://localhost (macOS) or http://tauri.localhost (Windows).
    expect(resolveDefaultServerOrigin({ location: page("tauri://localhost/"), production: true })).toBe(RELEASE_SERVER_URL);
    expect(resolveDefaultServerOrigin({ location: page("http://tauri.localhost/"), production: true })).toBe(RELEASE_SERVER_URL);
  });

  it("lets a hosted web client talk to the server that served it", () => {
    expect(resolveDefaultServerOrigin({ location: page("https://rift-beta.xjerryx.com/play/"), production: true }))
      .toBe("https://rift-beta.xjerryx.com");
    expect(resolveDefaultServerOrigin({ location: page("https://example.test:8443/play/"), production: false }))
      .toBe("https://example.test:8443");
  });

  it("applies a valid build-time override and ignores an invalid one", () => {
    expect(resolveDefaultServerOrigin({ location: null, configuredUrl: "https://other.example/ws", production: true }))
      .toBe("https://other.example");
    expect(resolveDefaultServerOrigin({ location: null, configuredUrl: "ws://bad.example", production: true }))
      .toBe(RELEASE_SERVER_URL);
    expect(resolveDefaultServerOrigin({ location: null, configuredUrl: "  ", production: false }))
      .toBe(LOCAL_SERVER_URL);
  });

  it("classifies local hostnames and converts origins to WebSocket form", () => {
    for (const host of ["localhost", "tauri.localhost", "127.0.0.1", "0.0.0.0", "[::1]"]) {
      expect(isLocalHostname(host)).toBe(true);
    }
    expect(isLocalHostname("rift-beta.xjerryx.com")).toBe(false);
    expect(toHttpOrigin("https://rift-beta.xjerryx.com/path?x=1")).toBe("https://rift-beta.xjerryx.com");
    expect(toWebSocketOrigin("https://rift-beta.xjerryx.com")).toBe("wss://rift-beta.xjerryx.com");
    expect(toWebSocketOrigin("http://127.0.0.1:8787")).toBe("ws://127.0.0.1:8787");
  });

  it("exposes the local defaults to the client under test", () => {
    expect(DEFAULT_HTTP_SERVER_URL).toBe(LOCAL_SERVER_URL);
    expect(DEFAULT_WS_SERVER_URL).toBe("ws://127.0.0.1:8787");
    expect(DEFAULT_CARD_SERVER_URL).toBe("http://127.0.0.1:8787");
    expect(DEFAULT_CONNECTION_SERVER_URL).toBe("ws://127.0.0.1:8787");
  });
});
