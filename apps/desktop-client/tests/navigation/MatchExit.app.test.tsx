import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server.node";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RoomView } from "@riftbound/protocol";
import { AppView } from "../../src/app/AppView";
import { AppShell } from "../../src/navigation/AppShell";
import { MatchControls } from "../../src/settings/MatchControls";
import {
  createV2ChoiceUiState,
  createV2ClientState,
  type V2ClientState
} from "../../src/state/v2";
import type { V2Projection } from "../../../../../packages/protocol/src/v2/index.js";

// RIFT-1161: every in-match "返回首页" entry (shell bar, home page, the
// in-board settings panel) must go through the leave-means-concede
// confirmation; other navigation, such as the issue report, still switches.

const captured = vi.hoisted(() => ({
  elements: [] as Array<{ readonly type: unknown; readonly props: Record<string, unknown> }>
}));

vi.mock("react/jsx-dev-runtime", async importOriginal => {
  const actual = await importOriginal<typeof import("react/jsx-dev-runtime")>();
  const capture = (type: unknown, props: unknown, ...rest: unknown[]) => {
    if (props && typeof props === "object") captured.elements.push({ type, props: props as Record<string, unknown> });
    return (actual.jsxDEV as (...args: unknown[]) => unknown)(type, props, ...rest);
  };
  return { ...actual, jsxDEV: capture };
});

function projection(overrides: Partial<V2Projection> = {}): V2Projection {
  return {
    projectionContract: "riftbound.protocol.v2.projection",
    protocolVersion: "2.0.0",
    rulesetVersion: "core-1.5",
    matchId: "match-rift-1065",
    viewerPlayerId: "player-1",
    stateVersion: 9,
    eventSeq: 4,
    phase: "main",
    turnNumber: 2,
    activePlayerId: "player-1",
    players: [
      { playerId: "player-1", name: "Alice", score: 0, energy: 3, power: {}, xp: 0, handCount: 0, deckCount: 20, runeDeckCount: 10, zoneCounts: {} },
      { playerId: "player-2", name: "Bob", score: 0, energy: 1, power: {}, xp: 0, handCount: 0, deckCount: 20, runeDeckCount: 10, zoneCounts: {} }
    ],
    zones: [],
    objects: [],
    chain: { status: "closed", phase: "open", priorityPlayerId: null, focusPlayerId: null, items: [] },
    priority: { playerId: null, focusPlayerId: null, window: "open" },
    scoring: { victoryScore: 8, battlefieldLocationIds: [], players: [
      { playerId: "player-1", points: 0, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] },
      { playerId: "player-2", points: 0, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] }
    ] },
    battlefields: [],
    combat: { status: "none" },
    actionOptions: { canEndTurn: true, canAdvance: true, moves: [], plays: [] },
    pendingChoice: { status: "none" },
    winnerPlayerId: null,
    events: [],
    ...overrides
  };
}

function state(value: V2Projection | null = projection(), connectionStatus: V2ClientState["connectionStatus"] = "connected"): V2ClientState {
  return {
    ...createV2ClientState({ viewerPlayerId: value?.viewerPlayerId ?? null, now: 0, choiceTimeoutMs: 10_000 }),
    projection: value,
    stateVersion: value?.stateVersion ?? 0,
    eventSeq: value?.eventSeq ?? 0,
    connectionStatus,
    choice: createV2ChoiceUiState(value?.pendingChoice ?? { status: "none" }, {
      viewerPlayerId: value?.viewerPlayerId ?? null,
      now: 0,
      timeoutMs: 10_000
    })
  };
}

function room(status: RoomView["status"]): RoomView {
  return { roomId: "room-1161", status, rulesetId: "riftbound-duel", version: 1, roomVersion: 3, roomEventSeq: 0, players: [] };
}

function renderApp(activeTab: string, running: boolean) {
  captured.elements.length = 0;
  const setActiveTab = vi.fn();
  const sendCommand = vi.fn();
  const leaveRoom = vi.fn();
  const v2Match = {
    state: state(running ? projection() : projection({ phase: "ended", winnerPlayerId: "player-2" })),
    lastReceipt: null,
    room: room(running ? "playing" : "ended"),
    session: { roomId: "room-1161", playerId: "player-1", resumeToken: "resume" },
    pendingCommandIds: [],
    error: null,
    reconnectUrl: "",
    connectionStatus: "connected",
    connect: vi.fn(),
    createRoom: vi.fn(),
    joinRoom: vi.fn(),
    submitDeck: vi.fn(),
    setReady: vi.fn(),
    sendCommand,
    leaveRoom
  };
  const props = {
    status: "connected", handshakeReady: true, projection: null, duelProjection: null, roomView: null,
    roomId: null, session: null, activeTab, setActiveTab, v2UiEnabled: true, setV2UiEnabled: vi.fn(),
    profile: { name: "Alice", avatar: "leaf", bio: "" }, setProfile: vi.fn(), v2Match,
    catalogServerUrl: "http://127.0.0.1:35160", v2ServerUrl: "ws://127.0.0.1:35160/ws", setV2ServerUrl: vi.fn(),
    preferenceStorage: null, chatMessages: [], chatPending: false, chatError: null, sendChat: vi.fn(),
    displaySettings: { cardScale: "medium", reducedMotion: false, showCardNames: true, confirmConcede: true },
    changeDisplaySettings: vi.fn(), settingsError: null, replayNotice: null, saveCurrentReplay: vi.fn(),
    concedeAllowance: { enabled: false, reason: "" }, exitError: null
  };
  renderToStaticMarkup(createElement(AppView, props as never));
  const propsOf = (type: unknown) => {
    const element = captured.elements.find(entry => entry.type === type);
    if (!element) throw new Error("element was not rendered");
    return element.props;
  };
  return { setActiveTab, sendCommand, leaveRoom, propsOf };
}

beforeEach(() => {
  captured.elements.length = 0;
});

describe("RIFT-1161 in-match navigation goes through the concede confirmation", () => {
  it("does not switch home directly from the shell bar or the in-board settings panel during a running match", () => {
    const app = renderApp("game-table", true);
    (app.propsOf(AppShell).onNavigate as (page: string) => void)("home");
    (app.propsOf(MatchControls).onGoHome as () => void)();
    expect(app.setActiveTab).not.toHaveBeenCalledWith("home");
    // Nothing is conceded or left until the player confirms.
    expect(app.sendCommand).not.toHaveBeenCalled();
    expect(app.leaveRoom).not.toHaveBeenCalled();
  });

  it("still switches directly to the issue report and other pages during a running match", () => {
    const app = renderApp("game-table", true);
    (app.propsOf(MatchControls).onIssueReport as () => void)();
    (app.propsOf(AppShell).onNavigate as (page: string) => void)("settings");
    expect(app.setActiveTab).toHaveBeenCalledWith("issue-report");
    expect(app.setActiveTab).toHaveBeenCalledWith("settings");
  });

  it("goes home directly once the match has ended", () => {
    const app = renderApp("game-table", false);
    (app.propsOf(AppShell).onNavigate as (page: string) => void)("home");
    (app.propsOf(MatchControls).onGoHome as () => void)();
    expect(app.setActiveTab).toHaveBeenCalledTimes(2);
    expect(app.setActiveTab).toHaveBeenCalledWith("home");
  });
});
