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
  V2MoveOption,
  V2PendingChoice,
  V2PlayerSnapshot,
  V2PlayOption,
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
  readonly lastReceipt?: V2CommandReceipt | null;
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
  readonly onLeaveRoom?: () => void;
  /** Test/static-render seam for a preselected hand incarnation; still validated against the projection. */
  readonly initialSelectedCardId?: string | null;
  /** Test/static-render seam for allocation input; still validated against the projection. */
  readonly initialCombatDamageDrafts?: Readonly<Record<string, string>>;
  /** Test/static-render seam for an open concede confirmation. */
  readonly initialConcedeConfirmationOpen?: boolean;
  readonly onCommand: (request: V2CommandRequest) => Promise<V2CommandReceipt>;
}

export function buildV2PlayCommand(
  cardObjectId: string,
  targets: readonly V2Target[] = [],
  destination?: V2PlayOption["destination"]
): V2CommandRequest {
  return { type: "play", cardObjectId, ...(destination === undefined ? {} : { destination }),
    ...(targets.length === 0 ? {} : { targets }) };
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

export function buildV2EndTurnCommand(): V2CommandRequest {
  return { type: "end-turn" };
}

export function buildV2AdvanceCommand(): V2CommandRequest {
  return { type: "advance" };
}

export interface V2CombatDamageDraft {
  readonly unitObjectId: string;
  readonly amount: string;
}

/** Build only client-shape checks; the server remains authoritative for assignment legality. */
export function buildV2CombatDamageCommand(
  combatId: string,
  expectedAmount: number,
  drafts: readonly V2CombatDamageDraft[]
): V2CommandRequest | null {
  if (!combatId || !Number.isSafeInteger(expectedAmount) || expectedAmount < 0 || drafts.length === 0) return null;
  const assignments: { readonly unitObjectId: string; readonly amount: number }[] = [];
  const seen = new Set<string>();
  for (const draft of drafts) {
    if (!draft.unitObjectId || seen.has(draft.unitObjectId) || !/^[1-9]\d*$/u.test(draft.amount)) return null;
    const amount = Number(draft.amount);
    if (!Number.isSafeInteger(amount)) return null;
    seen.add(draft.unitObjectId);
    assignments.push({ unitObjectId: draft.unitObjectId, amount });
  }
  const total = assignments.reduce((sum, assignment) => sum + assignment.amount, 0);
  if (!Number.isSafeInteger(total) || total !== expectedAmount) return null;
  return { type: "combat-damage", combatId, assignments };
}

export function visibleV2Objects(
  projection: V2Projection,
  zone: V2ProjectedObject["zone"]
): readonly V2ProjectedObject[] {
  return projection.objects.filter(object => object.zone === zone);
}

function playDestinationKey(destination: V2PlayOption["destination"]): string {
  return destination.kind === "base" ? `base:${destination.playerId}` : `battlefield:${destination.battlefieldId}`;
}

/** Build a play command only when the projection offers the exact card and destination. */
export function buildProjectedV2PlayCommand(
  projection: V2Projection,
  cardObjectId: string,
  destination: V2PlayOption["destination"] | undefined,
  targets: readonly V2Target[] = []
): V2CommandRequest | null {
  const option = projection.actionOptions.plays.find(candidate => candidate.cardObjectId === cardObjectId &&
    (candidate.requiresDestination === false ||
      candidate.destination.kind === destination?.kind &&
      (candidate.destination.kind === "base" && destination?.kind === "base" && candidate.destination.playerId === destination.playerId ||
        candidate.destination.kind === "battlefield" && destination?.kind === "battlefield" &&
          candidate.destination.battlefieldId === destination.battlefieldId)));
  if (option === undefined) return null;
  let ordered = targets;
  if (option.targetRequirements !== undefined) {
    const remaining = [...targets];
    ordered = option.targetRequirements.flatMap(requirement => {
      const matches = (target: V2Target) => target.kind === "object" && requirement.options.some(candidate =>
        candidate.objectRef?.objectId === target.objectId && candidate.objectRef.zoneEntryId === target.zoneEntryId);
      const selected = remaining.filter(matches);
      for (let index = remaining.length - 1; index >= 0; index -= 1) {
        if (matches(remaining[index]!)) remaining.splice(index, 1);
      }
      return selected;
    });
    if (remaining.length > 0 || option.targetRequirements.some(requirement => {
      const count = targets.filter(target => target.kind === "object" && requirement.options.some(candidate =>
        candidate.objectRef?.objectId === target.objectId && candidate.objectRef.zoneEntryId === target.zoneEntryId)).length;
      return count < requirement.min || count > requirement.max;
    })) return null;
  }
  return buildV2PlayCommand(cardObjectId, ordered, option.requiresDestination === false ? undefined : option.destination);
}

export function V2MatchBoard({
  state,
  lastReceipt = null,
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
  onLeaveRoom,
  initialSelectedCardId = null,
  initialCombatDamageDrafts = {},
  initialConcedeConfirmationOpen = false,
  onCommand
}: V2MatchBoardProps) {
  const projection = state.projection;
  const [joinRoomId, setJoinRoomId] = useState("");
  // Both clients defaulted to the same profile name, so the board showed two
  // players called "玩家" (RIFT-1055); the lobby lets each player set theirs.
  const [seatName, setSeatName] = useState(playerName);
  const [selectedPrecon, setSelectedPrecon] = useState<V2M1PreconId>("rumble-sfd");
  const [catalogCards, setCatalogCards] = useState<readonly CatalogCard[]>([]);
  const [catalogStatus, setCatalogStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [lobbyError, setLobbyError] = useState<string | null>(null);
  const [selectedMulliganIds, setSelectedMulliganIds] = useState<readonly string[]>([]);
  const [selectedChoiceIds, setSelectedChoiceIds] = useState<readonly string[]>([]);
  const [optionalChoiceAnswer, setOptionalChoiceAnswer] = useState(true);
  const [numberAnswer, setNumberAnswer] = useState("");
  const [selectedCardId, setSelectedCardId] = useState<string | null>(initialSelectedCardId);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [selectedPlayTargets, setSelectedPlayTargets] = useState<Readonly<Record<string, readonly string[]>>>({});
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [selectedDestination, setSelectedDestination] = useState<string>("");
  const [selectedPlayDestination, setSelectedPlayDestination] = useState<string>("");
  const [combatDamageDrafts, setCombatDamageDrafts] = useState<Readonly<Record<string, string>>>(initialCombatDamageDrafts);
  const [concedeConfirmationOpen, setConcedeConfirmationOpen] = useState(initialConcedeConfirmationOpen);
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
    setSelectedPlayTargets({});
    setSelectedUnitId(null);
    setSelectedDestination("");
    setSelectedPlayDestination("");
    setCombatDamageDrafts({});
    setConcedeConfirmationOpen(false);
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
            <label>玩家名 <input value={seatName} maxLength={32} onChange={event => setSeatName(event.currentTarget.value)} /></label>
            <button type="button" className="v2-primary-action" disabled={!onCreateRoom || !seatName.trim()} onClick={() => {
              setLobbyError(null);
              void onCreateRoom?.(seatName.trim()).catch(caught => setLobbyError(caught instanceof Error ? caught.message : "建房失败。"));
            }}>创建 1v1 房间</button>
            <form onSubmit={event => {
              event.preventDefault();
              if (!joinRoomId.trim() || !seatName.trim()) return;
              setLobbyError(null);
              void onJoinRoom?.(joinRoomId.trim(), seatName.trim()).catch(caught => setLobbyError(caught instanceof Error ? caught.message : "加入失败。"));
            }}>
              <label>房间号 <input value={joinRoomId} onChange={event => setJoinRoomId(event.currentTarget.value)} /></label>
              <button type="submit" disabled={!onJoinRoom || !joinRoomId.trim() || !seatName.trim()}>加入房间</button>
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
            {onLeaveRoom ? <button type="button" onClick={onLeaveRoom}>离开房间</button> : null}
            {catalogStatus === "loading" ? <p role="status">正在加载服务端卡牌目录…</p> : null}
            {catalogStatus === "error" ? <p className="v2-muted">无法从服务端目录生成预组；不会提交本地猜测的印刷 ID。</p> : null}
          </section>
        ) : null}
        <p className="v2-empty-state">双方提交合法 M1 预组并准备后，服务端会依次开放换牌窗口；双方确认后才开始正式对局。</p>
      </section>
    );
  }

  const viewer = projection.players.find(player => player.playerId === projection.viewerPlayerId) ?? null;
  const opponent = projection.players.find(player => player.playerId !== projection.viewerPlayerId) ?? null;
  const ownHand = projection.zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === projection.viewerPlayerId)?.objects ??
    projection.objects.filter(object => object.zone === "hand" && object.ownerPlayerId === projection.viewerPlayerId);
  // Permanents sit in the "board" zone wherever they are; where they are comes
  // from `location`, so units and gear in a base must not be listed as being on
  // a battlefield (found in a real two-browser M1 run, RIFT-1055).
  const boardObjects = [...visibleV2Objects(projection, "base"), ...visibleV2Objects(projection, "battlefield"),
    ...visibleV2Objects(projection, "board")];
  const baseObjects = boardObjects.filter(object => baseOwnerOf(object) !== null);
  const battlefieldObjects = boardObjects.filter(object => object.location?.kind === "battlefield");
  const battlefieldPanels = projectedBattlefieldPanels(projection, boardObjects);
  const runeObjects = visibleV2Objects(projection, "rune-zone");
  const ownRunes = runeObjects.filter(object => object.ownerPlayerId === projection.viewerPlayerId);
  const opponentRunes = runeObjects.filter(object => object.ownerPlayerId !== projection.viewerPlayerId);
  const ownUnits = [...baseObjects, ...battlefieldObjects].filter(object =>
    (object.controllerPlayerId ?? object.ownerPlayerId) === projection.viewerPlayerId);
  const objectName = (objectId: string): string => {
    const object = projection.objects.find(candidate => candidate.objectId === objectId);
    return object?.name ?? object?.cardId ?? objectId;
  };
  const targetCandidates = projectedTargetCandidates(projection);
  // Plain derivations, not hooks: this code runs only after the
  // `projection === null` early return above, so a hook here would change the
  // hook count when the match starts and crash the board (RIFT-1047).
  const playOptions = selectedCardId === null ? [] :
    projection.actionOptions.plays.filter(option => option.cardObjectId === selectedCardId);
  const playDestinationOptions = (() => {
    const groups = new Map<string, readonly V2PlayOption[]>();
    for (const option of playOptions) {
      if (option.requiresDestination === false) continue;
      const key = playDestinationKey(option.destination);
      groups.set(key, [...(groups.get(key) ?? []), option]);
    }
    return [...groups].map(([key, options]) => ({
      key, options,
      label: locationLabel(projection, options[0]!.destination)
    }));
  })();
  const selectedPlayDestinationOption = playDestinationOptions.find(option => option.key === selectedPlayDestination) ??
    (playDestinationOptions.length === 1 ? playDestinationOptions[0]! : null);
  const selectedPlayOption = playOptions.find(option => option.requiresDestination === false) ??
    selectedPlayDestinationOption?.options[0] ?? null;
  const playTargetRequirements = selectedPlayOption?.targetRequirements ?? [];
  const selectedPlayTargetRefs = playTargetRequirements.flatMap(requirement => {
    const selected = selectedPlayTargets[requirement.id] ?? [];
    return selected.flatMap(refKey => {
      const option = requirement.options.find(candidate =>
        `${candidate.objectRef?.objectId}:${String(candidate.objectRef?.zoneEntryId)}` === refKey);
      return option?.objectRef === undefined ? [] : [option.objectRef];
    });
  });
  // Movement is offered only as the server publishes it in actionOptions.moves:
  // a battlefield card or a unit without a legal Standard Move is not listed.
  const legalMoves = projection.actionOptions?.moves ?? [];
  const movableUnits = ownUnits.filter(unit => legalMoves.some(move => move.objectId === unit.objectId));
  const destinationOptions = projectedMoveDestinations(projection).filter(destination =>
    selectedUnitId !== null && legalMoves.some(move => move.objectId === selectedUnitId &&
      sameMoveDestination(move.destination, destination.value)));
  const setup = projection.phase === "setup";
  const mulliganOpen = setup && projection.pendingChoice.status === "pending" &&
    projection.pendingChoice.kind === "select-objects" &&
    projection.pendingChoice.ownerPlayerId === projection.viewerPlayerId;
  const mulliganSelection = setup && mulliganOpen ? projection.pendingChoice : null;
  const selectedMulliganChoices = mulliganSelection?.status === "pending"
    ? selectedMulliganIds.flatMap(id => {
        const option = mulliganSelection.options?.find(candidate => candidate.id === id);
        return option?.objectRef === undefined ? [] : [option.objectRef];
      })
    : [];
  const hasPriority = projection.priority.playerId === projection.viewerPlayerId;
  const choiceOpen = projection.pendingChoice.status === "none";
  const choiceExpired = state.choice.status === "expired";
  const canAct = state.connectionStatus === "connected" && projection.winnerPlayerId === null && !busy;
  const canPass = canAct && hasPriority && choiceOpen && !choiceExpired;
  const canPlay = !setup && canAct && hasPriority && choiceOpen && !choiceExpired;
  const canChooseMulligan = setup ? canAct && mulliganOpen && !choiceExpired : false;
  const canEndTurn = canAct && projection.actionOptions?.canEndTurn === true && choiceOpen && !choiceExpired;
  const canAdvance = canAct && projection.actionOptions?.canAdvance === true && choiceOpen && !choiceExpired;
  const combatDamage = projection.combat?.status === "active" && projection.combat.step === "damage" &&
    projection.combat.combatId !== undefined && projection.combat.damage !== undefined &&
    projection.combat.damage.expectedPlayerId === projection.viewerPlayerId ? projection.combat.damage : null;
  const combatDamageSide = combatDamage === null ? null :
    projection.combat?.attackerPlayerId === projection.viewerPlayerId ? "attacker" :
      projection.combat?.defenderPlayerId === projection.viewerPlayerId ? "defender" : null;
  const combatDamageBudget = combatDamage === null || combatDamageSide === null ? null :
    combatDamageSide === "attacker" ? combatDamage.attackerMight : combatDamage.defenderMight;
  const combatDamageTargets = combatDamageSide === null ? [] : battlefieldObjects.filter(object =>
    (object.controllerPlayerId ?? object.ownerPlayerId) !== projection.viewerPlayerId &&
    object.might !== undefined &&
    object.location?.kind === "battlefield" && object.location.battlefieldId === projection.combat?.battlefieldId &&
    projection.battlefields?.find(field => field.battlefieldId === projection.combat?.battlefieldId)
      ?.occupantObjectIds.includes(object.objectId) === true);
  const combatDamageCommand = combatDamage === null || projection.combat?.combatId === undefined || combatDamageBudget === null ? null :
    buildV2CombatDamageCommand(projection.combat.combatId, combatDamageBudget,
      combatDamageTargets.map(target => ({ unitObjectId: target.objectId, amount: combatDamageDrafts[target.objectId] ?? "" })));
  const canSubmitCombatDamage = canAct && choiceOpen && !choiceExpired && combatDamageCommand !== null;
  const selectedCard = ownHand.find(card => card.objectId === selectedCardId) ?? null;
  const selectedTarget = targetCandidates.find(object => object.objectId === selectedTargetId) ?? null;
  const winner = projection.winnerPlayerId === null ? null :
    projection.players.find(player => player.playerId === projection.winnerPlayerId) ?? null;
  const matchEnded = projection.phase === "ended" || winner !== null;
  const score = (playerId: string): number =>
    projection.scoring.players.find(player => player.playerId === playerId)?.points ??
      projection.players.find(player => player.playerId === playerId)?.score ?? 0;
  const scoreLine = projection.players.map(player => `${player.name} ${score(player.playerId)}`).join(" : ");

  return (
    <section className="v2-match-board" aria-label="协议 v2 对局">
      <header className="v2-match-header">
        <div><p className="v2-kicker">协议 v2 · {projection.rulesetVersion}</p><h2>{phaseLabel(projection.phase)} · 第 {projection.turnNumber} 回合</h2></div>
        <div className="v2-match-meta"><ConnectionState state={state.connectionStatus} /><span>状态 {projection.stateVersion}</span><span>事件 {projection.eventSeq}</span></div>
      </header>
      {matchEnded ? (
        <section className="v2-lobby" role="status" aria-label="对局结果">
          <h3>{winner === null ? "对局结束" : projection.winnerPlayerId === projection.viewerPlayerId ? "你获胜" : "你落败"}</h3>
          <p>{winner === null ? "服务端尚未公布胜者。" : `胜者：${winner.name}`}</p>
          <p>{`比分：${scoreLine}`}</p>
          {onLeaveRoom ? <button type="button" className="v2-primary-action" onClick={onLeaveRoom}>返回大厅</button> : null}
        </section>
      ) : null}
      {lastReceipt ? (
        <p className="v2-receipt" role="status" aria-label="最近的命令确认">
          命令 {lastReceipt.commandId} {lastReceipt.accepted ? "已接受" : "已拒绝"}
          {lastReceipt.duplicate ? "（幂等重复）" : ""} · 状态 {lastReceipt.stateVersion}
        </p>
      ) : null}
      {transportError || state.lastError || commandError ? <p className="v2-error" role="alert">{transportError ?? state.lastError ?? commandError}</p> : null}
      {choiceExpired ? (
        <p className="v2-waiting" role="status">
          本地选择提示已到期；等待服务端提供新的 choice 状态，当前动作已停用。
        </p>
      ) : null}
      <section className="v2-players" aria-label="玩家状态">
        {projection.players.map(player => <PlayerSummary key={player.playerId} player={player} active={player.playerId === projection.activePlayerId} priority={player.playerId === projection.priority.playerId} score={projection.scoring.players.find(value => value.playerId === player.playerId)?.points ?? player.score} />)}
      </section>
      <section className="v2-board-grid" aria-label="牌桌区域">
        <ZonePanel title="对手手牌" count={opponent?.handCount ?? 0} hidden />
        <ZonePanel title="对手基地" objects={baseObjects.filter(object => baseOwnerOf(object) !== projection.viewerPlayerId)} />
        {battlefieldPanels.map(panel => <ZonePanel key={panel.battlefieldId} title={panel.title} objects={panel.objects} />)}
        <ZonePanel title="我的基地" objects={baseObjects.filter(object => baseOwnerOf(object) === projection.viewerPlayerId)} />
        <ZonePanel title="对手公开符文" objects={opponentRunes} />
        <ZonePanel title="我的符文" objects={ownRunes} count={viewer?.zoneCounts["rune-zone"] ?? ownRunes.length} />
      </section>
      <section className="v2-hand" aria-label="我的手牌">
        <div className="v2-section-heading"><h3>我的手牌</h3><span>{ownHand.length} / {viewer?.handCount ?? ownHand.length}</span></div>
        {ownHand.length === 0 ? <p className="v2-muted">手牌为空</p> : (
          <div className="v2-card-row">{ownHand.map(card => <button key={card.objectId} type="button"
            className={`v2-card${selectedMulliganIds.includes(card.objectId) || selectedCardId === card.objectId ? " is-selected" : ""}`}
            disabled={setup ? !canChooseMulligan : !canPlay} onClick={() => {
              if (setup) {
                const choice = mulliganSelection;
                if (!choice || choice.status !== "pending") return;
                const selected = choice.options?.find(option =>
                  option.objectRef?.objectId === card.objectId &&
                  option.objectRef.zoneEntryId === (card.zoneEntryId ?? 0));
                if (!selected) return;
                setSelectedMulliganIds(current => current.includes(selected.id) ? current.filter(id => id !== selected.id) :
                  current.length < (choice.max ?? 2) ? [...current, selected.id] : current);
              }
              else setSelectedCardId(current => current === card.objectId ? null : card.objectId);
            }} aria-label={setup ? `选择调度 ${card.name ?? card.cardId ?? card.objectId}` : `选择打出 ${card.name ?? card.cardId ?? card.objectId}`}>
            <strong>{card.name ?? card.cardId ?? "未知卡牌"}</strong><small>{card.faceDown ? "牌面朝下" : card.zone}</small>{card.might !== undefined ? <small>战力 {card.might}</small> : null}
          </button>)}</div>
        )}
        {setup ? <div className="v2-action-panel" aria-label="起手换牌">
          <p className="v2-muted">{mulliganOpen ? "选择至多 2 张换掉；不选择即保留全部起手。" : "等待服务端开放你的换牌窗口。"}</p>
          <button type="button" className="v2-primary-action" disabled={!canAct || !mulliganOpen ||
            selectedMulliganIds.length > (mulliganSelection?.status === "pending" ? mulliganSelection.max ?? 2 : 2)}
            onClick={() => {
              const choice = mulliganSelection;
              if (!choice || choice.status !== "pending") return;
              if (selectedMulliganChoices.length !== selectedMulliganIds.length) return;
              submit(buildV2MulliganCommand(selectedMulliganChoices.map(ref => ref.objectId)));
            }}>
            {selectedMulliganIds.length === 0 ? "保留起手" : `换掉 ${selectedMulliganIds.length} 张`}
          </button>
        </div> : null}
      </section>
      {!setup ? <section className="v2-action-panel" aria-label="出牌目标" data-v2-ui-hook="play-card-placement-and-target-candidates">
        <div className="v2-section-heading"><h3>出牌</h3><span>{selectedCard?.name ?? "先选择手牌"}</span></div>
        {playDestinationOptions.length === 0 ? null : <label>永久物落点
          <select aria-label="永久物落点" disabled={!canPlay} value={selectedPlayDestinationOption?.key ?? ""}
            onChange={event => setSelectedPlayDestination(event.currentTarget.value)}>
            <option value="">选择</option>
            {playDestinationOptions.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
          </select>
        </label>}
        {playTargetRequirements.length > 0 ? <div aria-label="服务端投影出牌目标要求">{playTargetRequirements.map(requirement =>
          <fieldset key={requirement.id} disabled={!canPlay}><legend>{requirement.label}（{requirement.min === requirement.max ? requirement.min : `${requirement.min}-${requirement.max}`}）</legend>
            <div className="v2-choice-options">{requirement.options.map(option => <button key={option.id} type="button"
              aria-label={`选择${requirement.label}：${option.label}`}
              aria-pressed={(selectedPlayTargets[requirement.id] ?? []).includes(
                `${option.objectRef?.objectId}:${String(option.objectRef?.zoneEntryId)}`)}
              onClick={() => setSelectedPlayTargets(current => {
                const refKey = `${option.objectRef?.objectId}:${String(option.objectRef?.zoneEntryId)}`;
                const selectedForGroup = current[requirement.id] ?? [];
                const selected = selectedForGroup.includes(refKey);
                const next = selected ? selectedForGroup.filter(id => id !== refKey)
                  : selectedForGroup.length >= requirement.max
                    ? [...selectedForGroup.slice(-(requirement.max - 1)), refKey]
                    : [...selectedForGroup, refKey];
                return { ...current, [requirement.id]: next };
              })}>{option.label}</button>)}</div>
          </fieldset>)}
        </div> : targetCandidates.length > 0 ? <div className="v2-choice-options" aria-label="服务端投影候选目标">{targetCandidates.map(target => <button key={target.objectId} type="button" aria-pressed={selectedTargetId === target.objectId} onClick={() => setSelectedTargetId(target.objectId)}>{target.name ?? target.cardId ?? target.objectId}</button>)}</div> : <p className="v2-muted">服务端未公布该次出牌的目标要求。</p>}
        <button type="button" className="v2-primary-action" disabled={!canPlay || selectedCard === null || selectedPlayOption === null ||
          playTargetRequirements.some(requirement => {
            const count = (selectedPlayTargets[requirement.id] ?? []).length;
            return count < requirement.min || count > requirement.max;
          })} onClick={() => {
          if (!selectedCard) return;
          const option = selectedPlayOption;
          if (!option) return;
          const targets: V2Target[] = playTargetRequirements.length > 0
            ? selectedPlayTargetRefs.map(ref => ({ kind: "object", objectId: ref.objectId, zoneEntryId: ref.zoneEntryId }))
            : selectedTarget ? [{ kind: "object", objectId: selectedTarget.objectId,
              ...(selectedTarget.zoneEntryId === undefined ? {} : { zoneEntryId: selectedTarget.zoneEntryId }) }] : [];
          const command = buildProjectedV2PlayCommand(projection, selectedCard.objectId,
            option.requiresDestination === false ? undefined : option.destination, targets);
          if (command !== null) submit(command);
        }}>打出手牌</button>
      </section> : null}
      {!setup ? <section className="v2-action-panel" aria-label="符文操作">
        <div className="v2-section-heading"><h3>符文</h3><span>能量 {viewer?.energy ?? 0} · Power {formatPower(viewer?.power ?? {})}</span></div>
        {ownRunes.length === 0 ? <p className="v2-muted">没有公开的我方符文。符文区顺序由服务端隐藏，只显示投影对象。</p> : <div className="v2-choice-options">{ownRunes.map(rune => <div key={rune.objectId}><strong>{rune.name ?? rune.cardId ?? rune.objectId}</strong><button type="button" disabled={!canAct || rune.zoneEntryId === undefined || rune.exhausted === true} onClick={() => submit(buildV2RuneCommand("rune-energy", rune))}>取能量</button><button type="button" disabled={!canAct || rune.zoneEntryId === undefined || rune.exhausted === true} onClick={() => submit(buildV2RuneCommand("rune-power", rune))}>取 Power</button></div>)}</div>}
      </section> : null}
      {!setup ? <section className="v2-action-panel" aria-label="战斗推进与伤害操作" data-v2-ui-hook="combat-advance-and-damage">
        <div className="v2-section-heading"><h3>战斗</h3><span>{projection.combat?.status === "active" ? `${projection.combat.step ?? "active"}${combatDamageSide === null ? "" : ` · ${combatDamageSide}`}` : "无进行中的战斗"}</span></div>
        <button type="button" disabled={setup || !canAdvance} onClick={() => submit(buildV2AdvanceCommand())}>推进</button>
        {combatDamage === null ? null : <div aria-label="战斗伤害分配">
          <p>需分配 {combatDamageBudget} 点伤害；各目标金额合计必须相等。</p>
          {combatDamageTargets.length === 0 ? <p className="v2-muted">服务端未投影本场战斗的公开目标。</p> :
            <div className="v2-choice-options">{combatDamageTargets.map(target => <label key={target.objectId}>
              {target.name ?? target.cardId ?? target.objectId}
              <input aria-label={`${target.name ?? target.cardId ?? target.objectId} 伤害`} type="number" min="0" step="1"
                value={combatDamageDrafts[target.objectId] ?? ""}
                onChange={event => {
                  // Read the value now: React clears currentTarget before it runs
                  // the updater, which crashed the board on the first keystroke.
                  const amount = event.currentTarget.value;
                  setCombatDamageDrafts(current => ({ ...current, [target.objectId]: amount }));
                }} />
            </label>)}</div>}
          <button type="button" className="v2-primary-action" disabled={!canSubmitCombatDamage} onClick={() => {
            if (combatDamageCommand === null) return;
            submit(combatDamageCommand);
            setCombatDamageDrafts({});
          }}>提交战斗伤害</button>
        </div>}
      </section> : null}
      {!setup ? <section className="v2-action-panel" aria-label="移动操作">
        <div className="v2-section-heading"><h3>移动</h3><span>{selectedUnitId === null ? "选择单位与目的地" : objectName(selectedUnitId)}</span></div>
        <div className="v2-choice-options">{movableUnits.length === 0 ? <p className="v2-muted">当前没有可移动的单位</p> : null}{movableUnits.map(unit => <button key={unit.objectId} type="button" aria-pressed={selectedUnitId === unit.objectId} disabled={setup} onClick={() => setSelectedUnitId(unit.objectId)}>{unit.name ?? unit.cardId ?? unit.objectId}</button>)}</div>
        <label>目的地 <select value={selectedDestination} onChange={event => setSelectedDestination(event.currentTarget.value)}><option value="">选择</option>{destinationOptions.map(destination => <option key={destination.id} value={destination.id}>{destination.label}</option>)}</select></label>
        <button type="button" disabled={setup || !canAct || selectedUnitId === null || selectedDestination === ""} onClick={() => {
          const destination = destinationOptions.find(value => value.id === selectedDestination);
          if (destination) submit(buildV2MoveCommand(selectedUnitId!, destination.value));
        }}>移动单位</button>
      </section> : null}
      {!setup ? <section className="v2-action-row" aria-label="对局操作">
        <button type="button" disabled={setup || !canPass} onClick={() => submit(buildV2PassCommand())}>Pass</button>
        <button type="button" disabled={setup || !canEndTurn} onClick={() => submit(buildV2EndTurnCommand())}>结束回合</button>
        {matchEnded ? null : concedeConfirmationOpen ? (
          <span role="group" aria-label="认输确认">
            <span>确认认输？</span>
            <button type="button" disabled={!canAct} onClick={() => {
              setConcedeConfirmationOpen(false);
              submit({ type: "concede" });
            }}>确认认输</button>
            <button type="button" onClick={() => setConcedeConfirmationOpen(false)}>取消</button>
          </span>
        ) : (
          <button type="button" disabled={setup || !canAct} onClick={() => setConcedeConfirmationOpen(true)}>认输</button>
        )}
        {busy ? <span role="status">等待命令确认…</span> : null}
      </section> : null}
      {!setup ? <ChoicePanel choice={state.choice} selectedIds={selectedChoiceIds} numberAnswer={numberAnswer} optionalAnswer={optionalChoiceAnswer} disabled={!canAct}
        onNumberChange={setNumberAnswer}
        onOptionalAnswerChange={setOptionalChoiceAnswer}
        onToggle={id => setSelectedChoiceIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])}
        onSubmit={() => {
          const answer = buildV2ChoiceAnswer(state.choice.choice, selectedChoiceIds, numberAnswer, optionalChoiceAnswer);
          if (answer === null) return;
          const command = buildV2ChooseCommand(state.choice, answer, `desktop-v2-choose-${state.choice.choice.status === "pending" ? `${state.choice.choice.choiceId}-${state.choice.choice.stateVersion}` : "none"}`);
          if (command) submit(command);
        }} /> : null}
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
  return [...base, ...projection.scoring.battlefieldLocationIds.map(id => {
    const value = { kind: "battlefield" as const, battlefieldId: id };
    return { id: `battlefield:${id}`, label: locationLabel(projection, value), value };
  })];
}

/** The player whose base holds this object, or null when it is not in a base. */
function baseOwnerOf(object: V2ProjectedObject): string | null {
  if (object.location?.kind === "base") return object.location.playerId;
  return object.zone === "base" && object.location === undefined ? object.controllerPlayerId ?? object.ownerPlayerId : null;
}

function battlefieldName(projection: V2Projection, battlefieldId: string): string {
  const card = projection.objects.find(object => object.objectId === battlefieldId);
  return card?.name ?? card?.cardId ?? battlefieldId;
}

function locationLabel(projection: V2Projection, location: V2PlayOption["destination"]): string {
  if (location.kind === "battlefield") return `战场 ${battlefieldName(projection, location.battlefieldId)}`;
  return location.playerId === projection.viewerPlayerId ? "我的基地" :
    `${projection.players.find(player => player.playerId === location.playerId)?.name ?? "对手"} 的基地`;
}

/** One panel per battlefield: the battlefield card's name, its controller, and the units there. */
function projectedBattlefieldPanels(projection: V2Projection, boardObjects: readonly V2ProjectedObject[]): readonly {
  readonly battlefieldId: string;
  readonly title: string;
  readonly objects: readonly V2ProjectedObject[];
}[] {
  return projection.scoring.battlefieldLocationIds.map(battlefieldId => {
    const controllerId = projection.battlefields?.find(field => field.battlefieldId === battlefieldId)?.controllerPlayerId ?? null;
    const controller = controllerId === null ? "无人控制" : controllerId === projection.viewerPlayerId ? "我方控制" :
      `${projection.players.find(player => player.playerId === controllerId)?.name ?? "对手"} 控制`;
    return {
      battlefieldId,
      title: `战场 · ${battlefieldName(projection, battlefieldId)}（${controller}）`,
      objects: boardObjects.filter(object => object.objectId !== battlefieldId &&
        object.location?.kind === "battlefield" && object.location.battlefieldId === battlefieldId)
    };
  });
}

function sameMoveDestination(
  location: V2MoveOption["destination"],
  destination: ReturnType<typeof projectedMoveDestinations>[number]["value"]
): boolean {
  return location.kind === "base"
    ? destination.kind === "base" && location.playerId === destination.playerId
    : destination.kind === "battlefield" && location.battlefieldId === destination.battlefieldId;
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
  const options = pending.options ?? [];
  const multiple = pending.kind === "select-objects" || pending.kind === "order" || (pending.max ?? 1) > 1;
  const objectChoice = pending.kind === "select-objects" || pending.kind === "order";
  const missingCandidates = objectChoice && (options.length === 0 || options.some(option => option.objectRef === undefined));
  const selectionComplete = pending.kind === "order" ? selectedIds.length === options.length :
    !objectChoice || (selectedIds.length >= (pending.min ?? 0) && selectedIds.length <= (pending.max ?? Number.POSITIVE_INFINITY));
  return <section className="v2-choice" aria-label="选择请求"><div className="v2-section-heading"><h3>选择请求 · {choiceKindLabel(pending.kind)}</h3><span>{choice.status === "expired" ? "已过期" : choice.answerable ? "请作出选择" : "等待对手回应"}</span></div>
    {pending.kind === "number" ? <input aria-label="选择数值" type="number" min={pending.min} max={pending.max} value={numberAnswer} disabled={disabled || !choice.answerable || choice.status === "expired"} onChange={event => onNumberChange(event.currentTarget.value)} /> :
      <div className="v2-choice-options">{options.length === 0 && pending.kind === "optional" ? <><button type="button" aria-pressed={optionalAnswer} disabled={disabled || !choice.answerable || choice.status === "expired"} onClick={() => onOptionalAnswerChange(true)}>接受</button><button type="button" aria-pressed={!optionalAnswer} disabled={disabled || !choice.answerable || choice.status === "expired"} onClick={() => onOptionalAnswerChange(false)}>拒绝</button></> : missingCandidates ? <p className="v2-waiting" role="status">等待服务端投影选择候选；客户端不会从手牌或其他对象自行推导。</p> : options.map(option => <button key={`${option.id}:${String(option.objectRef?.zoneEntryId ?? option.value ?? option.id)}`} type="button" aria-pressed={selectedIds.includes(option.id)} disabled={disabled || !choice.answerable || choice.status === "expired"} onClick={() => onToggle(option.id)}>{option.label}{pending.kind === "order" && selectedIds.includes(option.id) ? ` · 第 ${selectedIds.indexOf(option.id) + 1} 位` : ""}</button>)}</div>}
    {pending.min !== undefined || pending.max !== undefined ? <p className="v2-muted">可选数量：{pending.min ?? 0}–{pending.max ?? "不限"}{multiple ? "（可多选）" : ""}</p> : null}
    {pending.kind === "order" && !missingCandidates && !selectionComplete ? <p className="v2-muted" role="status">请按期望顺序继续点击：第 {selectedIds.length + 1} 张</p> : null}
    <button type="button" className="v2-primary-action" disabled={disabled || !choice.answerable || choice.status === "expired" || missingCandidates || !selectionComplete} onClick={onSubmit}>提交选择</button>
  </section>;
}

function choiceKindLabel(kind: Extract<V2PendingChoice, { status: "pending" }>["kind"]): string {
  return { optional: "可选效果", mode: "模式", "select-objects": "选择对象", order: "排序", number: "数值" }[kind];
}

function ChainPanel({ projection }: { readonly projection: V2Projection }) {
  const playerName = (playerId: string): string =>
    projection.players.find(player => player.playerId === playerId)?.name ?? playerId;
  const sourceName = (objectId: string): string => {
    const object = projection.objects.find(candidate => candidate.objectId === objectId);
    return object?.name ?? object?.cardId ?? objectId;
  };
  return <section className="v2-chain" aria-label="链与优先权"><div className="v2-section-heading"><h3>链 / 优先权</h3><span>{projection.priority.playerId ? `优先权：${playerName(projection.priority.playerId)}` : "无优先权"}</span></div><p>链状态：{projection.chain.status} · 阶段：{projection.chain.phase} · 窗口：{projection.priority.window} · Focus：{projection.priority.focusPlayerId ? playerName(projection.priority.focusPlayerId) : "无"}</p>{projection.chain.items.length === 0 ? <p className="v2-muted">链为空</p> : <ol>{projection.chain.items.map(item => <li key={item.itemId}>{item.kind} · {item.status}{item.sourceObjectId ? ` · ${sourceName(item.sourceObjectId)}` : ""}</li>)}</ol>}</section>;
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
  if (new Set(selectedIds).size !== selectedIds.length) return null;
  const selectedOptions = selectedIds.map(id => options.find(option => option.id === id));
  if (selectedOptions.some(option => option === undefined)) return null;
  const selected = selectedOptions.map(option => choiceOptionAnswer(choice, option!));
  if (choice.min !== undefined && selected.length < choice.min) return null;
  if (choice.max !== undefined && selected.length > choice.max) return null;
  if (choice.kind === "order" && options.some(option => option.objectRef !== undefined) &&
      selected.length !== options.length) return null;
  if (choice.kind === "select-objects" || choice.kind === "order" || (choice.max ?? 1) > 1) return selected;
  return selected[0] ?? null;
}

function choiceOptionAnswer(choice: Extract<V2PendingChoice, { status: "pending" }>, option: V2ChoiceOption): Exclude<V2ChoiceAnswer, readonly unknown[]> {
  if ((choice.kind === "select-objects" || choice.kind === "order") && option.objectRef !== undefined) {
    return { objectId: option.objectRef.objectId, zoneEntryId: option.objectRef.zoneEntryId };
  }
  if (choice.kind === "select-objects" && (typeof option.value === "string" || typeof option.id === "string")) {
    const extended = option as V2ChoiceOption & { readonly zoneEntryId?: unknown };
    const zoneEntryId = typeof extended.zoneEntryId === "number" ? extended.zoneEntryId : undefined;
    return { objectId: typeof option.value === "string" ? option.value : option.id,
      ...(zoneEntryId === undefined ? {} : { zoneEntryId }) };
  }
  return option.value ?? option.id;
}

function formatPower(power: Readonly<Record<string, number>>): string {
  return Object.entries(power).map(([domain, amount]) => `${domain} ${amount}`).join(" / ") || "无";
}

function phaseLabel(phase: V2Projection["phase"]): string {
  const labels: Record<V2Projection["phase"], string> = { setup: "启动", awaken: "唤醒", beginning: "开始", channel: "频道", draw: "抽牌", main: "主要阶段", combat: "战斗", ending: "结束", expiration: "到期", ended: "对局结束" };
  return labels[phase];
}
