import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server.node";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RoomView } from "@riftbound/protocol";
import { AppView } from "../../src/app/AppView";
import { readPlayerProfile, type PlayerProfile } from "../../src/profile/player-profile";
import {
  V2MatchBoard,
  type V2MatchBoardProps
} from "../../src/full-product/v2/V2MatchBoard";
import {
  createV2ChoiceUiState,
  createV2ClientState,
  type V2ClientState
} from "../../src/state/v2";
import type { V2Projection } from "../../../../../packages/protocol/src/v2/index.js";

const captured = vi.hoisted(() => ({
  elements: [] as Array<{ readonly type: unknown; readonly props: Record<string, unknown> }>,
  handlers: [] as Array<{ readonly props: Record<string, unknown> }>
}));

vi.mock("react/jsx-dev-runtime", async importOriginal => {
  const actual = await importOriginal<typeof import("react/jsx-dev-runtime")>();
  const capture = (type: unknown, props: unknown, ...rest: unknown[]) => {
    if (props && typeof props === "object") {
      const record = props as Record<string, unknown>;
      captured.elements.push({ type, props: record });
      if (typeof record.onClick === "function" || typeof record.onChange === "function" || typeof record.onSubmit === "function") {
        captured.handlers.push({ props: record });
      }
    }
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

function commandReceipt() {
  return {
    type: "command-receipt" as const,
    protocolVersion: "2.0.0" as const,
    commandId: "rift-1065",
    stateVersion: 9,
    eventSeq: 4,
    accepted: true,
    duplicate: false,
    rejection: null
  };
}

function renderBoard(options: {
  readonly value?: V2ClientState;
  readonly onCommand?: V2MatchBoardProps["onCommand"];
  readonly playerName?: string;
  readonly onCreateRoom?: V2MatchBoardProps["onCreateRoom"];
  readonly onJoinRoom?: V2MatchBoardProps["onJoinRoom"];
  readonly initialConcedeConfirmationOpen?: boolean;
} = {}): string {
  captured.elements.length = 0;
  captured.handlers.length = 0;
  return renderToStaticMarkup(
    <V2MatchBoard
      state={options.value ?? state()}
      playerName={options.playerName ?? "玩家"}
      onCreateRoom={options.onCreateRoom}
      onJoinRoom={options.onJoinRoom}
      initialConcedeConfirmationOpen={options.initialConcedeConfirmationOpen}
      onCommand={options.onCommand ?? (async () => commandReceipt())}
    />
  );
}

function buttonHandler(label: string): () => void {
  const button = captured.handlers.find(entry => {
    const children = entry.props.children;
    return entry.props.type === "button" &&
      (Array.isArray(children) ? children.includes(label) : children === label);
  });
  if (!button || typeof button.props.onClick !== "function") {
    throw new Error(`button handler not found: ${label}`);
  }
  return button.props.onClick as () => void;
}

function buttonTag(markup: string, label: string): string {
  const index = markup.indexOf(label);
  if (index < 0) throw new Error(`button label not found: ${label}`);
  const start = markup.lastIndexOf("<button", index);
  return markup.slice(start, markup.indexOf(">", start) + 1);
}

const waitingRoom: RoomView = {
  roomId: "room-1065",
  status: "waiting",
  rulesetId: "riftbound-duel",
  version: 1,
  roomVersion: 1,
  roomEventSeq: 0,
  players: []
};

function renderV2App(setProfile: (update: unknown) => void, v2MatchOverrides: Record<string, unknown> = {},
  preferenceStorage: Storage | null = null,
  profile: PlayerProfile = { name: "", avatar: "leaf", bio: "保留简介" }): string {
  captured.elements.length = 0;
  captured.handlers.length = 0;
  const v2Match = {
    state: state(null),
    lastReceipt: null,
    room: null,
    session: null,
    pendingCommandIds: [],
    error: null,
    reconnectUrl: "",
    connectionStatus: "connected",
    connect: vi.fn(),
    createRoom: vi.fn(async () => waitingRoom),
    joinRoom: vi.fn(async () => waitingRoom),
    submitDeck: vi.fn(async () => waitingRoom),
    setReady: vi.fn(async () => waitingRoom),
    sendCommand: vi.fn(async () => commandReceipt()),
    leaveRoom: vi.fn(),
    ...v2MatchOverrides
  };
  const props = {
    status: "connected",
    handshakeReady: true,
    projection: null,
    duelProjection: null,
    roomView: null,
    roomId: null,
    session: null,
    activeTab: "room",
    setActiveTab: vi.fn(),
    v2UiEnabled: true,
    setV2UiEnabled: vi.fn(),
    profile,
    setProfile,
    v2Match,
    catalogServerUrl: "http://127.0.0.1:35160",
    v2ServerUrl: "ws://127.0.0.1:35160/ws",
    setV2ServerUrl: vi.fn(),
    preferenceStorage,
    chatMessages: [],
    chatPending: false,
    chatError: null,
    sendChat: vi.fn(),
    displaySettings: { cardScale: "medium", reducedMotion: false, showCardNames: true, confirmConcede: true },
    changeDisplaySettings: vi.fn(),
    settingsError: null,
    replayNotice: null,
    saveCurrentReplay: vi.fn(),
    concedeAllowance: { enabled: false, reason: "" },
    exitError: null
  };
  return renderToStaticMarkup(createElement(AppView, props as never));
}

function appBoardProps(): V2MatchBoardProps {
  const element = captured.elements.find(entry => entry.type === V2MatchBoard);
  if (!element) throw new Error("AppView did not render V2MatchBoard");
  return element.props as unknown as V2MatchBoardProps;
}

beforeEach(() => {
  captured.elements.length = 0;
  captured.handlers.length = 0;
});

describe("RIFT-1065 V2 concede confirmation", () => {
  it("does not submit from the first click and renders the in-board confirmation", () => {
    const onCommand = vi.fn(async () => commandReceipt());
    const initial = renderBoard({ onCommand });
    expect(initial).toContain(">认输</button>");
    expect(initial).not.toContain('aria-label="认输确认"');

    buttonHandler("认输")();
    expect(onCommand).not.toHaveBeenCalled();

    const confirming = renderBoard({ onCommand, initialConcedeConfirmationOpen: true });
    expect(confirming).toContain('aria-label="认输确认"');
    expect(confirming).toContain("确认认输？");
    expect(confirming).toContain(">确认认输</button>");
    expect(confirming).toContain(">取消</button>");
  });

  it("submits concede once only after the explicit confirmation", () => {
    const onCommand = vi.fn(async () => commandReceipt());
    renderBoard({ onCommand, initialConcedeConfirmationOpen: true });
    buttonHandler("确认认输")();
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand).toHaveBeenCalledWith({ type: "concede" });
  });

  it("cancels without submitting and hides the action after the match ends", () => {
    const onCommand = vi.fn(async () => commandReceipt());
    renderBoard({ onCommand, initialConcedeConfirmationOpen: true });
    buttonHandler("取消")();
    expect(onCommand).not.toHaveBeenCalled();

    const ended = renderBoard({
      value: state(projection({ phase: "ended", winnerPlayerId: "player-1" })),
      initialConcedeConfirmationOpen: true
    });
    expect(ended).toContain('aria-label="对局结果"');
    expect(ended).not.toContain('aria-label="认输确认"');
    expect(ended).not.toContain("确认认输？");
    expect(ended).not.toContain(">认输</button>");
  });
});

describe("RIFT-1065 V2 seat-name persistence seam", () => {
  it("disables create and join while the AppView profile name is empty", () => {
    const markup = renderV2App(vi.fn());
    expect(markup).toMatch(/玩家名 <input[^>]*value=""/u);
    expect(buttonTag(markup, "创建 1v1 房间")).toContain("disabled=\"\"");
    expect(buttonTag(markup, "加入房间")).toContain("disabled=\"\"");
  });

  it("writes the successful create/join name back through AppView setProfile and keeps the rest of the profile", async () => {
    const setProfile = vi.fn();
    const createRoom = vi.fn(async () => waitingRoom);
    const joinRoom = vi.fn(async () => waitingRoom);
    renderV2App(setProfile, { createRoom, joinRoom });
    const board = appBoardProps();
    if (!board.onCreateRoom || !board.onJoinRoom) throw new Error("room actions missing");

    await board.onCreateRoom(" Alice ");
    expect(createRoom).toHaveBeenCalledWith(" Alice ");
    const createUpdate = setProfile.mock.calls[0]?.[0] as
      ((current: { name: string; avatar: string; bio: string }) => { name: string; avatar: string; bio: string }) | undefined;
    expect(createUpdate?.({ name: "玩家", avatar: "star", bio: "保留简介" })).toEqual({
      name: "Alice",
      avatar: "star",
      bio: "保留简介"
    });

    await board.onJoinRoom("room-1065", " Bob ");
    expect(joinRoom).toHaveBeenCalledWith("room-1065", " Bob ");
    const joinUpdate = setProfile.mock.calls[1]?.[0] as
      ((current: { name: string; avatar: string; bio: string }) => { name: string; avatar: string; bio: string }) | undefined;
    expect(joinUpdate?.({ name: "Alice", avatar: "leaf", bio: "保留简介" })).toEqual({
      name: "Bob",
      avatar: "leaf",
      bio: "保留简介"
    });

    const nextLobby = renderBoard({ value: state(null), playerName: "Alice" });
    expect(nextLobby).toMatch(/玩家名 <input[^>]*value="Alice"/u);
  });

  it("does not replace the profile when create or join fails", async () => {
    const setProfile = vi.fn();
    renderV2App(setProfile, {
      createRoom: vi.fn(async () => { throw new Error("create failed"); }),
      joinRoom: vi.fn(async () => { throw new Error("join failed"); })
    });
    const board = appBoardProps();
    if (!board.onCreateRoom || !board.onJoinRoom) throw new Error("room actions missing");

    await expect(board.onCreateRoom("Alice")).rejects.toThrow("create failed");
    await expect(board.onJoinRoom("room-1065", "Alice")).rejects.toThrow("join failed");
    expect(setProfile).not.toHaveBeenCalled();
  });
});

describe("RIFT-1098 V2 seat name survives a reload", () => {
  it("stores the successful create/join name in the player profile storage", async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
      clear: () => values.clear(),
      key: () => null,
      length: 0
    } as unknown as Storage;
    renderV2App(vi.fn(), {}, storage);
    const board = appBoardProps();
    if (!board.onCreateRoom) throw new Error("room actions missing");
    await board.onCreateRoom(" Alice ");
    expect(readPlayerProfile(storage)).toEqual({ name: "Alice", avatar: "leaf", bio: "保留简介" });
  });

  it("does not store a name when creating the room fails", async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
      clear: () => values.clear(),
      key: () => null,
      length: 0
    } as unknown as Storage;
    renderV2App(vi.fn(), { createRoom: vi.fn(async () => { throw new Error("create failed"); }) }, storage);
    const board = appBoardProps();
    if (!board.onCreateRoom) throw new Error("room actions missing");
    await expect(board.onCreateRoom("Alice")).rejects.toThrow("create failed");
    expect(values.size).toBe(0);
  });

  it("stores an already-current name when local profile storage is empty", async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
      clear: () => values.clear(),
      key: () => null,
      length: 0
    } as unknown as Storage;
    renderV2App(vi.fn(), {}, storage, { name: "Alice", avatar: "leaf", bio: "保留简介" });
    const board = appBoardProps();
    if (!board.onCreateRoom) throw new Error("room actions missing");

    expect(values.size).toBe(0);
    await board.onCreateRoom("Alice");
    expect(readPlayerProfile(storage)).toEqual({ name: "Alice", avatar: "leaf", bio: "保留简介" });
  });
});
