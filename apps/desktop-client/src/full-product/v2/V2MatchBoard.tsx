import { useEffect, useMemo, useState } from "react";
import type {
  V2ChoiceAnswer,
  V2ChoiceOption,
  V2EventPayload,
  V2PendingChoice,
  V2PlayerSnapshot,
  V2ProjectedObject,
  V2Projection
} from "../../../../../packages/protocol/src/v2/index.js";
import { buildV2ChooseCommand, type V2ChoiceUiState } from "../../state/v2";
import type { V2ClientState } from "../../state/v2";
import type { V2CommandReceipt } from "../../../../../packages/protocol/src/v2/index.js";
import type { V2CommandRequest } from "../../transport/v2";
import "./V2MatchBoard.css";

export interface V2MatchBoardProps {
  readonly state: V2ClientState;
  readonly pendingCommandIds?: readonly string[];
  readonly transportError?: string | null;
  readonly onCommand: (request: V2CommandRequest) => Promise<V2CommandReceipt>;
}

export function buildV2PlayCommand(cardObjectId: string): V2CommandRequest {
  return { type: "play", cardObjectId };
}

export function buildV2PassCommand(): V2CommandRequest {
  return { type: "pass" };
}

export function buildV2MulliganCommand(selectedObjectIds: readonly string[]): V2CommandRequest {
  return { type: "mulligan", selectedObjectIds: [...selectedObjectIds] };
}

export function visibleV2Objects(projection: V2Projection, zone: V2ProjectedObject["zone"]): readonly V2ProjectedObject[] {
  return projection.objects.filter(object => object.zone === zone);
}

export function V2MatchBoard({
  state,
  pendingCommandIds = [],
  transportError = null,
  onCommand
}: V2MatchBoardProps) {
  const projection = state.projection;
  const [selectedMulliganIds, setSelectedMulliganIds] = useState<readonly string[]>([]);
  const [selectedChoiceIds, setSelectedChoiceIds] = useState<readonly string[]>([]);
  const [numberAnswer, setNumberAnswer] = useState("");
  const [commandError, setCommandError] = useState<string | null>(null);
  const sceneKey = projection === null ? "none" : `${projection.matchId}:${projection.stateVersion}`;
  const busy = pendingCommandIds.length > 0;

  useEffect(() => {
    setSelectedMulliganIds([]);
    setSelectedChoiceIds([]);
    setNumberAnswer("");
    setCommandError(null);
  }, [sceneKey]);

  const submit = (request: V2CommandRequest): void => {
    setCommandError(null);
    void onCommand(request).catch(error => {
      setCommandError(error instanceof Error ? error.message : "命令未能提交。");
    });
  };

  if (projection === null) {
    return (
      <section className="v2-match-board" aria-label="协议 v2 对局">
        <header className="v2-match-header">
          <h2>协议 v2 对局</h2>
          <ConnectionState state={state.connectionStatus} />
        </header>
        {transportError || state.lastError ? <p role="alert">{transportError ?? state.lastError}</p> : null}
        <p className="v2-empty-state">正在等待服务端投影…</p>
      </section>
    );
  }

  const viewer = projection.players.find(player => player.playerId === projection.viewerPlayerId) ?? null;
  const opponent = projection.players.find(player => player.playerId !== projection.viewerPlayerId) ?? null;
  const ownHand = projection.zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === projection.viewerPlayerId)?.objects ??
    projection.objects.filter(object => object.zone === "hand" && object.ownerPlayerId === projection.viewerPlayerId);
  const baseObjects = visibleV2Objects(projection, "base");
  const battlefieldObjects = visibleV2Objects(projection, "battlefield").concat(visibleV2Objects(projection, "board"));
  const runeObjects = visibleV2Objects(projection, "rune-zone");
  const setup = projection.phase === "setup";
  const canPass = projection.priority.playerId === projection.viewerPlayerId && projection.pendingChoice.status === "none" && !busy;
  const canAct = state.connectionStatus === "connected" && projection.winnerPlayerId === null && !busy;
  const canPlay = setup
    ? canAct
    : canAct && projection.priority.playerId === projection.viewerPlayerId && projection.pendingChoice.status === "none";

  return (
    <section className="v2-match-board" aria-label="协议 v2 对局">
      <header className="v2-match-header">
        <div>
          <p className="v2-kicker">协议 v2 · {projection.rulesetVersion}</p>
          <h2>{phaseLabel(projection.phase)} · 第 {projection.turnNumber} 回合</h2>
        </div>
        <div className="v2-match-meta">
          <ConnectionState state={state.connectionStatus} />
          <span>状态 {projection.stateVersion}</span>
          <span>事件 {projection.eventSeq}</span>
        </div>
      </header>

      {transportError || state.lastError || commandError ? (
        <p className="v2-error" role="alert">{transportError ?? state.lastError ?? commandError}</p>
      ) : null}

      <section className="v2-players" aria-label="玩家状态">
        {projection.players.map(player => <PlayerSummary key={player.playerId} player={player} active={player.playerId === projection.activePlayerId} />)}
      </section>

      <section className="v2-board-grid" aria-label="牌桌区域">
        <ZonePanel title="对手手牌" count={opponent?.handCount ?? 0} hidden />
        <ZonePanel title="对手基地" objects={baseObjects.filter(object => object.location?.kind === "base" && object.location.playerId !== projection.viewerPlayerId)} />
        <ZonePanel title="战场" objects={battlefieldObjects} />
        <ZonePanel title="我的基地" objects={baseObjects.filter(object => object.location?.kind === "base" && object.location.playerId === projection.viewerPlayerId)} />
        <ZonePanel title="对手符文" objects={runeObjects.filter(object => object.ownerPlayerId !== projection.viewerPlayerId)} />
        <ZonePanel title="我的符文" objects={runeObjects.filter(object => object.ownerPlayerId === projection.viewerPlayerId)} count={viewer?.zoneCounts["rune-zone"] ?? runeObjects.length} />
      </section>

      <section className="v2-hand" aria-label="我的手牌">
        <div className="v2-section-heading">
          <h3>我的手牌</h3>
          <span>{ownHand.length} / {viewer?.handCount ?? ownHand.length}</span>
        </div>
        {ownHand.length === 0 ? <p className="v2-muted">手牌为空</p> : (
          <div className="v2-card-row">
            {ownHand.map(card => (
              <button
                key={card.objectId}
                type="button"
                className={`v2-card${selectedMulliganIds.includes(card.objectId) ? " is-selected" : ""}`}
                disabled={!canPlay || projection.winnerPlayerId !== null}
                onClick={() => {
                  if (setup) {
                    setSelectedMulliganIds(current => current.includes(card.objectId)
                      ? current.filter(id => id !== card.objectId)
                      : [...current, card.objectId]);
                  } else {
                    submit(buildV2PlayCommand(card.objectId));
                  }
                }}
                aria-label={setup ? `选择调度 ${card.name ?? card.cardId ?? card.objectId}` : `打出 ${card.name ?? card.cardId ?? card.objectId}`}
              >
                <strong>{card.name ?? card.cardId ?? "未知卡牌"}</strong>
                <small>{card.faceDown ? "牌面朝下" : card.zone}</small>
                {card.might !== undefined ? <small>战力 {card.might}</small> : null}
              </button>
            ))}
          </div>
        )}
        {setup ? (
          <button
            type="button"
            className="v2-primary-action"
            disabled={!canAct}
            onClick={() => submit(buildV2MulliganCommand(selectedMulliganIds))}
          >
            确认起手（调度 {selectedMulliganIds.length} 张）
          </button>
        ) : null}
      </section>

      <section className="v2-action-row" aria-label="对局操作">
        <button type="button" disabled={!canPass} onClick={() => submit(buildV2PassCommand())}>Pass</button>
        {projection.winnerPlayerId === null ? (
          <button type="button" disabled={!canAct} onClick={() => submit({ type: "concede" })}>认输</button>
        ) : <strong>胜者：{projection.players.find(player => player.playerId === projection.winnerPlayerId)?.name ?? projection.winnerPlayerId}</strong>}
        {busy ? <span role="status">等待命令确认…</span> : null}
      </section>

      <ChoicePanel
        choice={state.choice}
        selectedIds={selectedChoiceIds}
        numberAnswer={numberAnswer}
        disabled={!canAct}
        onNumberChange={setNumberAnswer}
        onToggle={id => setSelectedChoiceIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])}
        onSubmit={() => {
          const answer = buildV2ChoiceAnswer(state.choice.choice, selectedChoiceIds, numberAnswer);
          if (answer === null) return;
          const command = buildV2ChooseCommand(
            state.choice,
            answer,
            `desktop-v2-choose-${state.choice.choice.status === "pending" ? `${state.choice.choice.choiceId}-${state.choice.choice.stateVersion}` : "none"}`
          );
          if (command) submit(command);
        }}
      />

      <ChainPanel projection={projection} />
      <LogPanel projection={projection} events={state.events} />
    </section>
  );
}

function ConnectionState({ state }: { readonly state: V2ClientState["connectionStatus"] }) {
  const label = state === "connected" ? "已连接" : state === "reconnecting" ? "重连中" : state === "connecting" ? "连接中" : "未连接";
  return <span className={`v2-connection v2-connection-${state}`}>{label}</span>;
}

function PlayerSummary({ player, active }: { readonly player: V2PlayerSnapshot; readonly active: boolean }) {
  return (
    <article className={`v2-player${active ? " is-active" : ""}`} aria-label={`${player.name} 状态`}>
      <h3>{player.name}{active ? " · 行动中" : ""}</h3>
      <dl>
        <div><dt>分数</dt><dd>{player.score}</dd></div>
        <div><dt>能量</dt><dd>{player.energy}</dd></div>
        <div><dt>经验</dt><dd>{player.xp}</dd></div>
        <div><dt>手牌</dt><dd>{player.handCount}</dd></div>
        <div><dt>牌库</dt><dd>{player.deckCount}</dd></div>
        <div><dt>符文库</dt><dd>{player.runeDeckCount}</dd></div>
      </dl>
    </article>
  );
}

function ZonePanel({
  title,
  objects = [],
  count = objects.length,
  hidden = false
}: {
  readonly title: string;
  readonly objects?: readonly V2ProjectedObject[];
  readonly count?: number;
  readonly hidden?: boolean;
}) {
  return (
    <article className="v2-zone" aria-label={title}>
      <div className="v2-section-heading"><h3>{title}</h3><span>{count}</span></div>
      {hidden ? <p className="v2-muted">仅显示数量</p> : objects.length === 0 ? <p className="v2-muted">暂无公开牌</p> : (
        <ul>{objects.map(object => <li key={object.objectId}>{object.name ?? object.cardId ?? object.objectId}{object.exhausted ? " · 横置" : ""}</li>)}</ul>
      )}
    </article>
  );
}

function ChoicePanel({
  choice,
  selectedIds,
  numberAnswer,
  disabled,
  onNumberChange,
  onToggle,
  onSubmit
}: {
  readonly choice: V2ChoiceUiState;
  readonly selectedIds: readonly string[];
  readonly numberAnswer: string;
  readonly disabled: boolean;
  readonly onNumberChange: (value: string) => void;
  readonly onToggle: (id: string) => void;
  readonly onSubmit: () => void;
}) {
  if (choice.choice.status === "none") return null;
  const pending = choice.choice;
  const owner = choice.answerable ? "请作出选择" : "等待对手回应";
  const multiple = pending.kind === "select-objects" || pending.kind === "order" || (pending.max ?? 1) > 1;
  const number = pending.kind === "number";
  return (
    <section className="v2-choice" aria-label="选择请求">
      <div className="v2-section-heading"><h3>选择请求</h3><span>{choice.status === "expired" ? "已过期" : owner}</span></div>
      {number ? (
        <input
          aria-label="选择数值"
          type="number"
          min={pending.min}
          max={pending.max}
          value={numberAnswer}
          disabled={disabled || !choice.answerable || choice.status === "expired"}
          onChange={event => onNumberChange(event.currentTarget.value)}
        />
      ) : (
        <div className="v2-choice-options">
          {(pending.options ?? []).length === 0 && pending.kind === "optional" ? (
            <p className="v2-muted">确认是否执行可选效果</p>
          ) : (pending.options ?? []).map(option => (
              <button
                key={option.id}
                type="button"
                aria-pressed={selectedIds.includes(option.id)}
                disabled={disabled || !choice.answerable || choice.status === "expired"}
                onClick={() => onToggle(option.id)}
              >
                {option.label}
              </button>
            ))}
        </div>
      )}
      {pending.min !== undefined || pending.max !== undefined ? <p className="v2-muted">可选数量：{pending.min ?? 0}–{pending.max ?? "不限"}{multiple ? "（可多选）" : ""}</p> : null}
      <button type="button" className="v2-primary-action" disabled={disabled || !choice.answerable || choice.status === "expired"} onClick={onSubmit}>提交选择</button>
    </section>
  );
}

function ChainPanel({ projection }: { readonly projection: V2Projection }) {
  return (
    <section className="v2-chain" aria-label="链与优先权">
      <div className="v2-section-heading"><h3>链 / 优先权</h3><span>{projection.priority.playerId ? `优先权：${projection.priority.playerId}` : "无优先权"}</span></div>
      <p>链状态：{projection.chain.status} · 阶段：{projection.chain.phase} · 窗口：{projection.priority.window}</p>
      {projection.chain.items.length === 0 ? <p className="v2-muted">链为空</p> : <ol>{projection.chain.items.map(item => <li key={item.itemId}>{item.kind} · {item.status}{item.sourceObjectId ? ` · ${item.sourceObjectId}` : ""}</li>)}</ol>}
    </section>
  );
}

function LogPanel({ projection, events }: { readonly projection: V2Projection; readonly events: V2ClientState["events"] }) {
  const allEvents = useMemo(() => {
    const bySeq = new Map<number, V2ClientState["events"][number]>();
    for (const event of projection.events) bySeq.set(event.eventSeq, event);
    for (const event of events) bySeq.set(event.eventSeq, event);
    return [...bySeq.values()].sort((left, right) => left.eventSeq - right.eventSeq);
  }, [events, projection.events]);
  return (
    <section className="v2-log" aria-label="对局日志">
      <div className="v2-section-heading"><h3>对局日志</h3><span>{allEvents.length}</span></div>
      {allEvents.length === 0 ? <p className="v2-muted">暂无事件</p> : <ol>{allEvents.map(event => <li key={event.eventSeq}><span>#{event.eventSeq}</span> {event.timingPoint} <small>{eventSummary(event.payload)}</small></li>)}</ol>}
    </section>
  );
}

function eventSummary(payload: V2EventPayload): string {
  const visible = Object.entries(payload).filter(([, field]) => "value" in field);
  if (visible.length === 0) return "";
  return visible.map(([key, field]) => {
    if (!("value" in field)) return "";
    return `${key}: ${typeof field.value === "string" ? field.value : JSON.stringify(field.value)}`;
  }).filter(Boolean).join(" · ");
}

export function buildV2ChoiceAnswer(choice: V2PendingChoice, selectedIds: readonly string[], numberAnswer: string): V2ChoiceAnswer | null {
  if (choice.status === "none") return null;
  if (choice.kind === "number") {
    const value = Number(numberAnswer);
    return Number.isFinite(value) ? value : null;
  }
  const options = choice.options ?? [];
  if (choice.kind === "optional" && options.length === 0) return true;
  const selected = selectedIds
    .map(id => options.find(option => option.id === id))
    .filter((option): option is V2ChoiceOption => option !== undefined)
    .map(option => choiceOptionAnswer(choice, option));
  if (choice.min !== undefined && selected.length < choice.min) return null;
  if (choice.max !== undefined && selected.length > choice.max) return null;
  if (choice.kind === "select-objects" || choice.kind === "order" || (choice.max ?? 1) > 1) return selected;
  return selected[0] ?? null;
}

function choiceOptionAnswer(choice: Extract<V2PendingChoice, { status: "pending" }>, option: V2ChoiceOption): Exclude<V2ChoiceAnswer, readonly unknown[]> {
  const value = option.value ?? option.id;
  if (choice.kind === "select-objects" && typeof value === "string") return { objectId: value };
  return value;
}

function phaseLabel(phase: V2Projection["phase"]): string {
  const labels: Record<V2Projection["phase"], string> = {
    setup: "启动",
    awaken: "唤醒",
    beginning: "开始",
    channel: "频道",
    draw: "抽牌",
    main: "主要阶段",
    combat: "战斗",
    ending: "结束",
    expiration: "到期",
    ended: "对局结束"
  };
  return labels[phase];
}
