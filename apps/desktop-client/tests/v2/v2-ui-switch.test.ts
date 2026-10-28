import { describe, expect, it } from "vitest";
import { readV2UiEnabled, writeV2UiEnabled } from "../../src/full-product/v2-ui-switch";

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe("protocol v2 UI switch", () => {
  it("defaults to the v2 route (RIFT-1125) and persists an explicit opt-out and opt-in", () => {
    const storage = new MemoryStorage();
    expect(readV2UiEnabled(storage)).toBe(true);
    expect(readV2UiEnabled(null)).toBe(true);
    expect(writeV2UiEnabled(storage, false)).toBe(true);
    expect(readV2UiEnabled(storage)).toBe(false);
    expect(writeV2UiEnabled(storage, true)).toBe(true);
    expect(readV2UiEnabled(storage)).toBe(true);
  });
});
