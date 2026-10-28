import type { ConstructedRegionContext } from "@riftbound/protocol";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Cable, LogIn, Plus, RefreshCw, Users } from "lucide-react";
import { OFFICIAL_RULESET_ID, DUEL_RULESET_ID, RULESET_ID } from "@riftbound/protocol";
import type { GameClientStatus, StoredSession } from "../net/GameClient";
import { DEFAULT_WS_SERVER_URL } from "../net/server-defaults";
import "./ConnectionPanel.css";

export type RoomRulesetChoice =
  | typeof OFFICIAL_RULESET_ID
  | typeof RULESET_ID
  | typeof DUEL_RULESET_ID;

/**
 * Rule modes offered by the room-creation radiogroup. These are the three real
 * rulesets the server already understands; the panel never invents a game mode
 * and never adds an event-region/date dimension. Duel is the client's primary
 * playable big rule and is therefore the default selection.
 */
export interface RoomRulesetOption {
  readonly id: RoomRulesetChoice;
  readonly label: string;
  readonly description?: string;
}

export const ROOM_RULESET_OPTIONS: readonly RoomRulesetOption[] = [
  {
    id: OFFICIAL_RULESET_ID,
    label: "基础规则",
    description: "基础对局模式。"
  },
  {
    id: DUEL_RULESET_ID,
    label: "1v1 对局",
    description: "标准 1v1 对局，准备后即可在牌桌对战。"
  },
  {
    id: RULESET_ID,
    label: "演示规则",
    description: "用于体验对战流程。"
  }
];

/** Default create-room rule when the caller does not pass `defaultRuleset`. */
export const DEFAULT_ROOM_RULESET: RoomRulesetChoice = DUEL_RULESET_ID;

/** True when `value` is one of the three real, selectable ruleset ids. */
export function isRoomRulesetChoice(value: unknown): value is RoomRulesetChoice {
  return (
    typeof value === "string" &&
    ROOM_RULESET_OPTIONS.some(option => option.id === value)
  );
}

/**
 * Resolves the initial create-room ruleset. An explicit `defaultRuleset` wins
 * only when it is one of the real options; anything else falls back to the
 * built-in default so the panel can never present a fabricated mode.
 */
export function resolveInitialRuleset(
  defaultRuleset?: RoomRulesetChoice | null
): RoomRulesetChoice {
  return isRoomRulesetChoice(defaultRuleset) ? defaultRuleset : DEFAULT_ROOM_RULESET;
}

export const DEFAULT_CONNECTION_SERVER_URL = DEFAULT_WS_SERVER_URL;

/**
 * One concise reminder that this client is not a finished official rules
 * implementation. It is stated once, plainly, and never as a per-card claim.
 */
export const PARTIAL_EFFECTS_NOTE =
  "部分卡牌效果尚未支持；可用操作以当前牌桌提示为准。";

/**
 * Shown while the joined room reports a ruleset this client has no creation
 * option for. It deliberately describes the state instead of echoing the raw
 * server field.
 */
export const UNKNOWN_ROOM_RULESET_NOTE =
  "当前房间使用的规则模式不在可创建列表中，离开房间后可重新选择创建模式。";

/**
 * Initial value of the server-address input: the real active connection URL
 * first (the transport's normalized target, which survives after the stored
 * resume session is consumed), then a still-unconsumed stored session URL,
 * then the local fallback.
 */
export function initialConnectionServerUrl(
  activeServerUrl: string | null | undefined,
  storedSession: StoredSession | null
): string {
  return activeServerUrl ?? storedSession?.serverUrl ?? DEFAULT_CONNECTION_SERVER_URL;
}

/**
 * Value the address input adopts when the active connection URL changes in the
 * background. Returns `null` when the current text must be preserved: once the
 * user has edited the field, a background restore/reconnect must never
 * overwrite a half-typed target address.
 */
export function backgroundServerUrlUpdate(
  activeServerUrl: string | null | undefined,
  currentValue: string,
  userEdited: boolean
): string | null {
  if (userEdited || !activeServerUrl) return null;
  return activeServerUrl === currentValue ? null : activeServerUrl;
}

interface ConnectionPanelProps {
  status: GameClientStatus;
  handshakeReady: boolean;
  roomId: string | null;
  /**
   * Ruleset of the room this session is actually in, from the authoritative
   * `RoomView` projection. While a room is open the panel displays this value
   * instead of the local creation choice; `null`/absent keeps the previous
   * behavior (the local choice) so existing callers keep working.
   */
  roomRulesetId?: string | null;
  storedSession: StoredSession | null;
  /**
   * Read-only current connection URL from `useGameClient` (optional so older
   * callers keep compiling); used only to seed/refresh the displayed address.
   */
  activeServerUrl?: string | null;
  /**
   * Controlled nick name. When provided the input is fully controlled by the
   * parent; when omitted the panel keeps its own local state.
   */
  playerName?: string;
  onPlayerNameChange?: (value: string) => void;
  /**
   * Initial create-room rule. Must be one of the real ruleset ids; anything
   * else falls back to `DEFAULT_ROOM_RULESET`.
   */
  defaultRuleset?: RoomRulesetChoice;
  lastError: string | null;
  onConnect: (serverUrl: string) => void;
  /**
   * Create a room with the chosen real ruleset. The panel never sends a third
   * event-region argument: region selection was removed from this scope and
   * the server keeps any multi-region capability on its own.
   */
  onCreateRoom: (playerName: string, ruleset: RoomRulesetChoice) => void;
  /**
   * Accepted for backward compatibility only. The panel no longer renders or
   * reads the room's constructed region; the parent owns that projection.
   */
  roomConstructedRegion?: ConstructedRegionContext | null;
  onJoinRoom: (playerName: string, roomId: string) => void;
  onClearError: () => void;
}

const statusText: Record<GameClientStatus, string> = {
  idle: "未连接",
  connecting: "连接中",
  connected: "已连接",
  reconnecting: "重连中",
  disconnected: "已断开"
};

const DEFAULT_PLAYER_NAME = "玩家";

export function ConnectionPanel({
  status,
  handshakeReady,
  roomId,
  roomRulesetId,
  storedSession,
  activeServerUrl,
  playerName,
  onPlayerNameChange,
  defaultRuleset,
  lastError,
  onConnect,
  onCreateRoom,
  onJoinRoom,
  onClearError
}: ConnectionPanelProps) {
  const [serverUrl, setServerUrl] = useState(() =>
    initialConnectionServerUrl(activeServerUrl, storedSession)
  );
  // Tracks whether the user has typed in the address field. Once set, a
  // background active-URL change must not clobber the in-progress target.
  const userEditedRef = useRef(false);
  const [localPlayerName, setLocalPlayerName] = useState(DEFAULT_PLAYER_NAME);
  const resolvedPlayerName = playerName ?? localPlayerName;
  const [joinRoomId, setJoinRoomId] = useState("");
  const [ruleset, setRuleset] = useState<RoomRulesetChoice>(() =>
    resolveInitialRuleset(defaultRuleset)
  );
  const connected = status === "connected";
  const canEnterRoom = connected && handshakeReady && !roomId;
  const inRoom = roomId !== null;
  const restoringSession =
    storedSession !== null && (status === "connecting" || status === "reconnecting");
  // Inside a room the displayed selection is the room's real (server-projected)
  // ruleset, never the local creation choice: a disabled card must not claim to
  // be the active mode of a live room. The local choice stays untouched
  // underneath and is shown again once the room is left, and the create handler
  // still sends the local choice.
  const roomRuleset =
    roomId !== null && typeof roomRulesetId === "string" && roomRulesetId.length > 0
      ? roomRulesetId
      : null;
  const displayedRuleset: string = roomRuleset ?? ruleset;
  const displayedOption =
    ROOM_RULESET_OPTIONS.find(option => option.id === displayedRuleset) ?? null;
  // An unknown server ruleset selects nothing and is described generically —
  // the raw implementation field is never rendered.
  const unknownRoomRulesetNote =
    roomRuleset !== null && displayedOption === null ? UNKNOWN_ROOM_RULESET_NOTE : null;

  // Refresh the displayed address only while the user has not edited it, so a
  // background reconnect/restore can never overwrite a half-typed target.
  useEffect(() => {
    setServerUrl(current => {
      const next = backgroundServerUrlUpdate(
        activeServerUrl,
        current,
        userEditedRef.current
      );
      return next ?? current;
    });
  }, [activeServerUrl]);

  const handleConnect = (event: FormEvent) => {
    event.preventDefault();
    // Submitting hands the address back to the transport: allow the next
    // active-URL update to reflect the normalized target.
    userEditedRef.current = false;
    onConnect(serverUrl);
  };

  const handlePlayerNameChange = (value: string) => {
    setLocalPlayerName(value);
    onPlayerNameChange?.(value);
  };

  const handleCreate = () => {
    if (!canEnterRoom) return;
    onCreateRoom(resolvedPlayerName, ruleset);
  };

  const handleJoin = (event: FormEvent) => {
    event.preventDefault();
    if (!canEnterRoom || !joinRoomId.trim()) return;
    onJoinRoom(resolvedPlayerName, joinRoomId.trim());
  };

  return (
    <section
      className="connection-panel connection-big-rules"
      aria-label="服务连接与房间"
    >
      <details className="connection-settings">
        <summary className="connection-settings-summary">服务器设置</summary>
        <form className="connection-settings-body" onSubmit={handleConnect}>
          <label className="field">
            <span>服务地址</span>
            <input
              value={serverUrl}
              onChange={event => {
                userEditedRef.current = true;
                setServerUrl(event.target.value);
              }}
              spellCheck={false}
              autoComplete="url"
            />
          </label>
          <button
            className="button primary"
            type="submit"
            disabled={status === "connecting" || status === "reconnecting"}
          >
            <RefreshCw size={16} aria-hidden />
            连接
          </button>
        </form>
      </details>

      <div className="connection-body">
        <div className="connection-nickname-row">
          <label className="field">
            <span>昵称</span>
            <input
              value={resolvedPlayerName}
              onChange={event => handlePlayerNameChange(event.target.value)}
              maxLength={24}
            />
          </label>
        </div>

        <div className="connection-columns">
          <section className="connection-column connection-create" aria-label="房间创建">
            <h3 className="connection-column-title">创建新房间</h3>

            <fieldset className="connection-ruleset" disabled={inRoom}>
              <legend className="connection-legend">对局规则</legend>
              <div className="connection-radio-cards" role="radiogroup" aria-label="规则模式">
                {ROOM_RULESET_OPTIONS.map(option => {
                  const selected = displayedRuleset === option.id;
                  return (
                    <label
                      key={option.id}
                      className={`connection-radio-card ${selected ? "is-selected" : ""}`}
                    >
                      <input
                        type="radio"
                        name="connection-ruleset"
                        value={option.id}
                        checked={selected}
                        onChange={() => setRuleset(option.id)}
                        disabled={inRoom}
                      />
                      <span className="connection-radio-card-label">{option.label}</span>
                      {option.description ? (
                        <span className="connection-radio-card-desc">
                          {option.description}
                        </span>
                      ) : null}
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <p className="connection-note" role="note">
              {PARTIAL_EFFECTS_NOTE}
            </p>

            {unknownRoomRulesetNote ? (
              <p className="connection-note" role="note">
                {unknownRoomRulesetNote}
              </p>
            ) : null}

            {inRoom && displayedOption ? (
              <p className="connection-room-ruleset">
                当前房间规则：<strong>{displayedOption.label}</strong>
              </p>
            ) : null}

            <button
              className="button primary connection-action"
              type="button"
              onClick={handleCreate}
              disabled={!canEnterRoom}
            >
              <Plus size={16} aria-hidden />
              创建房间
            </button>
          </section>

          <section className="connection-column connection-join" aria-label="房间加入">
            <h3 className="connection-column-title">加入已有房间</h3>
            <form className="connection-join-form" onSubmit={handleJoin}>
              <label className="field">
                <span>房间号</span>
                <input
                  value={joinRoomId}
                  onChange={event => setJoinRoomId(event.target.value)}
                  placeholder="输入房间号"
                />
              </label>
              <button
                className="button connection-action"
                type="submit"
                disabled={!canEnterRoom || !joinRoomId.trim()}
              >
                <LogIn size={16} aria-hidden />
                加入房间
              </button>
            </form>
          </section>
        </div>

        <div className="connection-state">
          <span className={`status-dot status-${status}`} aria-hidden />
          <span>{restoringSession ? "正在恢复会话" : statusText[status]}</span>
          <span className="divider">|</span>
          <Users size={16} aria-hidden />
          <span>{roomId ? `房间 ${roomId}` : "未进入房间"}</span>
          {connected && !roomId ? <span className="hint">连接后请创建或加入房间</span> : null}
        </div>

        {lastError ? (
          <div className="error-bar" role="alert">
            <Cable size={16} aria-hidden />
            <span>{lastError}</span>
            <button type="button" className="ghost-button" onClick={onClearError}>
              关闭
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
