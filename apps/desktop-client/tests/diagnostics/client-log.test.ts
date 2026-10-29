import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendClientLog,
  bindClientLogStorage,
  CLIENT_LOG_LIMIT,
  CLIENT_LOG_STORAGE_BYTES,
  CLIENT_LOG_STORAGE_KEY,
  getClientLog,
  initializeClientLog,
  readClientLog,
  resetClientLogForTests,
  trimClientLog
} from "../../src/diagnostics/client-log";
import { redactDiagnosticValue } from "../../src/diagnostics/redaction";
import { safeErrorMessage } from "../../src/diagnostics/redaction";
import { MemoryStorage } from "./fixtures";

beforeEach(() => resetClientLogForTests());

describe("client diagnostics ring buffer", () => {
  it("keeps the newest 2000 in memory and persists the same bounded set", () => {
    const storage = new MemoryStorage();
    initializeClientLog(storage);
    for (let index = 0; index < CLIENT_LOG_LIMIT + 7; index += 1) {
      appendClientLog({ level: "info", source: "test", message: String(index),
        at: new Date(index).toISOString() });
    }
    expect(getClientLog()).toHaveLength(CLIENT_LOG_LIMIT);
    expect(getClientLog()[0]?.message).toBe("7");
    expect(readClientLog(storage)).toEqual(getClientLog());
    expect(storage.getItem(CLIENT_LOG_STORAGE_KEY)).not.toBeNull();
  });

  it("evicts oldest entries until the serialized 512 KiB cap is met", () => {
    const entries = Array.from({ length: 400 }, (_, index) => ({
      at: "2026-10-29T00:00:00.000Z", level: "info" as const, source: "bulk",
      message: `${index}:${"x".repeat(2_000)}`
    }));
    const result = trimClientLog(entries);
    expect(result.length).toBeLessThan(entries.length);
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThanOrEqual(CLIENT_LOG_STORAGE_BYTES);
    expect(result.at(-1)?.message.startsWith("399:")).toBe(true);
  });

  it("survives malformed and throwing storage", () => {
    const malformed = new MemoryStorage();
    malformed.setItem(CLIENT_LOG_STORAGE_KEY, "{not-json");
    expect(readClientLog(malformed)).toEqual([]);
    expect(() => initializeClientLog({ getItem: () => { throw new Error("read"); },
      setItem: () => { throw new Error("write"); } })).not.toThrow();
    expect(() => appendClientLog({ level: "info", source: "test", message: "safe" })).not.toThrow();
    expect(getClientLog().some(entry => entry.source === "client-log-storage")).toBe(true);
  });

  it("rebinding the mounted app never replaces newer memory entries", () => {
    const storage = new MemoryStorage();
    initializeClientLog(storage);
    appendClientLog({ level: "info", source: "before-mount", message: "kept" });
    bindClientLogStorage(storage);
    bindClientLogStorage(storage);
    expect(getClientLog().map(entry => entry.message)).toEqual(["kept"]);
  });

  it("stops persistence for the session after the first setItem failure", () => {
    let writes = 0;
    const storage = {
      getItem: () => null,
      setItem: () => { writes += 1; throw new Error("quota exceeded"); }
    };
    initializeClientLog(storage);
    appendClientLog({ level: "error", source: "first", message: "one" });
    appendClientLog({ level: "error", source: "second", message: "two" });
    expect(writes).toBe(1);
    expect(getClientLog()).toHaveLength(3);
    expect(getClientLog().filter(entry => entry.source === "client-log-storage"))
      .toHaveLength(1);
  });

  it("truncates oversized structured data to the 8 KiB per-entry contract", () => {
    initializeClientLog(null);
    appendClientLog({ level: "info", source: "test", message: "large data",
      data: { text: "x".repeat(20_000) } });
    const entry = getClientLog().at(-1);
    expect(entry?.data).toMatchObject({ diagnosticDataTruncated: true });
    expect(new TextEncoder().encode(JSON.stringify(entry?.data)).byteLength).toBeLessThanOrEqual(8 * 1024);
  });
});

describe("diagnostic redaction", () => {
  it("redacts nested resumeToken and Authorization fields at any casing", () => {
    const input = {
      ResumeToken: "resume-secret",
      nested: { AUTHORIZATION: "Bearer secret", password: "pw", safe: "visible",
        clientAuthorizationId: "blocked" },
      list: [{ secretKey: "private" }]
    };
    const redacted = redactDiagnosticValue(input);
    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain("resume-secret");
    expect(serialized).not.toContain("Bearer secret");
    expect(serialized).not.toContain("private");
    expect(serialized).toContain("visible");
    expect(serialized.match(/\[redacted\]/gu)?.length).toBe(5);
  });

  it("redacts every sensitive key substring in free text while preserving safe fields", () => {
    initializeClientLog(null);
    appendClientLog({ level: "error", source: "window", message:
      'accessToken=ACCESS_SECRET&safe=1 apiToken: API_SECRET, done auth_token="SNAKE_SECRET" ' +
      'sessionSecret=value {"apiKey":"K"} Cookie: a=b' });
    const message = getClientLog().at(-1)?.message ?? "";
    for (const secret of ["ACCESS_SECRET", "API_SECRET", "SNAKE_SECRET", "sessionSecret=value", '"apiKey":"K"', "Cookie: a=b"]) {
      expect(message).not.toContain(secret);
    }
    expect(message).toContain("safe=1");
    expect(message).toContain("done");
    expect(message.match(/\[redacted\]/gu)?.length).toBe(6);
  });

  it("treats camel, snake and kebab sensitive key variants identically", () => {
    const message = safeErrorMessage(new Error(
      'apiKey=ONE api_key=TWO api-token=THREE sessionCookie=FOUR auth-password=FIVE'
    ));
    for (const secret of ["ONE", "TWO", "THREE", "FOUR", "FIVE"]) {
      expect(message).not.toContain(secret);
    }
    expect(message.match(/\[redacted\]/gu)).toHaveLength(5);
  });

  it("uses the same sensitive-key standard for match and kebab case", () => {
    const redacted = redactDiagnosticValue({
      APIKEY: "wrong-case-key",
      nested: { "session-cookie": "kebab-secret", safe: "visible" },
      text: "requestId=1 api_key=VALUE_KEEP"
    });
    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain("wrong-case-key");
    expect(serialized).not.toContain("kebab-secret");
    expect(serialized).not.toContain("VALUE_KEEP");
    expect(serialized).toContain("visible");
  });

  it("redacts before persistence", () => {
    const storage = new MemoryStorage();
    initializeClientLog(storage);
    appendClientLog({ level: "error", source: "v2-session", message: "rejected",
      data: { resumeToken: "resume-abc", headers: { Authorization: "Bearer abc" } } });
    const raw = storage.getItem(CLIENT_LOG_STORAGE_KEY) ?? "";
    expect(raw).not.toContain("resume-abc");
    expect(raw).not.toContain("Bearer abc");
    expect(raw).toContain("[redacted]");
  });

  it("redacts every reviewed value before appendClientLog returns", () => {
    initializeClientLog(null);
    const entry = appendClientLog({ level: "error", source: "window", message:
      'accessToken=ACCESS_SECRET&safe=1 apiToken: API_SECRET, done auth_token="SNAKE_SECRET" ' +
      'sessionSecret=value {"apiKey":"K"} Cookie: a=b' });
    for (const secret of ["ACCESS_SECRET", "API_SECRET", "SNAKE_SECRET"]) {
      expect(entry.message).not.toContain(secret);
    }
    expect(entry.message).not.toContain('"apiKey":"K"');
    expect(entry.message).not.toContain("Cookie: a=b");
    expect(entry.message).toContain("safe=1");
    expect(entry.message).toContain("done");
  });

  it("redacts the reviewed key forms before localStorage persistence", () => {
    const storage = new MemoryStorage();
    initializeClientLog(storage);
    appendClientLog({ level: "error", source: "window", message:
      'accessToken=ACCESS_SECRET&safe=1 apiToken: API_SECRET, done ' +
      'auth_token="SNAKE_SECRET" sessionSecret=value {"apiKey":"K"} Cookie: a=b' });
    const raw = storage.getItem(CLIENT_LOG_STORAGE_KEY) ?? "";
    for (const secret of ["ACCESS_SECRET", "API_SECRET", "SNAKE_SECRET"]) {
      expect(raw).not.toContain(secret);
    }
    expect(raw).not.toContain('"apiKey":"K"');
    expect(raw).not.toContain("Cookie: a=b");
    expect(raw).toContain("safe=1");
    expect(raw).toContain("done");
  });

  it("redacts credentials embedded in captured error text", () => {
    initializeClientLog(null);
    appendClientLog({ level: "error", source: "window",
      message: "request failed: Authorization: Bearer private resumeToken=abc123" });
    const message = getClientLog().at(-1)?.message ?? "";
    expect(message).not.toContain("Bearer private");
    expect(message).not.toContain("abc123");
    expect(message).toContain("[redacted]");
  });

  it("redacts the reviewed API and cookie keys through safeErrorMessage", () => {
    const message = safeErrorMessage(new Error(
      'accessToken=ACCESS_SECRET&safe=1 apiToken: API_SECRET, done ' +
      'auth_token="SNAKE_SECRET" sessionSecret=value {"apiKey":"K"} Cookie: a=b'
    ));
    for (const secret of ["ACCESS_SECRET", "API_SECRET", "SNAKE_SECRET"]) {
      expect(message).not.toContain(secret);
    }
    expect(message).not.toContain('"apiKey":"K"');
    expect(message).not.toContain("Cookie: a=b");
    expect(message).toContain("safe=1");
    expect(message).toContain("done");
  });

  it("redacts Authorization schemes and JSON credential assignments completely", () => {
    initializeClientLog(null);
    const authorization = safeErrorMessage(new Error("Authorization: Bearer TOPSECRET"));
    const json = '{"authorization":"Bearer JSONSECRET","resumeToken":"RESUMESECRET"}';
    appendClientLog({ level: "error", source: "window", message: json,
      data: { diagnostic: authorization } });
    const serialized = JSON.stringify(getClientLog());
    expect(authorization).toBe("Authorization: [redacted]");
    expect(serialized).not.toContain("TOPSECRET");
    expect(serialized).not.toContain("JSONSECRET");
    expect(serialized).not.toContain("RESUMESECRET");
    expect(serialized.match(/\[redacted\]/gu)?.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps redacting Authorization after a preceding JSON or scheme prefix", () => {
    initializeClientLog(null);
    appendClientLog({ level: "error", source: "window",
      message: 'payload={"authorization":"Bearer JSONSECRET2"}; flow Authorization: Basic BASICSECRET' });
    const serialized = JSON.stringify(getClientLog());
    expect(serialized).not.toContain("JSONSECRET2");
    expect(serialized).not.toContain("BASICSECRET");
    expect(serialized).toContain("[redacted]");
  });

  it("redacts Basic credentials and credential text before localStorage persistence", () => {
    const storage = new MemoryStorage();
    initializeClientLog(storage);
    appendClientLog({ level: "error", source: "window",
      message: '{Authorization: Basic STORAGESECRET, password="PASSWORDSECRET"}' });
    const raw = storage.getItem(CLIENT_LOG_STORAGE_KEY) ?? "";
    expect(raw).not.toContain("STORAGESECRET");
    expect(raw).not.toContain("PASSWORDSECRET");
    expect(raw).toContain("[redacted]");
  });

  it("redacts credentials embedded in structured strings and console data", () => {
    initializeClientLog(null);
    appendClientLog({ level: "warn", source: "console",
      message: "warn", data: { detail: "Authorization=Bearer hidden" } });
    const entry = getClientLog().at(-1);
    expect(JSON.stringify(entry)).not.toContain("Bearer hidden");
    expect(JSON.stringify(entry)).toContain("[redacted]");
  });
});
