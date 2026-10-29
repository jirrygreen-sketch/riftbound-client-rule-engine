import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getClientLog,
  installClientLogCapture
} from "../../src/diagnostics/client-log";
import { MemoryStorage } from "./fixtures";

class FakeWindow {
  readonly listeners = new Map<string, (event: unknown) => void>();
  addEventListener(name: string, listener: (event: unknown) => void): void {
    this.listeners.set(name, listener);
  }
  removeEventListener(name: string): void { this.listeners.delete(name); }
  dispatch(name: string, event: unknown): void { this.listeners.get(name)?.(event); }
}

let cleanup: (() => void) | null = null;
afterEach(() => { cleanup?.(); cleanup = null; });

describe("global client log capture", () => {
  it("captures window errors and unhandled rejections with credential redaction", () => {
    const fakeWindow = new FakeWindow();
    cleanup = installClientLogCapture(fakeWindow as unknown as Window, new MemoryStorage());
    fakeWindow.dispatch("error", { target: fakeWindow, message: "bad resumeToken=abc", error: null });
    fakeWindow.dispatch("unhandledrejection", { reason: new Error("Authorization: Bearer token") });
    expect(getClientLog()).toHaveLength(2);
    expect(getClientLog()[0]).toMatchObject({ source: "window", level: "error" });
    expect(JSON.stringify(getClientLog())).not.toContain("abc");
    expect(JSON.stringify(getClientLog())).not.toContain("Bearer token");
  });

  it("ignores resource errors and forwards console.warn/error to the original functions", () => {
    const fakeWindow = new FakeWindow();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    cleanup = installClientLogCapture(fakeWindow as unknown as Window, new MemoryStorage());
    const resourceError = new Event("error");
    Object.defineProperty(resourceError, "target", { value: {} });
    fakeWindow.dispatch("error", resourceError);
    console.warn("careful");
    console.error("failed");
    expect(getClientLog().map(entry => entry.source)).toEqual(["console", "console"]);
    expect(warn).toHaveBeenCalledWith("careful");
    expect(error).toHaveBeenCalledWith("failed");
    warn.mockRestore();
    error.mockRestore();
  });

  it("does not recurse when persistence throws and the host reports that error", () => {
    const fakeWindow = new FakeWindow();
    let writes = 0;
    let throwOnWrite = true;
    const storage = {
      getItem: () => null,
      setItem: () => {
        writes += 1;
        if (throwOnWrite) {
          throwOnWrite = false;
          const storageError = new Error("quota exceeded: resumeToken=secret");
          queueMicrotask(() => fakeWindow.dispatch("error", {
            target: fakeWindow, error: storageError, message: storageError.message
          }));
          throw storageError;
        }
      }
    };
    cleanup = installClientLogCapture(fakeWindow as unknown as Window, storage);
    expect(() => fakeWindow.dispatch("error", {
      target: fakeWindow, error: new Error("initial error"), message: "initial error"
    })).not.toThrow();
    return Promise.resolve().then(() => {
      expect(writes).toBe(1);
      expect(getClientLog().some(entry => entry.source === "client-log-storage"))
        .toBe(true);
      expect(getClientLog().length).toBeLessThan(4);
      expect(JSON.stringify(getClientLog())).not.toContain("secret");
    });
  });

});
