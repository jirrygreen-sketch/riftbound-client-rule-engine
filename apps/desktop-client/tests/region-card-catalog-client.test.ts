import { describe, expect, it, vi } from "vitest";

// A minimal React hook runtime lets these tests drive the *real* useCardCatalog
// hook (effects, state, and callbacks) without a DOM test environment. The
// package has no jsdom/testing-library dependency and this task must not change
// dependencies or the lockfile, so the four hook primitives the hook uses are
// implemented directly and react is mocked to route them here.
const runtime = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }));

vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => (runtime.current!.useState as (v: unknown) => unknown)(initial),
    useRef: (initial: unknown) => (runtime.current!.useRef as (v: unknown) => unknown)(initial),
    useMemo: (factory: () => unknown, deps: readonly unknown[]) =>
      (runtime.current!.useMemo as (f: () => unknown, d: readonly unknown[]) => unknown)(factory, deps),
    useCallback: (callback: unknown, deps: readonly unknown[]) =>
      (runtime.current!.useCallback as (c: unknown, d: readonly unknown[]) => unknown)(callback, deps),
    useEffect: (effect: () => unknown, deps?: readonly unknown[]) =>
      (runtime.current!.useEffect as (e: () => unknown, d?: readonly unknown[]) => unknown)(effect, deps)
  };
});

import {
  CardCatalogClient,
  CardCatalogClientErrorImpl,
  constructedRegionQuery
} from "../src/net/CardCatalogClient";
import {
  useCardCatalog,
  type DeckByZone
} from "../src/hooks/useCardCatalog";

const catalog = {
  schemaVersion: 1,
  dataVersion: "2026-10-13",
  digest: "sha256:test-digest",
  cards: [
    {
      id: "flame-warden-standard",
      canonicalCardId: "flame-warden",
      name: "Flame Warden",
      fullName: "Flame Warden",
      cardType: "Unit",
      domains: ["fire"],
      tags: ["guard"],
      setCode: "OGN",
      cardNumber: "001",
      variant: "standard",
      imageUrl: null,
      energy: 2,
      power: 3,
      might: null,
      ability: "Guard."
    }
  ]
};

const validTrue = {
  valid: true,
  overflow: false,
  totalCards: 1,
  zoneCounts: { mainDeck: 1 },
  canonicalCardCounts: { "flame-warden": 1 },
  issues: [],
  printingIssues: []
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("CardCatalogClient constructed-region adapter", () => {
  it("keeps the legacy endpoints byte-stable and the query getter empty with no selection", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(catalog));
    const client = new CardCatalogClient({ fetchImpl });

    await client.loadCatalog("http://127.0.0.1:8787");

    expect(fetchImpl).toHaveBeenCalledWith("http://127.0.0.1:8787/api/cards", undefined);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // Getter with zero selection yields zero query bytes (no default region/date).
    expect(constructedRegionQuery()).toBe("");
    expect(constructedRegionQuery(undefined)).toBe("");
    expect(constructedRegionQuery(null)).toBe("");
  });

  it("keeps the deck validation body byte-stable with no selection", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(validTrue));
    const client = new CardCatalogClient({ fetchImpl });

    await client.validateDeck("http://127.0.0.1:8787", {
      mainDeck: [{ cardId: "flame-warden-standard", quantity: 1 }]
    });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8787/api/decks/validate");
    expect(init.method).toBe("POST");
    expect(JSON.stringify(JSON.parse(init.body as string))).toBe(JSON.stringify({
      deck: {
        mainDeck: [{ cardId: "flame-warden-standard", quantity: 1 }],
        runes: [],
        legend: [],
        champion: [],
        battlefields: [],
        sideboard: []
      }
    }));
  });

  it("encodes regionCode/eventDate through URLSearchParams for the catalog endpoint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(catalog));
    const client = new CardCatalogClient({ fetchImpl });

    await client.loadCatalog("127.0.0.1:8787", { regionCode: "CN", eventDate: "2026-10-14" });

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/api/cards?regionCode=CN&eventDate=2026-10-14",
      undefined
    );
    expect(constructedRegionQuery({ regionCode: "CN", eventDate: "2026-10-14" }))
      .toBe("?regionCode=CN&eventDate=2026-10-14");
  });

  it("appends the selection query to deck validation while leaving the body unchanged", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(validTrue));
    const client = new CardCatalogClient({ fetchImpl });

    const result = await client.validateDeck(
      "http://127.0.0.1:8787",
      { mainDeck: [{ cardId: "flame-warden-standard", quantity: 1 }] },
      { regionCode: "CN", eventDate: "2026-10-14" }
    );

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url)
      .toBe("http://127.0.0.1:8787/api/decks/validate?regionCode=CN&eventDate=2026-10-14");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/json" });
    expect(Object.keys(JSON.parse(init.body as string))).toEqual(["deck"]);
    expect(result.valid).toBe(true);
  });

  it("fails closed on an invalid provided selection without any fetch", async () => {
    const fetchImpl = vi.fn();
    const client = new CardCatalogClient({ fetchImpl });

    const lowerRegion = { regionCode: "cn", eventDate: "2026-10-14" };
    const badDate = { regionCode: "CN", eventDate: "2026-13-40" };
    const missingDate = { regionCode: "CN" };

    await expect(client.loadCatalog("http://127.0.0.1:8787", lowerRegion as never))
      .rejects.toMatchObject({ kind: "invalid-region" });
    await expect(client.loadCatalog("http://127.0.0.1:8787", badDate as never))
      .rejects.toMatchObject({ kind: "invalid-region" });
    await expect(client.loadCatalog("http://127.0.0.1:8787", missingDate as never))
      .rejects.toMatchObject({ kind: "invalid-region" });
    await expect(client.validateDeck("http://127.0.0.1:8787", {}, missingDate as never))
      .rejects.toMatchObject({ kind: "invalid-region" });

    expect(() => constructedRegionQuery(lowerRegion as never))
      .toThrow(CardCatalogClientErrorImpl);
    // No global fallback: an invalid selection never triggers a request.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("retains retry behavior on the constructed-region catalog request", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("server not ready"))
      .mockResolvedValueOnce(jsonResponse(catalog));
    const client = new CardCatalogClient({ fetchImpl, retryDelaysMs: [0] });

    const result = await client.loadCatalog("http://127.0.0.1:8787", {
      regionCode: "CN",
      eventDate: "2026-10-14"
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenLastCalledWith(
      "http://127.0.0.1:8787/api/cards?regionCode=CN&eventDate=2026-10-14",
      undefined
    );
    expect(result.cards).toHaveLength(1);
  });
});

interface HarnessOptions {
  readonly client: CardCatalogClient;
  readonly serverUrl: string;
  readonly constructedRegion?: { readonly regionCode: string; readonly eventDate: string };
  readonly retryToken?: number;
  readonly timeoutMs?: number;
}

function createHarness(initial: HarnessOptions) {
  const states: { value: unknown }[] = [];
  const refs: { current: unknown }[] = [];
  const memos: { deps: readonly unknown[] | undefined; value: unknown }[] = [];
  const effects: { deps: readonly unknown[] | undefined; cleanup?: () => void }[] = [];
  const scheduled: { index: number; run: () => void | (() => void) }[] = [];
  let cursor = 0;
  let renderNeeded = true;
  let currentOptions: HarnessOptions = initial;
  let result: ReturnType<typeof useCardCatalog> | undefined;

  const depsEqual = (left: readonly unknown[] | undefined, right: readonly unknown[] | undefined) => {
    if (left === undefined || right === undefined) return left === right;
    if (left.length !== right.length) return false;
    return left.every((value, index) => Object.is(value, right[index]));
  };

  const runtimeImpl = {
    useState(initialValue: unknown) {
      const index = cursor++;
      if (states[index] === undefined) {
        states[index] = {
          value: typeof initialValue === "function" ? (initialValue as () => unknown)() : initialValue
        };
      }
      const set = (updater: unknown) => {
        const slot = states[index]!;
        slot.value = typeof updater === "function"
          ? (updater as (previous: unknown) => unknown)(slot.value)
          : updater;
        renderNeeded = true;
      };
      return [states[index]!.value, set];
    },
    useRef(initialValue: unknown) {
      const index = cursor++;
      if (refs[index] === undefined) refs[index] = { current: initialValue };
      return refs[index];
    },
    useMemo(factory: () => unknown, deps: readonly unknown[]) {
      const index = cursor++;
      const slot = memos[index];
      if (slot === undefined || !depsEqual(slot.deps, deps)) {
        memos[index] = { deps, value: factory() };
      }
      return memos[index]!.value;
    },
    useCallback(callback: unknown, deps: readonly unknown[]) {
      const index = cursor++;
      const slot = memos[index];
      if (slot === undefined || !depsEqual(slot.deps, deps)) {
        memos[index] = { deps, value: callback };
      }
      return memos[index]!.value;
    },
    useEffect(effect: () => void | (() => void), deps?: readonly unknown[]) {
      const index = cursor++;
      const slot = effects[index];
      if (slot === undefined || deps === undefined || !depsEqual(slot.deps, deps)) {
        effects[index] = { deps, cleanup: slot?.cleanup };
        scheduled.push({ index, run: effect });
      }
    }
  };

  function renderOnce() {
    cursor = 0;
    scheduled.length = 0;
    runtime.current = runtimeImpl as unknown as Record<string, unknown>;
    result = useCardCatalog(currentOptions as never);
    for (const entry of scheduled) {
      const slot = effects[entry.index]!;
      slot.cleanup?.();
      const cleanup = entry.run();
      slot.cleanup = typeof cleanup === "function" ? cleanup : undefined;
    }
  }

  return {
    get result(): ReturnType<typeof useCardCatalog> {
      if (result === undefined) throw new Error("harness rendered before first flush");
      return result;
    },
    async flush() {
      for (let pass = 0; pass < 40; pass++) {
        await Promise.resolve();
        let guard = 0;
        while (renderNeeded && guard++ < 100) {
          renderNeeded = false;
          renderOnce();
        }
      }
    },
    rerender(options: HarnessOptions) {
      currentOptions = options;
      renderNeeded = true;
    },
    destroy() {
      for (const slot of effects) {
        slot?.cleanup?.();
        if (slot) slot.cleanup = undefined;
      }
      runtime.current = null;
    }
  };
}

function catalogWithDeck(): DeckByZone {
  return {
    mainDeck: { "flame-warden-standard": 1 },
    runes: {},
    legend: {},
    champion: {},
    battlefields: {},
    sideboard: {}
  };
}

describe("useCardCatalog constructed-region wiring", () => {
  it("forwards the selection to the catalog request and refreshes on scalar change", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL) => {
      calls.push(String(input));
      return jsonResponse(catalog);
    });
    const client = new CardCatalogClient({ fetchImpl });
    const harness = createHarness({
      client,
      serverUrl: "http://127.0.0.1:8787",
      constructedRegion: { regionCode: "CN", eventDate: "2026-10-14" },
      timeoutMs: 60_000
    });

    await harness.flush();
    expect(harness.result.catalogStatus).toBe("ready");
    expect(calls).toEqual([
      "http://127.0.0.1:8787/api/cards?regionCode=CN&eventDate=2026-10-14"
    ]);

    // A fresh object with identical scalars must NOT trigger a refetch loop.
    harness.rerender({
      client,
      serverUrl: "http://127.0.0.1:8787",
      constructedRegion: { regionCode: "CN", eventDate: "2026-10-14" },
      timeoutMs: 60_000
    });
    await harness.flush();
    expect(calls).toHaveLength(1);

    // A real scalar change refetches with the new selection.
    harness.rerender({
      client,
      serverUrl: "http://127.0.0.1:8787",
      constructedRegion: { regionCode: "ROW", eventDate: "2026-11-01" },
      timeoutMs: 60_000
    });
    await harness.flush();
    expect(calls).toEqual([
      "http://127.0.0.1:8787/api/cards?regionCode=CN&eventDate=2026-10-14",
      "http://127.0.0.1:8787/api/cards?regionCode=ROW&eventDate=2026-11-01"
    ]);

    harness.destroy();
  });

  it("uses the legacy endpoint byte-for-byte when no selection is provided", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL) => {
      calls.push(String(input));
      return jsonResponse(catalog);
    });
    const client = new CardCatalogClient({ fetchImpl });
    const harness = createHarness({
      client,
      serverUrl: "http://127.0.0.1:8787",
      timeoutMs: 60_000
    });

    await harness.flush();

    expect(calls).toEqual(["http://127.0.0.1:8787/api/cards"]);
    harness.destroy();
  });

  it("surfaces an invalid provided selection as a catalog client error", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(catalog));
    const client = new CardCatalogClient({ fetchImpl });
    const harness = createHarness({
      client,
      serverUrl: "http://127.0.0.1:8787",
      constructedRegion: { regionCode: "cn", eventDate: "2026-10-14" },
      timeoutMs: 60_000
    });

    await harness.flush();

    expect(harness.result.catalogStatus).toBe("error");
    expect(harness.result.catalogError).toContain("赛事地区");
    expect(fetchImpl).not.toHaveBeenCalled();
    harness.destroy();
  });

  it("binds the validation body request to the current region/date", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      if (String(input).includes("/api/cards")) return jsonResponse(catalog);
      calls.push({
        url: String(input),
        body: init?.body ? JSON.parse(init.body as string) : null
      });
      return jsonResponse(validTrue);
    });
    const client = new CardCatalogClient({ fetchImpl });
    const harness = createHarness({
      client,
      serverUrl: "http://127.0.0.1:8787",
      constructedRegion: { regionCode: "CN", eventDate: "2026-10-14" },
      timeoutMs: 60_000
    });

    await harness.flush();
    harness.result.setDeckFromSnapshot(catalogWithDeck());
    await harness.flush();
    await harness.result.validateDeck();
    await harness.flush();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url)
      .toBe("http://127.0.0.1:8787/api/decks/validate?regionCode=CN&eventDate=2026-10-14");
    expect(calls[0]!.body).toEqual({
      deck: {
        mainDeck: [{ cardId: "flame-warden-standard", quantity: 1 }],
        runes: [],
        legend: [],
        champion: [],
        battlefields: [],
        sideboard: []
      }
    });
    expect(harness.result.validation?.valid).toBe(true);
    harness.destroy();
  });

  it("cannot show a stale valid:true after the region/date changes mid-flight", async () => {
    let resolveValidation: ((response: Response) => void) | undefined;
    const fetchImpl = vi.fn((input: string | URL, init?: RequestInit) => {
      if (String(input).includes("/api/cards")) {
        return Promise.resolve(jsonResponse(catalog));
      }
      void init;
      return new Promise<Response>(resolve => {
        resolveValidation = resolve;
      });
    });
    const client = new CardCatalogClient({ fetchImpl });
    const harness = createHarness({
      client,
      serverUrl: "http://127.0.0.1:8787",
      constructedRegion: { regionCode: "CN", eventDate: "2026-10-14" },
      timeoutMs: 60_000
    });

    await harness.flush();
    harness.result.setDeckFromSnapshot(catalogWithDeck());
    await harness.flush();

    const pending = harness.result.validateDeck();
    await harness.flush();
    expect(harness.result.validationStatus).toBe("pending");

    // The event re-scopes to a new region while the verdict is still in flight.
    harness.rerender({
      client,
      serverUrl: "http://127.0.0.1:8787",
      constructedRegion: { regionCode: "ROW", eventDate: "2026-10-14" },
      timeoutMs: 60_000
    });
    await harness.flush();

    // The late-arriving valid:true belongs to the old region and must be dropped.
    resolveValidation!(jsonResponse(validTrue));
    await pending;
    await harness.flush();

    expect(harness.result.validation).toBeNull();
    expect(harness.result.validationStatus).toBe("idle");
    expect(harness.result.validationError).toBeNull();
    harness.destroy();
  });

  it("cannot show a stale valid:true after the event date changes mid-flight", async () => {
    let resolveValidation: ((response: Response) => void) | undefined;
    const fetchImpl = vi.fn((input: string | URL) => {
      if (String(input).includes("/api/cards")) {
        return Promise.resolve(jsonResponse(catalog));
      }
      return new Promise<Response>(resolve => {
        resolveValidation = resolve;
      });
    });
    const client = new CardCatalogClient({ fetchImpl });
    const harness = createHarness({
      client,
      serverUrl: "http://127.0.0.1:8787",
      constructedRegion: { regionCode: "CN", eventDate: "2026-10-14" },
      timeoutMs: 60_000
    });

    await harness.flush();
    harness.result.setDeckFromSnapshot(catalogWithDeck());
    await harness.flush();

    const pending = harness.result.validateDeck();
    await harness.flush();

    harness.rerender({
      client,
      serverUrl: "http://127.0.0.1:8787",
      constructedRegion: { regionCode: "CN", eventDate: "2026-10-20" },
      timeoutMs: 60_000
    });
    await harness.flush();

    resolveValidation!(jsonResponse(validTrue));
    await pending;
    await harness.flush();

    expect(harness.result.validation).toBeNull();
    expect(harness.result.validationStatus).toBe("idle");
    harness.destroy();
  });

  it("accepts a same-region verdict while the selection object identity changes", async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      if (String(input).includes("/api/cards")) return jsonResponse(catalog);
      return jsonResponse(validTrue);
    });
    const client = new CardCatalogClient({ fetchImpl });
    const harness = createHarness({
      client,
      serverUrl: "http://127.0.0.1:8787",
      constructedRegion: { regionCode: "CN", eventDate: "2026-10-14" },
      timeoutMs: 60_000
    });

    await harness.flush();
    harness.result.setDeckFromSnapshot(catalogWithDeck());
    await harness.flush();

    // Re-render with a fresh object but the same region/date before validating.
    harness.rerender({
      client,
      serverUrl: "http://127.0.0.1:8787",
      constructedRegion: { regionCode: "CN", eventDate: "2026-10-14" },
      timeoutMs: 60_000
    });
    await harness.flush();

    await harness.result.validateDeck();
    await harness.flush();

    expect(harness.result.validation?.valid).toBe(true);
    expect(harness.result.validationStatus).toBe("done");
    harness.destroy();
  });
});
