import type { ReactNode } from "react";
import {
  DUEL_RULESET_ID,
  OFFICIAL_RULESET_ID,
  RULESET_ID,
  type RoomPlayer,
  type RoomView
} from "@riftbound/protocol";
import "./RoomLobby.css";

/**
 * Pure-presentation joined-room lobby shell.
 *
 * This component owns no game, room, or connection state. Every user-visible
 * fact is either read from the authoritative `RoomView` projection passed in as
 * `room` or supplied through a parent-owned slot / callback. It never derives a
 * cost, phase, ready rule, or deck legality, and it never treats local state as
 * authority: disabling a button here mirrors the parent gate (`canSubmitDeck`,
 * `canToggleReady`) and cannot bypass the server-side submission confirmation.
 *
 * The deck selector and the room chat are opaque `ReactNode` slots rendered
 * inside their own labeled regions. The chat region always reserves its fixed
 * width, so a wide deck selector can never squeeze it out of the layout.
 */

export const ROOM_LOBBY_LABEL = "房间大厅";
export const ROOM_LOBBY_HEADER_LABEL = "房间信息";
export const ROOM_LOBBY_DECK_LABEL = "卡组选择";
export const ROOM_LOBBY_PLAYERS_LABEL = "玩家列表";
export const ROOM_LOBBY_READY_LABEL = "准备与提交";
export const ROOM_LOBBY_CHAT_LABEL = "房间聊天";

export const ROOM_STATUS_LABELS: Readonly<Record<RoomView["status"], string>> = {
  waiting: "等待中",
  playing: "对局中",
  ended: "已结束"
};

/** Human-readable labels for rulesets the client actually supports. */
export const ROOM_RULESET_LABELS: Readonly<Record<string, string>> = {
  [OFFICIAL_RULESET_ID]: "基础规则（Foundation）",
  [RULESET_ID]: "演示规则（Synthetic Demo）",
  [DUEL_RULESET_ID]: "1v1 对局（开发预览）"
};

/** Resolve a plain-language ruleset label; unknown ids fall back to the raw id. */
export function roomRulesetLabel(rulesetId: string): string {
  return ROOM_RULESET_LABELS[rulesetId] ?? rulesetId;
}

/** Truncate a player id to a short, display-only form; never used for auth. */
export function shortPlayerId(playerId: string): string {
  return playerId.length <= 8 ? playerId : `${playerId.slice(0, 8)}…`;
}

export interface RoomLobbyProps {
  readonly room: RoomView;
  readonly viewerPlayerId: string | null;
  readonly deckPicker: ReactNode;
  readonly chat: ReactNode;
  readonly onSubmitDeck: () => void;
  readonly onToggleReady: () => void;
  readonly onSync: () => void;
  readonly canSubmitDeck: boolean;
  readonly canToggleReady: boolean;
  readonly readyLabel: string;
  readonly submitBlockedReason?: string | null;
  readonly readyBlockedReason?: string | null;
  readonly onEnterGame: () => void;
}

function PlayerRow({
  player,
  isViewer
}: {
  readonly player: RoomPlayer;
  readonly isViewer: boolean;
}) {
  return (
    <li className={isViewer ? "room-lobby-player is-viewer" : "room-lobby-player"}>
      <div className="room-lobby-player-head">
        <span className="room-lobby-player-name">{player.name}</span>
        {isViewer ? <span className="room-lobby-player-you">你</span> : null}
        <span className="room-lobby-player-id">{shortPlayerId(player.id)}</span>
      </div>
      <div className="room-lobby-player-tags">
        <span className={player.connected ? "room-tag ok" : "room-tag off"}>
          {player.connected ? "已连接" : "未连接"}
        </span>
        <span className={player.ready ? "room-tag ok" : "room-tag pending"}>
          {player.ready ? "已准备" : "未准备"}
        </span>
        <span className={player.deckSubmitted ? "room-tag ok" : "room-tag pending"}>
          {player.deckSubmitted ? "卡组已提交" : "卡组未提交"}
        </span>
      </div>
    </li>
  );
}

export function RoomLobby({
  room,
  viewerPlayerId,
  deckPicker,
  chat,
  onSubmitDeck,
  onToggleReady,
  onSync,
  canSubmitDeck,
  canToggleReady,
  readyLabel,
  submitBlockedReason,
  readyBlockedReason,
  onEnterGame
}: RoomLobbyProps) {
  const canEnterGame = room.status === "playing" || room.status === "ended";

  return (
    <section className="room-lobby-shell" role="region" aria-label={ROOM_LOBBY_LABEL}>
      <header className="room-lobby-head" role="region" aria-label={ROOM_LOBBY_HEADER_LABEL}>
        <div className="room-lobby-head-field">
          <span className="room-lobby-head-label">房间号</span>
          <strong className="room-lobby-head-value">{room.roomId}</strong>
        </div>
        <div className="room-lobby-head-field">
          <span className="room-lobby-head-label">规则</span>
          <strong className="room-lobby-head-value">{roomRulesetLabel(room.rulesetId)}</strong>
        </div>
        <div className="room-lobby-head-field">
          <span className="room-lobby-head-label">状态</span>
          <strong className="room-lobby-head-value">{ROOM_STATUS_LABELS[room.status]}</strong>
        </div>
        <div className="room-lobby-head-actions">
          <button className="button" type="button" onClick={onSync}>
            同步房间事件
          </button>
          <button
            className="button primary"
            type="button"
            onClick={onEnterGame}
            disabled={!canEnterGame}
            title={canEnterGame ? "进入对局" : "对局开始后可进入"}
          >
            进入对局
          </button>
        </div>
      </header>

      <div className="room-lobby-body">
        <div className="room-lobby-col room-lobby-col-deck" role="region" aria-label={ROOM_LOBBY_DECK_LABEL}>
          <h2 className="room-lobby-col-title">卡组选择</h2>
          <div className="room-lobby-col-scroll">{deckPicker}</div>
        </div>

        <div className="room-lobby-col room-lobby-col-main">
          <section
            className="room-lobby-panel"
            role="region"
            aria-label={ROOM_LOBBY_PLAYERS_LABEL}
          >
            <h2 className="room-lobby-col-title">玩家列表</h2>
            <ul className="room-lobby-players">
              {room.players.map(player => (
                <PlayerRow
                  key={player.id}
                  player={player}
                  isViewer={viewerPlayerId !== null && player.id === viewerPlayerId}
                />
              ))}
            </ul>
          </section>

          <section
            className="room-lobby-panel"
            role="region"
            aria-label={ROOM_LOBBY_READY_LABEL}
          >
            <h2 className="room-lobby-col-title">准备与提交</h2>
            <div className="room-lobby-actions">
              <button
                className="button primary"
                type="button"
                onClick={onSubmitDeck}
                disabled={!canSubmitDeck}
                title={canSubmitDeck ? "把当前卡组提交给房间" : undefined}
              >
                提交当前卡组
              </button>
              <button
                className="button primary"
                type="button"
                onClick={onToggleReady}
                disabled={!canToggleReady}
                title={canToggleReady ? readyLabel : undefined}
              >
                {readyLabel}
              </button>
            </div>
            {submitBlockedReason ? (
              <p className="room-lobby-hint">无法提交卡组：{submitBlockedReason}</p>
            ) : null}
            {readyBlockedReason ? (
              <p className="room-lobby-hint">无法准备：{readyBlockedReason}</p>
            ) : null}
          </section>
        </div>

        {/* The supplied chat slot owns its own visible title, so this region is
            named for assistive tech but prints no second "房间聊天" heading. */}
        <div className="room-lobby-col room-lobby-col-chat" role="region" aria-label={ROOM_LOBBY_CHAT_LABEL}>
          <div className="room-lobby-col-scroll">{chat}</div>
        </div>
      </div>
    </section>
  );
}
