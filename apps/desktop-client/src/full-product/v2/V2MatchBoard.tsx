import { useEffect, useMemo, useState } from "react";
import type {
  ClientSession,
  RoomDeckSubmission,
  RoomView
} from "@riftbound/protocol";
import type {
  V2ChoiceAnswer,
  V2ChoiceOption,
  V2CommandReceipt,
  V2EventPayload,
  V2PendingChoice,
  V2PlayerSnapshot,
  V2ProjectedObject,
  V2Projection,
  V2Target
} from "../../../../../packages/protocol/src/v2/index.js";
import type { CatalogCard } from "../../net/CardCatalogClient";
import {
  buildV2ChooseCommand,
  createV2ClientState,
  type V2ChoiceUiState,
  type V2ClientState
} from "../../state/v2";
import type { V2CommandRequest } from "../../transport/v2";
import {
  buildV2PreconSubmission,
  V2_M1_PRECON_IDS,
  type V2M1PreconId
} from "./m1-precons";
import "./V2MatchBoard.css";

export interface V2MatchBoardProps {
  readonly state: V2ClientState;
  readonly room?: RoomView | null;
  readonly session?: ClientSession | null;
  readonly playerName?: string;
  readonly pendingCommandIds?: readonly string[];
  readonly transportError?: string | null;
  readonly catalogServerUrl?: string;
  readonly serverUrl?: string;
  readonly onServerUrlChange?: (serverUrl: string) => void;
  readonly onConnect?: () => void;
  readonly onCreateRoom?: (playerName: string) => Promise<RoomView>;
  readonly onJoinRoom?: (roomId: string, playerName: string) => Promise<RoomView>;
  readonly onSubmitDeck?: (deck: RoomDeckSubmission) => Promise<RoomView>;
  readonly onSetReady?: (ready: boolean) => Promise<RoomView>;
  readonly onCommand: (request: V2CommandRequest) => Promise<V2CommandReceipt>;
}

export function buildV2PlayCommand(
  cardObjectId: string,
  targets: readonly V2Target[] = []
): V2CommandRequest {
  return { type: "play", cardObjectId, ...(targets.length === 0 ? {} : { targets }) };
}

export function buildV2PassCommand(): V2CommandRequest {
  return { type: "pass" };
}

export function buildV2MulliganCommand(selectedObjectIds: readonly string[]): V2CommandRequest {
  return { type: "mulligan", selectedObjectIds: [...selectedObjectIds] };
}

export function buildV2RuneCommand(
  type: "rune-energy" | "rune-power",
  rune: Pick<V2ProjectedObject, "objectId" | "zoneEntryId">
): V2CommandRequest {
  if (rune.zoneEntryId === undefined) throw new Error("服务端未提供符文 zoneEntryId。");
  return { type, runeObjectId: rune.objectId, zoneEntryId: rune.zoneEntryId };
}

export function buildV2MoveCommand(
  objectId: string,
  destination: { readonly kind: "base"; readonly playerId: string } |
    { readonly kind: "battlefield"; readonly battlefieldId: string }
): V2CommandRequest {
  return {
    type: "move",
    objectId,
    to: destination.kind === "base"
      ? { zone: "base", playerId: destination.playerId }
      : { zone: "battlefield", locationId: destination.battlefieldId }
  };
}

export function buildV2DeclareCombatCommand(
  type: "declare-attack" | "declare-defense",
  battlefieldId: string,
  unitIds: readonly string[]
): V2CommandRequest {
  return type === "declare-attack"
    ? { type, battlefieldId, attackerObjectIds: [...unitIds] }
    : { type, battlefieldId, defenderObjectIds: [...unitIds] };
}

export function visibleV2Objects(
  projection: V2Projection,
  zone: V2ProjectedObject["zone"]
): readonly V2ProjectedObject[] {
  return projection.objects.filter(object => object.zone === zone);
}

export function V2MatchBoard({
  state,
  room = null,
  session = null,
  playerName = "玩家",
  pendingCommandIds = [],
  transportError = null,
  catalogServerUrl = "http://127.0.0.1:8787",
  serverUrl = "ws://127.0.0.1:8787",
  onServerUrlChange,
  onConnect,
  onCreateRoom,
  onJoinRoom,
  onSubmitDeck,
  onSetReady,
  onCommand
}: V2MatchBoardProps) {
  const projection = state.projection;
  const [joinRoomId, setJoinRoomId] = useState("");
  const [selectedPrecon, setSelectedPrecon] = useState<V2M1PreconId>("rumble-sfd");
  const [catalogCards, setCatalogCards] = useState<readonly CatalogCard[]>([]);
  const [catalogStatus, setCatalogStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [lobbyError, setLobbyError] = useState<string | null>(null);
  const [selectedMulliganIds, setSelectedMulliganIds] = useState<readonly string[]>([]);
  const [selectedChoiceIds, setSelectedChoiceIds] = useState<readonly string[]>([]);
  const [optionalChoiceAnswer, setOptionalChoiceAnswer] = useState(true);
  const [numberAnswer, setNumberAnswer] = useState("");
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [selectedDestination, setSelectedDestination] = useState<string>("");
  const [commandError, setCommandError] = useState<string | null>(null);
  const sceneKey = projection === null ? "none" : `${projection.matchId}:${projection.stateVersion}`;
  const busy = pendingCommandIds.length > 0;

  useEffect(() => {
    setSelectedMulliganIds([]);
    setSelectedChoiceIds([]);
    setOptionalChoiceAnswer(true);
    setNumberAnswer("");
    setSelectedCardId(null);
    setSelectedTargetId(null);
    setSelectedUnitId(null);
    setSelectedDestination("");
    setCommandError(null);
  }, [sceneKey]);

  useEffect(() => {
    if (room === null || catalogStatus !== "idle") return;
    setCatalogStatus("loading");
    const base = catalogServerUrl.replace(/^ws/u, "http").replace(/^wss/u, "https").replace(/\/ws\/?$/u, "").replace(/\/$/u, "");
    void fetch(`${base}/api/cards`)
      .then(async response => {
        if (!response.ok) throw new Error(`卡牌目录返回 ${response.status}`);
        return response.json() as Promise<unknown>;
      })
      .then(value => {
        if (value === null || typeof value !== "object" || !Array.isArray((value as { cards?: unknown }).cards)) {
          throw new Error("卡牌目录响应无效。");
        }
        setCatalogCards((value as { cards: CatalogCard[] }).cards);
        setCatalogStatus("ready");
      })
      .catch(caught => {
        setCatalogStatus("error");
        setLobbyError(caught instanceof Error ? caught.message : "无法加载卡牌目录。");
      });
  }, [catalogServerUrl, catalogStatus, room]);

  const submit = (request: V2CommandRequest): void => {
    setCommandError(null);
    void onCommand(request).catch(caught => {
      setCommandError(caught instanceof Error ? caught.message : "命令未能提交。");
    });
  };

  if (projection === null) {
    const connected = state.connectionStatus === "connected";
    const self = room?.players.find(player => player.id === session?.playerId) ?? null;
    const canSubmit = room !== null && catalogStatus === "ready" && self?.deckSubmitted !== true;
    const submitPrecon = (): void => {
      if (!onSubmitDeck || catalogStatus !== "ready") return;
      const built = buildV2PreconSubmission(selectedPrecon, catalogCards);
      if (built.missing.length > 0) {
        setLobbyError(`目录缺少 ${built.missing.length} 个预组印刷，未提交。`);
        return;
      }
      setLobbyError(null);
      void onSubmitDeck(built.deck).catch(caught => setLobbyError(caught instanceof Error ? caught.message : "牌组提交失败。"));
    };
    return (
      <section className="v2-match-board" aria-label="协议 v2 房间与对局">
        <header className="v2-match-header">
          <div><p className="v2-kicker">协议 v2 · 独立会话</p><h2>建房、入座与开局</h2></div>
          <ConnectionState state={state.connectionStatus} />
        </header>
        {transportError || state.lastError || lobbyError ? <p className="v2-error" role="alert">{transportError ?? state.lastError ?? lobbyError}</p> : null}
        {onServerUrlChange ? <section className="v2-action-panel" aria-label="V2 服务地址">
          <form onSubmit={event => {
            event.preventDefault();
            const value = new FormData(event.currentTarget).get("v2-server-url");
            if (typeof value === "string" && value.trim()) {
              onServerUrlChange(value.trim());
            }
          }}>
            <label>V2 服务地址 <input name="v2-server-url" defaultValue={serverUrl} spellCheck={false} /></label>
            <button type="submit">连接</button>
          </form>
        </section> : null}
        {!connected && onConnect ? <button type="button" className="v2-primary-action" onClick={onConnect}>连接 V2 服务</button> : null}
        {connected && room === null ? (
          <section className="v2-lobby" aria-label="V2 房间入口">
            <button type="button" className="v2-primary-action" disabled={!onCreateRoom} onClick={() => {
              setLobbyError(null);
              void onCreateRoom?.(playerName).catch(caught => setLobbyError(caught instanceof Error ? caught.message : "建房失败。"));
            }}>创建 1v1 房间</button>
            <form onSubmit={event => {
              event.preventDefault();
              if (!joinRoomId.trim()) return;
              setLobbyError(null);
              void onJoinRoom?.(joinRoomId.trim(), playerName).catch(caught => setLobbyError(caught instanceof Error ? caught.message : "加入失败。"));
            }}>
              <label>房间号 <input value={joinRoomId} onChange={event => setJoinRoomId(event.currentTarget.value)} /></label>
              <button type="submit" disabled={!onJoinRoom || !joinRoomId.trim()}>加入房间</button>
            </form>
          </section>
        ) : null}
        {room !== null ? (
          <section className="v2-lobby" aria-label="V2 开局准备">
            <h3>房间 {room.roomId}</h3>
            <p>状态：{room.status} · 房间版本 {room.roomVersion}</p>
            <label>M1 预组 <select value={selectedPrecon} onChange={event => setSelectedPrecon(event.currentTarget.value as V2M1PreconId)}>
              {V2_M1_PRECON_IDS.map(id => <option key={id} value={id}>{id}</option>)}
            </select></label>
            <button type="button" disabled={!canSubmit || busy} onClick={submitPrecon}>提交预组牌组</button>
            <button type="button" disabled={!onSetReady || self?.deckSubmitted !== true || self.ready || busy} onClick={() => {
              void onSetReady?.(true).catch(caught => setLobbyError(caught instanceof Error ? caught.message : "准备失败。"));
            }}>准备</button>
            {catalogStatus === "loading" ? <p role="status">正在加载服务端卡牌目录…</p> : null}
            {catalogStatus === "error" ? <p className="v2-muted">无法从服务端目录生成预组；不会提交本地猜测的印刷 ID。</p> : null}
          </section>
        ) : null}
        <p className="v2-empty-state">双方提交合法 M1 预组并准备后，服务端会开始权威对局并下发投影。</p>
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
  const ownRunes = runeObjects.filter(object => object.ownerPlayerId === projection.viewerPlayerId);
  const opponentRunes = runeObjects.filter(object => object.ownerPlayerId !== projection.viewerPlayerId);
  const ownUnits = [...baseObjects, ...battlefieldObjects].filter(object =>
    (object.controllerPlayerId ?? object.ownerPlayerId) === projection.viewerPlayerId);
  const targetCandidates = projectedTargetCandidates(projection);
  const destinationOptions = projectedMoveDestinations(projection);
  const setup = projection.phase === "setup";
  const hasPriority = projection.priority.playerId === projection.viewerPlayerId;
  const choiceOpen = projection.pendingChoice.status === "none";
  const canAct = state.connectionStatus === "connected" && projection.winnerPlayerId === null && !busy;
  const canPass = canAct && hasPriority && choiceOpen;
  const canPlay = setup ? canAct : canAct && hasPriority && choiceOpen;
  const selectedCard = ownHand.find(card => card.objectId === selectedCardId) ?? null;
  const selectedTarget = targetCandidates.find(object => object.objectId === selectedTargetId) ?? null;

  return (
    <section className="v2-match-board" aria-label="协议 v2 对局">
      <header className="v2-match-header">
        <div><p className="v2-kicker">协议 v2 · {projection.rulesetVersion}</p><h2>{phaseLabel(projection.phase)} · 第 {projection.turnNumber} 回合</h2></div>
        <div className="v2-match-meta"><ConnectionState state={state.connectionStatus} /><span>状态 {projection.stateVersion}</span><span>事件 {projection.eventSeq}</span></div>
      </header>
      {transportError || state.lastError || commandError ? <p className="v2-error" role="alert">{transportError ?? state.lastError ?? commandError}</p> : null}
      <section className="v2-players" aria-label="玩家状态">
        {projection.players.map(player => <PlayerSummary key={player.playerId} player={player} active={player.playerId === projection.activePlayerId} priority={player.playerId === projection.priority.playerId} score={projection.scoring.players.find(value => value.playerId === player.playerId)?.points ?? player.score} />)}
      </section>
      <section className="v2-board-grid" aria-label="牌桌区域">
        <ZonePanel title="对手手牌" count={opponent?.handCount ?? 0} hidden />
        <ZonePanel title="对手基地" objects={baseObjects.filter(object => object.location?.kind === "base" && object.location.playerId !== projection.viewerPlayerId)} />
        <ZonePanel title="战场" objects={battlefieldObjects} />
        <ZonePanel title="我的基地" objects={baseObjects.filter(object => object.location?.kind === "base" && object.location.playerId === projection.viewerPlayerId)} />
        <ZonePanel title="对手公开符文" objects={opponentRunes} />
        <ZonePanel title="我的符文" objects={ownRunes} count={viewer?.zoneCounts["rune-zone"] ?? ownRunes.length} />
      </section>
      <section className="v2-hand" aria-label="我的手牌">
        <div className="v2-section-heading"><h3>我的手牌</h3><span>{ownHand.length} / {viewer?.handCount ?? ownHand.length}</span></div>
        {ownHand.length === 0 ? <p className="v2-muted">手牌为空</p> : (
          <div className="v2-card-row">{ownHand.map(card => <button key={card.objectId} type="button"
            className={`v2-card${selectedMulliganIds.includes(card.objectId) || selectedCardId === card.objectId ? " is-selected" : ""}`}
            disabled={!canPlay} onClick={() => {
              if (setup) setSelectedMulliganIds(current => current.includes(card.objectId) ? current.filter(id => id !== card.objectId) : [...current, card.objectId]);
              else setSelectedCardId(current => current === card.objectId ? null : card.objectId);
            }} aria-label={setup ? `选择调度 ${card.name ?? card.cardId ?? card.objectId}` : `选择打出 ${card.name ?? card.cardId ?? card.objectId}`}>
            <strong>{card.name ?? card.cardId ?? "未知卡牌"}</strong><small>{card.faceDown ? "牌面朝下" : card.zone}</small>{card.might !== undefined ? <small>战力 {card.might}</small> : null}
          </button>)}</div>
        )}
        {setup ? <button type="button" className="v2-primary-action" disabled={!canAct} onClick={() => submit(buildV2MulliganCommand(selectedMulliganIds))}>确认起手（调度 {selectedMulliganIds.length} 张）</button> : null}
      </section>
      {!setup ? <section className="v2-action-panel" aria-label="出牌目标" data-v2-ui-hook="play-card-placement-and-target-candidates">
        <div className="v2-section-heading"><h3>出牌</h3><span>{selectedCard?.name ?? "先选择手牌"}</span></div>
        {targetCandidates.length > 0 ? <div className="v2-choice-options" aria-label="服务端投影候选目标">{targetCandidates.map(target => <button key={target.objectId} type="button" aria-pressed={selectedTargetId === target.objectId} onClick={() => setSelectedTargetId(target.objectId)}>{target.name ?? target.cardId ?? target.objectId}</button>)}</div> : <p className="v2-muted">投影未公布出牌目标候选；将提交基础 play，由服务端校验/拒绝。</p>}
        <button type="button" className="v2-primary-action" disabled={!canPlay || selectedCard === null} onClick={() => {
          if (!selectedCard) return;
          const zoneEntryId = selectedTarget?.zoneEntryId;
          submit(buildV2PlayCommand(selectedCard.objectId, selectedTarget ? [{ kind: "object", objectId: selectedTarget.objectId, ...(zoneEntryId === undefined ? {} : { zoneEntryId }) }] : []));
        }}>打出手牌</button>
      </section> : null}
      <section className="v2-action-panel" aria-label="符文操作">
        <div className="v2-section-heading"><h3>符文</h3><span>能量 {viewer?.energy ?? 0} · Power {formatPower(viewer?.power ?? {})}</span></div>
        {ownRunes.length === 0 ? <p className="v2-muted">没有公开的我方符文。符文区顺序由服务端隐藏，只显示投影对象。</p> : <div className="v2-choice-options">{ownRunes.map(rune => <div key={rune.objectId}><strong>{rune.name ?? rune.cardId ?? rune.objectId}</strong><button type="button" disabled={!canAct || rune.zoneEntryId === undefined || rune.exhausted === true} onClick={() => submit(buildV2RuneCommand("rune-energy", rune))}>取能量</button><button type="button" disabled={!canAct || rune.zoneEntryId === undefined || rune.exhausted === true} onClick={() => submit(buildV2RuneCommand("rune-power", rune))}>取 Power</button></div>)}</div>}
      </section>
      <section className="v2-action-panel" aria-label="战斗操作" data-v2-ui-hook="combat-declaration-and-advancement">
        <div className="v2-section-heading"><h3>战斗</h3><span>{selectedUnitId ?? "选择单位"}</span></div>
        <label>战场 <select aria-label="战斗战场" value={selectedDestination.startsWith("battlefield:") ? selectedDestination : ""} onChange={event => setSelectedDestination(event.currentTarget.value)}><option value="">选择</option>{destinationOptions.filter(destination => destination.value.kind === "battlefield").map(destination => <option key={destination.id} value={destination.id}>{destination.label}</option>)}</select></label>
        <div className="v2-choice-options">
          <button type="button" disabled={!canAct || selectedUnitId === null || !selectedDestination.startsWith("battlefield:")} onClick={() => {
            const destination = destinationOptions.find(value => value.id === selectedDestination);
            if (selectedUnitId && destination?.value.kind === "battlefield") submit(buildV2DeclareCombatCommand("declare-attack", destination.value.battlefieldId, [selectedUnitId]));
          }}>宣告攻击</button>
          <button type="button" disabled={!canAct || selectedUnitId === null || !selectedDestination.startsWith("battlefield:")} onClick={() => {
            const destination = destinationOptions.find(value => value.id === selectedDestination);
            if (selectedUnitId && destination?.value.kind === "battlefield") submit(buildV2DeclareCombatCommand("declare-defense", destination.value.battlefieldId, [selectedUnitId]));
          }}>宣告防守</button>
        </div>
      </section>
      <section className="v2-action-panel" aria-label="移动操作">
        <div className="v2-section-heading"><h3>移动</h3><span>{selectedUnitId ?? "选择单位与目的地"}</span></div>
        <div className="v2-choice-options">{ownUnits.map(unit => <button key={unit.objectId} type="button" aria-pressed={selectedUnitId === unit.objectId} onClick={() => setSelectedUnitId(unit.objectId)}>{unit.name ?? unit.cardId ?? unit.objectId}</button>)}</div>
        <label>目的地 <select value={selectedDestination} onChange={event => setSelectedDestination(event.currentTarget.value)}><option value="">选择</option>{destinationOptions.map(destination => <option key={destination.id} value={destination.id}>{destination.label}</option>)}</select></label>
        <button type="button" disabled={!canAct || selectedUnitId === null || selectedDestination === ""} onClick={() => {
          const destination = destinationOptions.find(value => value.id === selectedDestination);
          if (destination) submit(buildV2MoveCommand(selectedUnitId!, destination.value));
        }}>移动单位</button>
      </section>
      <section className="v2-action-row" aria-label="对局操作">
        <button type="button" disabled={!canPass} onClick={() => submit(buildV2PassCommand())}>Pass</button>
        {projection.winnerPlayerId === null ? <button type="button" disabled={!canAct} onClick={() => submit({ type: "concede" })}>认输</button> : <strong>胜者：{projection.players.find(player => player.playerId === projection.winnerPlayerId)?.name ?? projection.winnerPlayerId}</strong>}
        {busy ? <span role="status">等待命令确认…</span> : null}
      </section>
      <ChoicePanel choice={state.choice} selectedIds={selectedChoiceIds} numberAnswer={numberAnswer} optionalAnswer={optionalChoiceAnswer} disabled={!canAct}
        onNumberChange={setNumberAnswer}
        onOptionalAnswerChange={setOptionalChoiceAnswer}
        onToggle={id => setSelectedChoiceIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])}
        onSubmit={() => {
          const answer = buildV2ChoiceAnswer(state.choice.choice, selectedChoiceIds, numberAnswer, optionalChoiceAnswer);
          if (answer === null) return;
          const command = buildV2ChooseCommand(state.choice, answer, `desktop-v2-choose-${state.choice.choice.status === "pending" ? `${state.choice.choice.choiceId}-${state.choice.choice.stateVersion}` : "none"}`);
          if (command) submit(command);
        }} />
      <ChainPanel projection={projection} />
      <LogPanel projection={projection} events={state.events} />
    </section>
  );
}

function projectedTargetCandidates(projection: V2Projection): readonly V2ProjectedObject[] {
  if (projection.pendingChoice.status !== "pending" || projection.pendingChoice.kind !== "select-objects") return [];
  const byId = new Map(projection.objects.map(object => [object.objectId, object]));
  return (projection.pendingChoice.options ?? []).flatMap(option => {
    const object = byId.get(typeof option.value === "string" ? option.value : option.id);
    return object === undefined || object.visibility !== "public" ? [] : [object];
  });
}

function projectedMoveDestinations(projection: V2Projection): readonly {
  readonly id: string;
  readonly label: string;
  readonly value: { readonly kind: "base"; readonly playerId: string } | { readonly kind: "battlefield"; readonly battlefieldId: string };
}[] {
  const base = projection.viewerPlayerId ? [{ id: `base:${projection.viewerPlayerId}`, label: "我的基地", value: { kind: "base" as const, playerId: projection.viewerPlayerId } }] : [];
  return [...base, ...projection.scoring.battlefieldLocationIds.map(id => ({ id: `battlefield:${id}`, label: `战场 ${id}`, value: { kind: "battlefield" as const, battlefieldId: id } }))];
}

function ConnectionState({ state }: { readonly state: V2ClientState["connectionStatus"] }) {
  const label = state === "connected" ? "已连接" : state === "reconnecting" ? "重连中" : state === "connecting" ? "连接中" : "未连接";
  return <span className={`v2-connection v2-connection-${state}`}>{label}</span>;
}

function PlayerSummary({ player, active, priority, score }: { readonly player: V2PlayerSnapshot; readonly active: boolean; readonly priority: boolean; readonly score: number }) {
  return <article className={`v2-player${active ? " is-active" : ""}${priority ? " has-priority" : ""}`} aria-label={`${player.name} 状态`}>
    <h3>{player.name}{active ? " · 行动中" : ""}{priority ? " · 有优先权" : ""}</h3>
    <dl><div><dt>比分</dt><dd>{score}</dd></div><div><dt>能量</dt><dd>{player.energy}</dd></div><div><dt>经验</dt><dd>{player.xp}</dd></div><div><dt>手牌</dt><dd>{player.handCount}</dd></div><div><dt>牌库</dt><dd>{player.deckCount}</dd></div><div><dt>符文库</dt><dd>{player.runeDeckCount}</dd></div></dl>
  </article>;
}

function ZonePanel({ title, objects = [], count = objects.length, hidden = false }: { readonly title: string; readonly objects?: readonly V2ProjectedObject[]; readonly count?: number; readonly hidden?: boolean }) {
  return <article className="v2-zone" aria-label={title}><div className="v2-section-heading"><h3>{title}</h3><span>{count}</span></div>{hidden ? <p className="v2-muted">仅显示数量</p> : objects.length === 0 ? <p className="v2-muted">暂无公开牌</p> : <ul>{objects.map(object => <li key={object.objectId}>{object.name ?? object.cardId ?? object.objectId}{object.exhausted ? " · 横置" : ""}</li>)}</ul>}</article>;
}

function ChoicePanel({ choice, selectedIds, numberAnswer, optionalAnswer, disabled, onNumberChange, onOptionalAnswerChange, onToggle, onSubmit }: { readonly choice: V2ChoiceUiState; readonly selectedIds: readonly string[]; readonly numberAnswer: string; readonly optionalAnswer: boolean; readonly disabled: boolean; readonly onNumberChange: (value: string) => void; readonly onOptionalAnswerChange: (value: boolean) => void; readonly onToggle: (id: string) => void; readonly onSubmit: () => void }) {
  if (choice.choice.status === "none") return null;
  const pending = choice.choice;
  const multiple = pending.kind === "select-objects" || pending.kind === "order" || (pending.max ?? 1) > 1;
  return <section className="v2-choice" aria-label="选择请求"><div className="v2-section-heading"><h3>选择请求 · {choiceKindLabel(pending.kind)}</h3><span>{choice.status === "expired" ? "已过期" : choice.answerable ? "请作出选择" : "等待对手回应"}</span></div>
    {pending.kind === "number" ? <input aria-label="选择数值" type="number" min={pending.min} max={pending.max} value={numberAnswer} disabled={disabled || !choice.answerable || choice.status === "expired"} onChange={event => onNumberChange(event.currentTarget.value)} /> :
      <div className="v2-choice-options">{(pending.options ?? []).length === 0 && pending.kind === "optional" ? <><button type="button" aria-pressed={optionalAnswer} disabled={disabled || !choice.answerable || choice.status === "expired"} onClick={() => onOptionalAnswerChange(true)}>接受</button><button type="button" aria-pressed={!optionalAnswer} disabled={disabled || !choice.answerable || choice.status === "expired"} onClick={() => onOptionalAnswerChange(false)}>拒绝</button></> : (pending.options ?? []).map(option => <button key={option.id} type="button" aria-pressed={selectedIds.includes(option.id)} disabled={disabled || !choice.answerable || choice.status === "expired"} onClick={() => onToggle(option.id)}>{option.label}</button>)}</div>}
    {pending.min !== undefined || pending.max !== undefined ? <p className="v2-muted">可选数量：{pending.min ?? 0}–{pending.max ?? "不限"}{multiple ? "（可多选）" : ""}</p> : null}
    <button type="button" className="v2-primary-action" disabled={disabled || !choice.answerable || choice.status === "expired"} onClick={onSubmit}>提交选择</button>
  </section>;
}

function choiceKindLabel(kind: Extract<V2PendingChoice, { status: "pending" }>["kind"]): string {
  return { optional: "可选效果", mode: "模式", "select-objects": "选择对象", order: "排序", number: "数值" }[kind];
}

function ChainPanel({ projection }: { readonly projection: V2Projection }) {
  return <section className="v2-chain" aria-label="链与优先权"><div className="v2-section-heading"><h3>链 / 优先权</h3><span>{projection.priority.playerId ? `优先权：${projection.priority.playerId}` : "无优先权"}</span></div><p>链状态：{projection.chain.status} · 阶段：{projection.chain.phase} · 窗口：{projection.priority.window} · Focus：{projection.priority.focusPlayerId ?? "无"}</p>{projection.chain.items.length === 0 ? <p className="v2-muted">链为空</p> : <ol>{projection.chain.items.map(item => <li key={item.itemId}>{item.kind} · {item.status}{item.sourceObjectId ? ` · ${item.sourceObjectId}` : ""}</li>)}</ol>}</section>;
}

function LogPanel({ projection, events }: { readonly projection: V2Projection; readonly events: V2ClientState["events"] }) {
  const allEvents = useMemo(() => {
    const bySeq = new Map<number, V2ClientState["events"][number]>();
    for (const event of projection.events) bySeq.set(event.eventSeq, event);
    for (const event of events) bySeq.set(event.eventSeq, event);
    return [...bySeq.values()].sort((left, right) => left.eventSeq - right.eventSeq);
  }, [events, projection.events]);
  return <section className="v2-log" aria-label="对局日志"><div className="v2-section-heading"><h3>对局日志</h3><span>{allEvents.length}</span></div>{allEvents.length === 0 ? <p className="v2-muted">暂无事件</p> : <ol>{allEvents.map(event => <li key={event.eventSeq}><span>#{event.eventSeq}</span> {event.timingPoint} <small>{eventSummary(event.payload)}</small></li>)}</ol>}</section>;
}

function eventSummary(payload: V2EventPayload): string {
  return Object.entries(payload).flatMap(([key, field]) => "value" in field ? [`${key}: ${typeof field.value === "string" ? field.value : JSON.stringify(field.value)}`] : []).join(" · ");
}

export function buildV2ChoiceAnswer(choice: V2PendingChoice, selectedIds: readonly string[], numberAnswer: string, optionalAnswer = true): V2ChoiceAnswer | null {
  if (choice.status === "none") return null;
  if (choice.kind === "number") {
    if (numberAnswer.trim() === "") return null;
    const value = Number(numberAnswer);
    return Number.isSafeInteger(value) ? value : null;
  }
  const options = choice.options ?? [];
  if (choice.kind === "optional" && options.length === 0) return optionalAnswer;
  const selected = selectedIds.map(id => options.find(option => option.id === id)).filter((option): option is V2ChoiceOption => option !== undefined).map(option => choiceOptionAnswer(choice, option));
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

function formatPower(power: Readonly<Record<string, number>>): string {
  return Object.entries(power).map(([domain, amount]) => `${domain} ${amount}`).join(" / ") || "无";
}

function phaseLabel(phase: V2Projection["phase"]): string {
  const labels: Record<V2Projection["phase"], string> = { setup: "启动", awaken: "唤醒", beginning: "开始", channel: "频道", draw: "抽牌", main: "主要阶段", combat: "战斗", ending: "结束", expiration: "到期", ended: "对局结束" };
  return labels[phase];
}
