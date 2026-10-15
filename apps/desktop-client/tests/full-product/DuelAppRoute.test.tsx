import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server.node";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuelProjection } from "@riftbound/protocol";

// SSR starts on the home page. Substitute only the initial route state
// to render the actual App table branch without a browser or a synthetic match.
vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: ((initial: unknown) =>
      actual.useState(initial === "home" ? "game-table" : initial)) as typeof actual.useState
  };
});

let snapshot: DuelProjection | null = null;
let connection: "connected" | "reconnecting" = "connected";
let commandError: string | null = null;
vi.mock("../../src/hooks/useGameClient", () => ({
  readStoredSession: () => null,
  useGameClient: () => ({
    status: connection, handshakeReady: connection === "connected",
    commandPending: false, requestPending: false,
    projection: null, duelProjection: snapshot, lastError: commandError, errorRevision: 0,
    roomId: "room-1", roomView: null, gameEvents: [], roomEvents: [],
    session: { roomId: "room-1", playerId: "p1", resumeToken: "private" },
    storedSession: null, activeServerUrl: "ws://127.0.0.1:8787/ws",
    connect() {}, createRoom() {}, joinRoom() {}, submitDeck() { return null; },
    setReady() { return null; }, roomRequestReceipt: null,
    roomRequestFailure: null, syncEvents() {}, pass() {}, playCard() {},
    submitPlayerCommand() {}, submitDuelCommand() {}, concede() {},
    respondPrompt() {}, clearError() {}
  })
}));
vi.mock("../../src/hooks/useCardCatalog", async importOriginal => {
  const actual = await importOriginal<typeof import("../../src/hooks/useCardCatalog")>();
  return {
    ...actual,
    useCardCatalog: () => ({
      catalog: { schemaVersion: 1, dataVersion: "data-1", digest: "digest-1", cards: [{
        id: "card.0.1", canonicalCardId: "card.0.1", name: "真实馆藏名称",
        fullName: "真实馆藏名称", cardType: "unit", domains: [], tags: [],
        setCode: "T", cardNumber: "01", variant: "standard",
        imageUrl: "https://images.example/card-1.png", energy: 1, power: 0,
        might: 1, ability: ""
      }] },
      catalogStatus: "ready", catalogError: null, deck: actual.emptyDeckByZone(),
      setZoneFromEntries() {}, setDeckFromSnapshot() {}, validation: null,
      validationStatus: "idle", validationError: null,
      validateDeck: async () => {}, retryCatalog() {}
    })
  };
});

import { App } from "../../src/App";
const fixtures = JSON.parse(readFileSync(fileURLToPath(new URL(
  "../../../../packages/protocol/test/fixtures/duel-projections.json", import.meta.url
)), "utf8")) as Record<string, Record<string, DuelProjection>>;
afterEach(() => { snapshot = null; connection = "connected"; commandError = null; });

describe("App authenticated Duel route", () => {
  it("shows a rejected command on the active Duel table with a dismiss control", () => {
    snapshot = fixtures.changed?.p1 ?? null;
    commandError = "单位出牌未通过规则校验";
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain('aria-label="对局操作提示"');
    expect(html).toContain(commandError);
    expect(html).toContain('aria-label="关闭对局提示"');
  });

  it("renders the formal board from a real setup DTO with the catalog title and not Foundation controls", () => {
    snapshot = fixtures.setup?.p1 ?? null;
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain("调度阶段");
    expect(html).toContain("真实馆藏名称");
    // The live Duel must show the images the *current* authoritative server
    // serves: the active `ws://127.0.0.1:8787` connection resolves to the same
    // host's local `/api/card-images` route, which is preferred over the
    // catalog's external `imageUrl` fallback.
    expect(html).toContain("http://127.0.0.1:8787/api/card-images/card.0.1");
    expect(html).not.toContain("https://images.example/card-1.png");
    expect(html).not.toContain("未选择手牌");
    expect(html).not.toContain("我的区域");
  });

  it("renders the real server phase and pool, read-only after disconnection", () => {
    snapshot = fixtures.changed?.p1 ?? null;
    connection = "reconnecting";
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain("正在重连，界面只读");
    expect(html).toContain("第 1 回合");
    expect(html).toContain("行动：Player 1");
    expect(html).toContain("1（就绪 1／横置 0）");
    expect(html).not.toContain('class="stg-button stg-button-danger"');
    expect(html).not.toContain('aria-label="认输"');
    expect(html).not.toContain('>认输</button>');
  });

  it("does not fabricate a Duel board without an accepted Duel DTO", () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).not.toContain("调度阶段");
    expect(html).not.toContain("真实馆藏名称");
  });
});
