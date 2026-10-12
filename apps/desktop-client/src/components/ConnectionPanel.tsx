import { type FormEvent, useState } from "react";
import { Cable, LogIn, Plus, RefreshCw, Users } from "lucide-react";
import { OFFICIAL_RULESET_ID, RULESET_ID } from "@riftbound/protocol";
import type { GameClientStatus, StoredSession } from "../net/GameClient";

export type RoomRulesetChoice = typeof OFFICIAL_RULESET_ID | typeof RULESET_ID;

interface ConnectionPanelProps {
  status: GameClientStatus;
  handshakeReady: boolean;
  roomId: string | null;
  storedSession: StoredSession | null;
  lastError: string | null;
  onConnect: (serverUrl: string) => void;
  onCreateRoom: (playerName: string, ruleset: RoomRulesetChoice) => void;
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

export function ConnectionPanel({
  status,
  handshakeReady,
  roomId,
  storedSession,
  lastError,
  onConnect,
  onCreateRoom,
  onJoinRoom,
  onClearError
}: ConnectionPanelProps) {
  const [serverUrl, setServerUrl] = useState(
    storedSession?.serverUrl ?? "ws://127.0.0.1:8787"
  );
  const [playerName, setPlayerName] = useState("玩家");
  const [joinRoomId, setJoinRoomId] = useState("");
  const [ruleset, setRuleset] = useState<RoomRulesetChoice>(OFFICIAL_RULESET_ID);
  const connected = status === "connected";
  const canEnterRoom = connected && handshakeReady && !roomId;
  const restoringSession =
    storedSession !== null && (status === "connecting" || status === "reconnecting");

  const handleConnect = (event: FormEvent) => {
    event.preventDefault();
    onConnect(serverUrl);
  };

  const handleCreate = () => {
    onCreateRoom(playerName, ruleset);
  };

  const handleJoin = (event: FormEvent) => {
    event.preventDefault();
    if (!joinRoomId.trim()) return;
    onJoinRoom(playerName, joinRoomId.trim());
  };

  return (
    <section className="connection-panel" aria-label="服务连接与房间">
      <form className="connection-row" onSubmit={handleConnect}>
        <label className="field">
          <span>服务地址</span>
          <input
            value={serverUrl}
            onChange={event => setServerUrl(event.target.value)}
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

      <div className="connection-row">
        <label className="field">
          <span>昵称</span>
          <input
            value={playerName}
            onChange={event => setPlayerName(event.target.value)}
            maxLength={24}
          />
        </label>
        <button className="button primary" type="button" onClick={handleCreate} disabled={!canEnterRoom}>
          <Plus size={16} aria-hidden />
          创建房间
        </button>
      </div>

      <div className="connection-row ruleset-row" role="radiogroup" aria-label="规则模式">
        {([
          [OFFICIAL_RULESET_ID, "Foundation 规则"],
          [RULESET_ID, "Synthetic Demo"]
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`ruleset-button ${ruleset === id ? "active" : ""}`}
            onClick={() => setRuleset(id)}
            aria-pressed={ruleset === id}
            disabled={roomId !== null}
          >
            {label}
          </button>
        ))}
      </div>

      <form className="connection-row" onSubmit={handleJoin}>
        <label className="field">
          <span>房间号</span>
          <input
            value={joinRoomId}
            onChange={event => setJoinRoomId(event.target.value)}
            placeholder="输入房间号"
          />
        </label>
        <button className="button" type="submit" disabled={!canEnterRoom || !joinRoomId.trim()}>
          <LogIn size={16} aria-hidden />
          加入
        </button>
      </form>

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
    </section>
  );
}
