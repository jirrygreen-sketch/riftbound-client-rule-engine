import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import { DUEL_RULESET_ID, OFFICIAL_RULESET_ID, RULESET_ID } from "@riftbound/protocol";
import {
  ConnectionPanel,
  DEFAULT_ROOM_RULESET,
  PARTIAL_EFFECTS_NOTE,
  ROOM_RULESET_OPTIONS,
  UNKNOWN_ROOM_RULESET_NOTE,
  backgroundServerUrlUpdate,
  initialConnectionServerUrl,
  isRoomRulesetChoice,
  resolveInitialRuleset,
  type RoomRulesetChoice
} from "../src/components/ConnectionPanel";
import type { StoredSession } from "../src/net/GameClient";

/*
 * SSR plus real-handler capture.
 *
 * `renderToStaticMarkup` has no DOM, so it cannot click. To still exercise the
 * real component handlers (not a re-implementation) this file captures the
 * props of every element created through the automatic JSX runtime and invokes
 * the handler the button actually received. That keeps the assertions tied to
 * the production component while adding no DOM dependency and no new package.
 */
const captured = vi.hoisted(() => ({
  handlers: [] as Array<{ readonly props: Record<string, unknown> }>
}));

vi.mock("react/jsx-dev-runtime", async importOriginal => {
  const actual = await importOriginal<typeof import("react/jsx-dev-runtime")>();
  const capture = (type: unknown, props: unknown, ...rest: unknown[]) => {
    if (props && typeof props === "object") {
      const record = props as Record<string, unknown>;
      if (typeof record.onClick === "function" || typeof record.onSubmit === "function") {
        captured.handlers.push({ props: record });
      }
    }
    return (actual.jsxDEV as (...args: unknown[]) => unknown)(type, props, ...rest);
  };
  return { ...actual, jsxDEV: capture };
});

const ACTIVE_URL = "ws://127.0.0.1:8793/ws";
const LEGACY_URL = "ws://127.0.0.1:8787";

function storedSession(serverUrl: string): StoredSession {
  return {
    roomId: "room-1",
    playerId: "player-1",
    resumeToken: "resume-token-1",
    serverUrl
  };
}

interface RenderOptions {
  activeServerUrl?: string | null;
  storedSession?: StoredSession | null;
  roomId?: string | null;
  roomRulesetId?: string | null;
  status?: "idle" | "connecting" | "connected" | "reconnecting" | "disconnected";
  handshakeReady?: boolean;
  defaultRuleset?: RoomRulesetChoice;
  onCreateRoom?: (playerName: string, ruleset: RoomRulesetChoice) => void;
}

function renderPanel({
  activeServerUrl = null,
  storedSession: session = null,
  roomId = null,
  roomRulesetId = null,
  status = "idle",
  handshakeReady = false,
  defaultRuleset,
  onCreateRoom = () => {}
}: RenderOptions = {}): string {
  captured.handlers.length = 0;
  return renderToStaticMarkup(
    <ConnectionPanel
      status={status}
      handshakeReady={handshakeReady}
      roomId={roomId}
      roomRulesetId={roomRulesetId}
      storedSession={session}
      activeServerUrl={activeServerUrl}
      defaultRuleset={defaultRuleset}
      lastError={null}
      onConnect={vi.fn()}
      onCreateRoom={onCreateRoom}
      onJoinRoom={() => {}}
      onClearError={() => {}}
    />
  );
}

/** Finds the captured create-room button handler from the last render. */
function createRoomHandler(): () => void {
  const button = captured.handlers.find(
    entry =>
      entry.props.type === "button" &&
      typeof entry.props.className === "string" &&
      entry.props.className.includes("connection-action")
  );
  if (!button) throw new Error("create-room button handler not captured");
  return button.props.onClick as () => void;
}

function serverUrlInputValue(markup: string): string {
  const match = markup.match(/服务地址<\/span><input[^>]*value="([^"]*)"/);
  if (!match) throw new Error("server address input not found");
  return match[1];
}

function nicknameInputValue(markup: string): string {
  const match = markup.match(/昵称<\/span><input[^>]*value="([^"]*)"/);
  if (!match) throw new Error("nickname input not found");
  return match[1];
}

/** Opening tag of the button that carries the given label text. */
function buttonTagFor(markup: string, label: string): string {
  const labelIndex = markup.indexOf(label);
  if (labelIndex < 0) throw new Error(`button label not found: ${label}`);
  const start = markup.lastIndexOf("<button", labelIndex);
  if (start < 0) throw new Error(`button tag not found for: ${label}`);
  return markup.slice(start, markup.indexOf(">", start) + 1);
}

/** Every `<input>` opening tag whose value is one of the three rule ids. */
function rulesetInputTags(markup: string): string[] {
  return ROOM_RULESET_OPTIONS.map(option => {
    const index = markup.indexOf(`value="${option.id}"`);
    if (index < 0) throw new Error(`ruleset radio not found: ${option.id}`);
    const start = markup.lastIndexOf("<input", index);
    return markup.slice(start, markup.indexOf(">", start) + 1);
  });
}

function checkedRulesetIds(markup: string): readonly string[] {
  return ROOM_RULESET_OPTIONS
    .filter((option, position) => {
      const tag = rulesetInputTags(markup)[position];
      return tag !== undefined && tag.includes("checked");
    })
    .map(option => option.id);
}

beforeEach(() => {
  captured.handlers.length = 0;
});

describe("ConnectionPanel server address", () => {
  it("shows the real active URL when the stored resume session was already consumed", () => {
    expect(serverUrlInputValue(renderPanel({ activeServerUrl: ACTIVE_URL }))).toBe(
      ACTIVE_URL
    );
  });

  it("prefers the active URL over a not-yet-consumed stored session", () => {
    const markup = renderPanel({
      activeServerUrl: ACTIVE_URL,
      storedSession: storedSession("ws://127.0.0.1:8791/ws")
    });
    expect(serverUrlInputValue(markup)).toBe(ACTIVE_URL);
  });

  it("uses the stored session URL before any connection is established", () => {
    const markup = renderPanel({ storedSession: storedSession(ACTIVE_URL) });
    expect(serverUrlInputValue(markup)).toBe(ACTIVE_URL);
  });

  it("falls back to the local default only when nothing else is known", () => {
    expect(serverUrlInputValue(renderPanel())).toBe(LEGACY_URL);
    expect(serverUrlInputValue(renderPanel({ activeServerUrl: null }))).toBe(LEGACY_URL);
  });

  it("tucks the address into an expandable server-settings region", () => {
    const markup = renderPanel();
    expect(markup).toContain("服务器设置");
    expect(markup).toContain("<details");
  });

  it("keeps the nickname field and the join-room field", () => {
    const markup = renderPanel({ activeServerUrl: ACTIVE_URL });
    expect(nicknameInputValue(markup)).toBe("玩家");
    expect(markup).toContain("房间号");
  });
});

describe("ConnectionPanel address resolution", () => {
  it("resolves the initial value from active URL, stored session, then default", () => {
    expect(initialConnectionServerUrl(ACTIVE_URL, null)).toBe(ACTIVE_URL);
    expect(initialConnectionServerUrl(null, storedSession(ACTIVE_URL))).toBe(ACTIVE_URL);
    expect(initialConnectionServerUrl(null, null)).toBe(LEGACY_URL);
  });

  it("adopts a background active-URL refresh while the field is untouched", () => {
    expect(backgroundServerUrlUpdate(ACTIVE_URL, LEGACY_URL, false)).toBe(ACTIVE_URL);
    expect(backgroundServerUrlUpdate(ACTIVE_URL, ACTIVE_URL, false)).toBeNull();
  });

  it("never overwrites user-typed text on a background active-URL change", () => {
    expect(backgroundServerUrlUpdate(ACTIVE_URL, "127.0.0.1:9000", true)).toBeNull();
    expect(backgroundServerUrlUpdate(null, "127.0.0.1:9000", false)).toBeNull();
  });
});

describe("ConnectionPanel ruleset choice", () => {
  it("offers exactly the three real rulesets with clear big-rule labels", () => {
    const markup = renderPanel();
    expect(ROOM_RULESET_OPTIONS.map(option => option.id)).toEqual([
      OFFICIAL_RULESET_ID,
      DUEL_RULESET_ID,
      RULESET_ID
    ]);
    expect(ROOM_RULESET_OPTIONS.map(option => option.label)).toEqual([
      "基础规则",
      "1v1 对局",
      "演示规则"
    ]);
    expect(markup).toContain("基础规则");
    expect(markup).toContain("1v1 对局");
    expect(markup).toContain("演示规则");
  });

  it("defaults the create choice to the 1v1 big rule", () => {
    expect(DEFAULT_ROOM_RULESET).toBe(DUEL_RULESET_ID);
    expect(checkedRulesetIds(renderPanel())).toEqual([DUEL_RULESET_ID]);
  });

  it("honours an explicit supported defaultRuleset but ignores an unknown one", () => {
    expect(resolveInitialRuleset(OFFICIAL_RULESET_ID)).toBe(OFFICIAL_RULESET_ID);
    expect(resolveInitialRuleset(RULESET_ID)).toBe(RULESET_ID);
    expect(resolveInitialRuleset()).toBe(DUEL_RULESET_ID);
    expect(resolveInitialRuleset(null)).toBe(DUEL_RULESET_ID);
    // A fabricated id must never be accepted as a game mode.
    expect(
      resolveInitialRuleset("riftbound-experimental" as RoomRulesetChoice)
    ).toBe(DUEL_RULESET_ID);
    expect(checkedRulesetIds(renderPanel({ defaultRuleset: OFFICIAL_RULESET_ID }))).toEqual([
      OFFICIAL_RULESET_ID
    ]);
  });

  it("exposes a real membership guard for the three supported rulesets", () => {
    expect(isRoomRulesetChoice(OFFICIAL_RULESET_ID)).toBe(true);
    expect(isRoomRulesetChoice(DUEL_RULESET_ID)).toBe(true);
    expect(isRoomRulesetChoice(RULESET_ID)).toBe(true);
    expect(isRoomRulesetChoice("riftbound-experimental")).toBe(false);
    expect(isRoomRulesetChoice(undefined)).toBe(false);
  });

  it("states the unsupported-effects caveat once, plainly", () => {
    const markup = renderPanel();
    expect(markup).toContain(PARTIAL_EFFECTS_NOTE);
    const occurrences = markup.split(PARTIAL_EFFECTS_NOTE).length - 1;
    expect(occurrences).toBe(1);
  });

  it("renders no regional-event or development-preview dimension at all", () => {
    const markup = renderPanel();
    expect(markup).not.toContain("地区赛事");
    expect(markup).not.toContain("赛事地区");
    expect(markup).not.toContain("赛事当地日期");
    expect(markup).not.toContain("开发预览");
    expect(markup).not.toContain("Foundation 规则");
    expect(markup).not.toContain("Synthetic Demo");
  });
});

describe("ConnectionPanel create request", () => {
  it("creates a room with only nickname and ruleset, never a third region argument", () => {
    const onCreateRoom = vi.fn<(playerName: string, ruleset: RoomRulesetChoice) => void>();
    renderPanel({
      status: "connected",
      handshakeReady: true,
      onCreateRoom
    });
    createRoomHandler()();
    expect(onCreateRoom).toHaveBeenCalledTimes(1);
    expect(onCreateRoom).toHaveBeenCalledWith("玩家", DUEL_RULESET_ID);
    // Exactly two arguments reach the parent adapter: no constructedRegion.
    expect(onCreateRoom.mock.calls[0]).toHaveLength(2);
  });

  it("sends the explicitly chosen big rule through to the parent", () => {
    const onCreateRoom = vi.fn<(playerName: string, ruleset: RoomRulesetChoice) => void>();
    renderPanel({
      status: "connected",
      handshakeReady: true,
      defaultRuleset: OFFICIAL_RULESET_ID,
      onCreateRoom
    });
    createRoomHandler()();
    expect(onCreateRoom).toHaveBeenCalledWith("玩家", OFFICIAL_RULESET_ID);
    expect(onCreateRoom.mock.calls[0]).toHaveLength(2);
  });
});

describe("ConnectionPanel in-room ruleset display", () => {
  it("shows the real room ruleset instead of the local creation choice", () => {
    const markup = renderPanel({ roomId: "05715086", roomRulesetId: OFFICIAL_RULESET_ID });
    expect(checkedRulesetIds(markup)).toEqual([OFFICIAL_RULESET_ID]);
    expect(markup).toContain("当前房间规则");
    expect(markup).toContain("基础规则");
    expect(markup).toContain('disabled=""');
  });

  it("restores the previous local creation choice once the room is left", () => {
    const inRoom = renderPanel({
      roomId: "05715086",
      roomRulesetId: OFFICIAL_RULESET_ID,
      defaultRuleset: RULESET_ID
    });
    expect(checkedRulesetIds(inRoom)).toEqual([OFFICIAL_RULESET_ID]);
    expect(checkedRulesetIds(renderPanel({ defaultRuleset: RULESET_ID }))).toEqual([
      RULESET_ID
    ]);
  });

  it("selects nothing and describes an unknown room ruleset without dumping the raw field", () => {
    const markup = renderPanel({
      roomId: "05715086",
      roomRulesetId: "riftbound-experimental"
    });
    expect(checkedRulesetIds(markup)).toEqual([]);
    expect(markup).toContain(UNKNOWN_ROOM_RULESET_NOTE);
    expect(markup).not.toContain("riftbound-experimental");
  });
});

describe("ConnectionPanel entry gating and session restore", () => {
  it("keeps create/join disabled until connected with a ready handshake", () => {
    const idle = renderPanel();
    expect(buttonTagFor(idle, "创建房间")).toContain('disabled=""');
    expect(buttonTagFor(idle, "加入房间")).toContain('disabled=""');

    const connectedNoHandshake = renderPanel({ status: "connected" });
    expect(buttonTagFor(connectedNoHandshake, "创建房间")).toContain('disabled=""');

    const ready = renderPanel({ status: "connected", handshakeReady: true });
    expect(buttonTagFor(ready, "创建房间")).not.toContain('disabled=""');
  });

  it("refuses re-entry once the session is already inside a room", () => {
    const markup = renderPanel({
      status: "connected",
      handshakeReady: true,
      roomId: "05715086",
      roomRulesetId: DUEL_RULESET_ID
    });
    expect(buttonTagFor(markup, "创建房间")).toContain('disabled=""');
    expect(buttonTagFor(markup, "加入房间")).toContain('disabled=""');
  });

  it("shows the real connection status and flags an in-progress session restore", () => {
    const idle = renderPanel();
    expect(idle).toContain("未连接");
    expect(idle).toContain("未进入房间");
    expect(idle).not.toContain("正在恢复会话");

    const restoring = renderPanel({
      status: "reconnecting",
      storedSession: storedSession(ACTIVE_URL)
    });
    expect(restoring).toContain("正在恢复会话");

    const inRoom = renderPanel({ status: "connected", roomId: "05715086" });
    expect(inRoom).toContain("已连接");
    expect(inRoom).toContain("房间 05715086");
  });
});
