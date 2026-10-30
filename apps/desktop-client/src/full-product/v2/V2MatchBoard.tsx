import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
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
import {
  buildCardNameIndex,
  cardReferenceName,
  projectedObjectCardName,
  type CardNameIndex
} from "./card-names";
import { DEFAULT_HTTP_SERVER_URL, DEFAULT_WS_SERVER_URL } from "../../net/server-defaults";
import {
  buildV2CardLookup,
  playerName as v2PlayerName,
  V2BattlefieldCard,
  V2CardHoverPanel,
  V2CardPreview,
  v2HoverProps,
  V2OpponentHand,
  V2PlaymatSide,
  v2PlaymatCards,
  type V2BoardInteraction,
  type V2ObjectMark,
  type V2PlaymatCards
} from "./V2Playmat";
import {
  v2AssignDamage,
  v2ChainKindLabel,
  v2ChainStatusLabel,
  v2EventHidden,
  v2EventLabel,
  v2LethalNeed,
  v2MightAt,
  v2OrderedDamageDrafts,
  v2PlannedDamage,
  v2UnassignDamage,
  type V2DamagePlan
} from "./unit-groups";
import {
  useV2PointerDrag,
  v2GroupMoveDropTargets,
  v2MoveDropTargets,
  v2LocationKey,
  v2PlayDropTargets,
  v2PlayNeedsSelection,
  v2ResolveDrop,
  v2RuneCanAddEnergy,
  v2RuneCanAddPower,
  v2ToggleMoveGroup,
  type V2DragSource
} from "./playmat-interactions";
import "./V2MatchBoard.css";

export interface V2MatchBoardProps {
  readonly state: V2ClientState;
  readonly lastReceipt?: V2CommandReceipt | null;
  readonly room?: RoomView | null;
  readonly session?: ClientSession | null;
  readonly playerName?: string;
  readonly pendingCommandIds?: readonly string[];
  /** When the oldest unanswered command was first sent (ms since epoch). */
  readonly pendingCommandSince?: number | null;
  /** Opens the issue report page; the in-match entry attaches this match's log. */
  readonly onReportIssue?: () => void;
  readonly transportError?: string | null;
  readonly catalogServerUrl?: string;
  /** Test/static-render seam for an already loaded catalog; production loads `/api/cards`. */
  readonly initialCatalogCards?: readonly CatalogCard[];
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
  /** In-match configuration shown in the playmat sidebar (and above the lobby). */
  readonly controls?: ReactNode;
  /** Room chat shown in the playmat sidebar (and below the lobby). */
  readonly chat?: ReactNode;
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

/** A successful receipt retires only this component's local command error. */
export function commandErrorAfterReceipt(current: string | null, receipt: V2CommandReceipt): string | null {
  return receipt.accepted ? null : current;
}

/** Keep the server's rejection reason visible after the transport reports it as an error. */
export function commandRejectionReason(receipt: V2CommandReceipt | null | undefined): string | null {
  return receipt !== null && receipt !== undefined && !receipt.accepted ? receipt.rejection : null;
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
    { readonly kind: "battlefield"; readonly battlefieldId: string },
  additionalObjectIds: readonly string[] = []
): V2CommandRequest {
  return {
    type: "move",
    objectId,
    // RIFT-1154: the rest of a selected group moves in the same Standard Move.
    ...(additionalObjectIds.length === 0 ? {} : { additionalObjectIds: [...additionalObjectIds] }),
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

/** Local selections reset whenever this changes: a new state or a new pending choice. */
export function v2BoardSceneKey(projection: V2Projection | null): string {
  if (projection === null) return "none";
  const choiceId = projection.pendingChoice.status === "pending" ? projection.pendingChoice.choiceId : "";
  return `${projection.matchId}:${projection.stateVersion}:${choiceId}`;
}

export function V2MatchBoard({
  state,
  lastReceipt = null,
  room = null,
  session = null,
  playerName = "玩家",
  pendingCommandIds = [],
  pendingCommandSince = null,
  onReportIssue,
  transportError = null,
  catalogServerUrl = DEFAULT_HTTP_SERVER_URL,
  initialCatalogCards,
  serverUrl = DEFAULT_WS_SERVER_URL,
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
  controls,
  chat,
  onCommand
}: V2MatchBoardProps) {
  const projection = state.projection;
  // A long turn can keep the server busy for tens of seconds (RIFT-1148):
  // show how long the current command has been waiting.
  const waitingSince = pendingCommandIds.length > 0 ? pendingCommandSince : null;
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (waitingSince === null) return undefined;
    setClock(Date.now());
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [waitingSince]);
  const waitedSeconds = waitingSince === null ? 0 : Math.max(0, Math.floor((clock - waitingSince) / 1000));
  const [joinRoomId, setJoinRoomId] = useState("");
  // Both clients defaulted to the same profile name, so the board showed two
  // players called "玩家" (RIFT-1055); the lobby lets each player set theirs.
  const [seatName, setSeatName] = useState(playerName);
  const [selectedPrecon, setSelectedPrecon] = useState<V2M1PreconId>("rumble-sfd");
  const [catalogCards, setCatalogCards] = useState<readonly CatalogCard[]>(initialCatalogCards ?? []);
  const [catalogStatus, setCatalogStatus] = useState<"idle" | "loading" | "ready" | "error">(
    initialCatalogCards === undefined ? "idle" : "ready"
  );
  const [lobbyError, setLobbyError] = useState<string | null>(null);
  const [selectedMulliganIds, setSelectedMulliganIds] = useState<readonly string[]>([]);
  const [selectedChoiceIds, setSelectedChoiceIds] = useState<readonly string[]>([]);
  const [optionalChoiceAnswer, setOptionalChoiceAnswer] = useState(true);
  const [numberAnswer, setNumberAnswer] = useState("");
  const [selectedCardId, setSelectedCardId] = useState<string | null>(initialSelectedCardId);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [selectedPlayTargets, setSelectedPlayTargets] = useState<Readonly<Record<string, readonly string[]>>>({});
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  // Units picked with Shift/Ctrl/⌘ click that move together (RIFT-1154).
  const [moveGroup, setMoveGroup] = useState<readonly string[]>([]);
  const [selectedDestination, setSelectedDestination] = useState<string>("");
  const [selectedPlayDestination, setSelectedPlayDestination] = useState<string>("");
  const [combatDamageDrafts, setCombatDamageDrafts] = useState<Readonly<Record<string, string>>>(initialCombatDamageDrafts);
  const [concedeConfirmationOpen, setConcedeConfirmationOpen] = useState(initialConcedeConfirmationOpen);
  const [commandError, setCommandError] = useState<string | null>(null);
  // RIFT-1146 table state: the order damage was clicked in, the one expanded
  // stack, the dismissed response prompt, the viewer's prompt preference, the
  // log/chat tab and the summary of the combat that just ended.
  const [combatDamageOrder, setCombatDamageOrder] = useState<readonly string[]>([]);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [promptDismissedScene, setPromptDismissedScene] = useState<string | null>(null);
  const [responseMode, setResponseMode] = useState<V2ResponseMode>("auto");
  const [commTab, setCommTab] = useState<"log" | "chat">("log");
  const [combatResult, setCombatResult] = useState<V2CombatResult | null>(null);
  // The card under the pointer, shown in the docked info panel (left unless the card is on the left).
  const [hoverCard, setHoverCard] = useState<{ readonly cardId: string; readonly side: "left" | "right"; readonly objectId?: string } | null>(null);
  const [previewObjectId, setPreviewObjectId] = useState<string | null>(null);
  // Where the selected hand card sits on screen: its play menu is drawn above it.
  const [menuAnchor, setMenuAnchor] = useState<{ readonly x: number; readonly y: number } | null>(null);
  const combatWatchRef = useRef<{ readonly battlefieldId: string; readonly fromSeq: number; readonly contested: boolean } | null>(null);
  const mainActionRef = useRef<(() => void) | null>(null);
  const cardNames = useMemo(() => buildCardNameIndex(catalogCards), [catalogCards]);
  const cardLookup = useMemo(() => buildV2CardLookup(catalogCards), [catalogCards]);
  // Read-only card preview on the playmat; it never selects or plays a card.
  const [previewCardId, setPreviewCardId] = useState<string | null>(null);
  // Playmat drag-and-drop (RIFT-1144). The drop handler is refreshed every
  // render so it always reads the projection the drop happened on.
  const [dragNotice, setDragNotice] = useState<string | null>(null);
  const dropHandlerRef = useRef<(source: V2DragSource, dropKey: string | null) => void>(() => undefined);
  const { drag, begin: beginDrag, consumeDragClick, cancel: cancelDrag } =
    useV2PointerDrag((source, dropKey) => dropHandlerRef.current(source, dropKey));
  // One command can raise several choices in a row at the same stateVersion
  // (e.g. ordering three simultaneous triggers). Keying only on the version
  // carried the previous choice's selection into the next one, so its answer
  // could not be built and submit silently did nothing (RIFT-1080).
  const sceneKey = v2BoardSceneKey(projection);
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
    setMoveGroup([]);
    setSelectedDestination("");
    setSelectedPlayDestination("");
    setCombatDamageDrafts({});
    setCombatDamageOrder([]);
    setExpandedGroup(null);
    setConcedeConfirmationOpen(false);
    setCommandError(null);
    setDragNotice(null);
    cancelDrag();
  }, [sceneKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Space runs the one main action; Esc drops a half-made selection.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, button, summary") ?? false) return;
      if (event.key === " " && mainActionRef.current !== null) {
        event.preventDefault();
        mainActionRef.current();
      }
      if (event.key === "Escape") {
        setSelectedCardId(null);
        setSelectedPlayTargets({});
        setExpandedGroup(null);
        setMoveGroup([]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // When a combat ends, summarise what died from the public event stream and
  // show it on that battlefield for a few seconds.
  const combatStatus = projection?.combat?.status ?? "none";
  const combatField = projection?.combat?.status === "active" ? projection.combat.battlefieldId ?? null : null;
  useEffect(() => {
    if (projection === null) return undefined;
    if (combatStatus === "active" && combatField !== null) {
      if (combatWatchRef.current?.battlefieldId !== combatField) {
        combatWatchRef.current = { battlefieldId: combatField, fromSeq: projection.eventSeq,
          contested: projection.combat?.status === "active" && projection.combat.defenderPlayerId !== undefined };
      }
      return undefined;
    }
    const watched = combatWatchRef.current;
    if (watched === null) return undefined;
    combatWatchRef.current = null;
    setCombatResult(v2CombatResult(projection, [...projection.events, ...state.events], watched, buildCardNameIndex(catalogCards)));
    const timer = setTimeout(() => setCombatResult(null), 6000);
    return () => clearTimeout(timer);
  }, [combatStatus, combatField]); // eslint-disable-line react-hooks/exhaustive-deps

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
    void onCommand(request).then(
      receipt => setCommandError(current => commandErrorAfterReceipt(current, receipt)),
      caught => setCommandError(caught instanceof Error ? caught.message : "命令未能提交。")
    );
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
        {controls}
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
        {chat}
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
  const battlefieldPanels = projectedBattlefieldPanels(projection, cardNames, boardObjects);
  const runeObjects = visibleV2Objects(projection, "rune-zone");
  const ownRunes = runeObjects.filter(object => object.ownerPlayerId === projection.viewerPlayerId);
  const ownUnits = [...baseObjects, ...battlefieldObjects].filter(object =>
    (object.controllerPlayerId ?? object.ownerPlayerId) === projection.viewerPlayerId);
  const objectById = (objectId: string): V2ProjectedObject | undefined =>
    projection.objects.find(candidate => candidate.objectId === objectId);
  const objectLabel = (object: V2ProjectedObject): string => projectedObjectCardName(cardNames, object);
  const objectName = (objectId: string): string => {
    const object = objectById(objectId);
    return object === undefined ? objectId : objectLabel(object);
  };
  const referencedLabel = (objectId: string | undefined, englishName: string | undefined, fallback: string): string => {
    const object = objectId === undefined ? undefined : objectById(objectId);
    return object !== undefined && !object.faceDown && (object.cardId !== undefined || object.name !== undefined)
      ? objectLabel(object)
      : cardReferenceName(cardNames, objectId, englishName, fallback) ?? englishName ?? fallback;
  };
  const targetCandidates = projectedTargetCandidates(projection);
  const targetCandidateLabels = duplicateObjectLabels(projection, targetCandidates.map(target => ({
    objectId: target.objectId,
    label: objectLabel(target),
    allowLocation: target.visibility === "public"
  })), cardNames);
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
      label: locationLabel(projection, cardNames, options[0]!.destination)
    }));
  })();
  const selectedPlayDestinationOption = playDestinationOptions.find(option => option.key === selectedPlayDestination) ??
    (playDestinationOptions.length === 1 ? playDestinationOptions[0]! : null);
  const selectedPlayOption = playOptions.find(option => option.requiresDestination === false) ??
    selectedPlayDestinationOption?.options[0] ?? null;
  const playTargetRequirements = selectedPlayOption?.targetRequirements ?? [];
  const pendingSelectObjects = projection.pendingChoice.status === "pending" &&
    projection.pendingChoice.kind === "select-objects";
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
  const movableUnitLabels = duplicateObjectLabels(projection, movableUnits.map(unit => ({
    objectId: unit.objectId,
    label: objectLabel(unit),
    allowLocation: unit.visibility === "public"
  })), cardNames);
  const destinationOptions = projectedMoveDestinations(projection, cardNames).filter(destination =>
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
  // Omitted canPass is the pre-RIFT-1081 fallback for old servers.
  const actionOptions = projection.actionOptions;
  const canPass = canAct && (actionOptions?.canPass === undefined
    ? hasPriority && choiceOpen && !choiceExpired
    : actionOptions.canPass === true && choiceOpen && !choiceExpired);
  const canPlay = !setup && canAct && hasPriority && choiceOpen && !choiceExpired;
  const canChooseMulligan = setup ? canAct && mulliganOpen && !choiceExpired : false;
  const canEndTurn = canAct && actionOptions?.canEndTurn === true && choiceOpen && !choiceExpired;
  const canAdvance = canAct && actionOptions?.canAdvance === true && choiceOpen && !choiceExpired;
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
  const combatDamageTargetLabels = duplicateObjectLabels(projection, combatDamageTargets.map(target => ({
    objectId: target.objectId,
    label: objectLabel(target),
    allowLocation: target.visibility === "public"
  })), cardNames);
  // Only units that were given damage are sent, in the order they were
  // clicked: a small budget never has to cover every enemy (RIFT-1146).
  const damagePlan: V2DamagePlan = { drafts: combatDamageDrafts, order: combatDamageOrder };
  const combatDamageCommand = combatDamage === null || projection.combat?.combatId === undefined || combatDamageBudget === null ? null :
    buildV2CombatDamageCommand(projection.combat.combatId, combatDamageBudget, v2OrderedDamageDrafts(damagePlan, combatDamageTargets));
  const canSubmitCombatDamage = canAct && choiceOpen && !choiceExpired && combatDamageCommand !== null;
  const waitingForOpponentDamage = projection.combat?.status === "active" &&
    projection.combat.step === "damage" && projection.combat.damage !== undefined &&
    projection.combat.damage.expectedPlayerId !== projection.viewerPlayerId;
  const selectedCard = ownHand.find(card => card.objectId === selectedCardId) ?? null;
  const selectedTarget = targetCandidates.find(object => object.objectId === selectedTargetId) ?? null;
  const winner = projection.winnerPlayerId === null ? null :
    projection.players.find(player => player.playerId === projection.winnerPlayerId) ?? null;
  const matchEnded = projection.phase === "ended" || winner !== null;
  const score = (playerId: string): number =>
    projection.scoring.players.find(player => player.playerId === playerId)?.points ??
      projection.players.find(player => player.playerId === playerId)?.score ?? 0;
  const scoreLine = projection.players.map(player => `${player.name} ${score(player.playerId)}`).join(" : ");

  const playmatCards = v2PlaymatCards(projection, cardNames, cardLookup);
  const inspectCard = (cardId: string, objectId?: string): void => {
    setPreviewCardId(cardId);
    setPreviewObjectId(objectId ?? null);
  };
  const playTargetsFromSelection = (option: V2PlayOption): V2Target[] => option.targetRequirements !== undefined
    ? selectedPlayTargetRefs.map(ref => ({ kind: "object", objectId: ref.objectId, zoneEntryId: ref.zoneEntryId }))
    : selectedTarget ? [{ kind: "object", objectId: selectedTarget.objectId,
      ...(selectedTarget.zoneEntryId === undefined ? {} : { zoneEntryId: selectedTarget.zoneEntryId }) }] : [];
  const togglePlayTarget = (requirementId: string, max: number, refKey: string): void => setSelectedPlayTargets(current => {
    const selectedForGroup = current[requirementId] ?? [];
    const selected = selectedForGroup.includes(refKey);
    const next = selected ? selectedForGroup.filter(id => id !== refKey)
      : selectedForGroup.length >= max
        ? [...selectedForGroup.slice(-(max - 1)), refKey]
        : [...selectedForGroup, refKey];
    return { ...current, [requirementId]: next };
  });
  const optionRefKey = (option: V2ChoiceOption): string => `${option.objectRef?.objectId}:${String(option.objectRef?.zoneEntryId)}`;
  dropHandlerRef.current = (source, dropKey) => {
    const result = v2ResolveDrop(projection, source, dropKey);
    if (result.kind === "illegal") {
      setDragNotice(result.notice);
      return;
    }
    if (result.kind === "move") {
      const destination = result.destination;
      setDragNotice(null);
      setMoveGroup([]);
      submit(buildV2MoveCommand(source.objectId, destination.kind === "base"
        ? { kind: "base", playerId: destination.playerId }
        : { kind: "battlefield", battlefieldId: destination.battlefieldId }, source.groupObjectIds));
      return;
    }
    const option = result.option;
    const command = v2PlayNeedsSelection(option) ? null : buildProjectedV2PlayCommand(projection, source.objectId,
      option.requiresDestination === false ? undefined : option.destination);
    if (command !== null) {
      setDragNotice(null);
      submit(command);
      return;
    }
    // Targets are still needed: keep the drop as the chosen card and placement.
    setSelectedCardId(source.objectId);
    if (option.requiresDestination !== false && dropKey !== null) setSelectedPlayDestination(dropKey);
    setDragNotice(`已选好 ${source.label} 的落点，请在牌桌上点选带准星的目标`);
  };
  const dragTargets: ReadonlyMap<string, unknown> | null = drag === null || !drag.active ? null :
    drag.source.kind === "play" ? v2PlayDropTargets(projection, drag.source.objectId) :
      drag.source.groupObjectIds !== undefined && drag.source.groupObjectIds.length > 0
        ? v2GroupMoveDropTargets(projection, [drag.source.objectId, ...drag.source.groupObjectIds])
        : v2MoveDropTargets(projection, drag.source.objectId);
  const movableIds = new Set(movableUnits.map(unit => unit.objectId));
  // A group only keeps units that can still move; a lone pick is an ordinary drag.
  const activeMoveGroup = moveGroup.filter(objectId => movableIds.has(objectId));
  const viewerId = projection.viewerPlayerId;
  const hoverHandler = (cardId: string | null, clientX?: number, object?: V2ProjectedObject): void => setHoverCard(cardId === null ? null :
    { cardId, side: clientX !== undefined && typeof window !== "undefined" && clientX < window.innerWidth * .32 ? "right" : "left",
      ...(object === undefined ? {} : { objectId: object.objectId }) });
  const controllerId = (object: V2ProjectedObject): string => object.controllerPlayerId ?? object.ownerPlayerId;

  // Board clicks (RIFT-1146): damage while allocating, else play targets
  // while a selected card needs them, else the pending object choice.
  const combatTargetIds = new Set(combatDamageTargets.map(target => target.objectId));
  const plannedDamage = v2PlannedDamage(damagePlan);
  const targetingRequirements = !setup && canPlay && selectedCard !== null ? playTargetRequirements : [];
  const pendingChoiceState = state.choice.choice;
  const choiceMine = pendingChoiceState.status === "pending" && state.choice.answerable && !choiceExpired;
  const boardChoiceOptions = choiceMine && pendingChoiceState.status === "pending" &&
    (pendingChoiceState.kind === "select-objects" || pendingChoiceState.kind === "order")
    ? (pendingChoiceState.options ?? []).filter(option => option.objectRef !== undefined) : [];
  const toggleBoardChoice = (optionId: string): void => setSelectedChoiceIds(current =>
    current.includes(optionId) ? current.filter(item => item !== optionId)
      : pendingChoiceState.status === "pending" && pendingChoiceState.kind !== "order" && pendingChoiceState.max === 1
        ? [optionId] : [...current, optionId]);
  const markFor = (object: V2ProjectedObject): V2ObjectMark | null => {
    if (combatDamage !== null && combatTargetIds.has(object.objectId)) return "damage";
    for (const requirement of targetingRequirements) {
      const option = requirement.options.find(candidate => candidate.objectRef?.objectId === object.objectId);
      if (option !== undefined) return (selectedPlayTargets[requirement.id] ?? []).includes(optionRefKey(option)) ? "selected" : "selectable";
    }
    const choice = boardChoiceOptions.find(option => option.objectRef?.objectId === object.objectId);
    if (choice !== undefined) return selectedChoiceIds.includes(choice.id) ? "selected" : "selectable";
    if (activeMoveGroup.includes(object.objectId)) return "selected";
    return null;
  };
  const boardInteraction: V2BoardInteraction = {
    dropStateFor: dropKey => dragTargets === null ? null : !dragTargets.has(dropKey) ? "blocked" :
      drag?.overKey === dropKey ? "over" : "legal",
    dragHandlerFor: object => {
      if (setup || !canAct || !movableIds.has(object.objectId)) return null;
      // Dragging a member of a selected group carries the whole group.
      const rest = activeMoveGroup.length > 1 && activeMoveGroup.includes(object.objectId)
        ? activeMoveGroup.filter(objectId => objectId !== object.objectId) : [];
      return beginDrag({ kind: "move", objectId: object.objectId,
        label: rest.length === 0 ? objectLabel(object) : `${objectLabel(object)} 等 ${rest.length + 1} 个单位`,
        ...(object.cardId === undefined ? {} : { cardId: object.cardId }),
        ...(rest.length === 0 ? {} : { groupObjectIds: rest }) });
    },
    rune: {
      enabled: !setup && canAct,
      onEnergy: rune => submit(buildV2RuneCommand("rune-energy", rune)),
      onPower: rune => submit(buildV2RuneCommand("rune-power", rune))
    },
    operable: object => !setup && canAct && combatDamage === null && targetingRequirements.length === 0 && movableIds.has(object.objectId),
    markFor,
    onObjectClick: (objects, multi) => {
      if (consumeDragClick()) return true;
      if (combatDamage !== null && combatDamageBudget !== null && objects.length > 0 &&
          objects.every(object => combatTargetIds.has(object.objectId))) {
        if (!canAct) return true;
        const next = v2AssignDamage(damagePlan, objects, combatDamageBudget, combatDamageTargets);
        setCombatDamageDrafts(next.drafts);
        setCombatDamageOrder(next.order);
        return true;
      }
      for (const requirement of targetingRequirements) {
        const options = objects.flatMap(object => {
          const option = requirement.options.find(candidate => candidate.objectRef?.objectId === object.objectId);
          return option === undefined ? [] : [option];
        });
        if (options.length === 0) continue;
        const selected = selectedPlayTargets[requirement.id] ?? [];
        const option = options.find(candidate => !selected.includes(optionRefKey(candidate))) ?? options[0]!;
        togglePlayTarget(requirement.id, requirement.max, optionRefKey(option));
        return true;
      }
      const choices = objects.flatMap(object => {
        const option = boardChoiceOptions.find(candidate => candidate.objectRef?.objectId === object.objectId);
        return option === undefined ? [] : [option];
      });
      if (choices.length > 0) {
        toggleBoardChoice((choices.find(option => !selectedChoiceIds.includes(option.id)) ?? choices[0]!).id);
        return true;
      }
      // Shift/Ctrl/⌘ click picks own units to move together; a plain click still opens the card.
      if (multi === true && !setup && canAct && combatDamage === null && objects.some(object => movableIds.has(object.objectId))) {
        setMoveGroup(v2ToggleMoveGroup(projection, activeMoveGroup, objects));
        return true;
      }
      return false;
    },
    onObjectContext: objects => {
      if (combatDamage === null || !objects.every(object => combatTargetIds.has(object.objectId))) return false;
      const next = v2UnassignDamage(damagePlan, objects);
      setCombatDamageDrafts(next.drafts);
      setCombatDamageOrder(next.order);
      return true;
    },
    allocationFor: object => {
      if (combatDamage === null || !combatTargetIds.has(object.objectId)) return null;
      const amount = Number(combatDamageDrafts[object.objectId] ?? "");
      if (!Number.isSafeInteger(amount) || amount <= 0) return null;
      const order = combatDamageOrder.indexOf(object.objectId);
      return { amount, lethal: amount >= v2LethalNeed(object), order: order < 0 ? null : order + 1 };
    },
    expandedKey: expandedGroup,
    onExpand: setExpandedGroup,
    onHover: hoverHandler,
    dropPreviewFor: dropKey => {
      if (drag === null || !drag.active || drag.source.kind !== "move" || drag.overKey !== dropKey ||
          dragTargets?.has(dropKey) !== true || !dropKey.startsWith("battlefield:") || viewerId === null) return null;
      const battlefieldId = dropKey.slice("battlefield:".length);
      const movingIds = [drag.source.objectId, ...(drag.source.groupObjectIds ?? [])];
      const enemies = projection.objects.filter(object => object.location?.kind === "battlefield" &&
        object.location.battlefieldId === battlefieldId && controllerId(object) !== viewerId && object.might !== undefined);
      const name = projection.objects.find(object => object.objectId === battlefieldId);
      const title = name === undefined ? battlefieldId : objectLabel(name);
      if (enemies.length === 0) {
        const controlled = projection.battlefields?.find(field => field.battlefieldId === battlefieldId)?.controllerPlayerId === viewerId;
        return controlled ? `移动到 ${title}` : `移动到 ${title}：无人防守，可占领（预估）`;
      }
      const mine = v2MightAt(projection, battlefieldId, viewerId) +
        movingIds.reduce((sum, objectId) => sum + (objectById(objectId)?.might ?? 0), 0);
      const theirs = enemies.reduce((sum, object) => sum + (object.might ?? 0), 0);
      const owner = v2PlayerName(projection, controllerId(enemies[0]!));
      return `进攻 ${title}：你 ${mine} : ${theirs} ${owner}（预估，进入后会先对决）`;
    },
    combatHeader: battlefieldId => combatDamage !== null && combatDamageBudget !== null && projection.combat?.battlefieldId === battlefieldId ? (
      <span className="v2m-meter" aria-label="伤害分配进度">
        分配 {plannedDamage} / {combatDamageBudget}
        <span className="v2m-meter-bar"><i style={{ width: `${Math.min(100, combatDamageBudget === 0 ? 100 : plannedDamage / combatDamageBudget * 100)}%` }} /></span>
        <button type="button" disabled={plannedDamage === 0} onClick={() => { setCombatDamageDrafts({}); setCombatDamageOrder([]); }}>清空分配</button>
      </span>
    ) : waitingForOpponentDamage && projection.combat?.battlefieldId === battlefieldId ? (
      <span className="v2m-meter is-waiting">等待 {v2PlayerName(projection, projection.combat.damage?.expectedPlayerId)} 分配伤害</span>
    ) : null,
    resultFor: battlefieldId => combatResult?.battlefieldId === battlefieldId ? (
      <><strong>{combatResult.title}</strong>{combatResult.lines.map(line => <span key={line}>{line}</span>)}</>
    ) : null
  };

  const viewerSide = viewer ?? projection.players[0] ?? null;
  const opponentSide = viewer === null ? projection.players[1] ?? null : opponent;
  const sideBase = (playerId: string) => baseObjects.filter(object => baseOwnerOf(object) === playerId);
  const sideRunes = (playerId: string) => runeObjects.filter(object => object.ownerPlayerId === playerId);

  // Timing at a glance: who holds priority, what is on the chain, what to do.
  const chainItems = projection.chain.items;
  const topChain = chainItems.length === 0 ? null : chainItems[chainItems.length - 1]!;
  const chainSourceName = (item: typeof chainItems[number]): string =>
    item.sourceObjectId === undefined ? v2ChainKindLabel(item.kind) : objectName(item.sourceObjectId);
  const showdown = projection.priority.window === "showdown";
  const activeCombatFieldId = projection.combat?.status === "active" ? projection.combat.battlefieldId ?? null : null;
  const activeCombatField = activeCombatFieldId === null ? undefined : objectById(activeCombatFieldId);
  const combatFieldName = activeCombatField === undefined ? activeCombatFieldId ?? "" : objectLabel(activeCombatField);
  const playableIds = new Set((projection.actionOptions?.plays ?? []).map(option => option.cardObjectId));
  const playableCount = canPlay ? ownHand.filter(card => playableIds.has(card.objectId)).length : 0;
  const nameOrYou = (playerId: string | null | undefined): string =>
    playerId === viewerId ? "你" : v2PlayerName(projection, playerId);
  const readyPlayCommand = !canPlay || selectedCard === null || selectedPlayOption === null ? null :
    buildProjectedV2PlayCommand(projection, selectedCard.objectId,
      selectedPlayOption.requiresDestination === false ? undefined : selectedPlayOption.destination,
      playTargetsFromSelection(selectedPlayOption));
  const submitChoice = (): void => {
    const answer = buildV2ChoiceAnswer(state.choice.choice, selectedChoiceIds, numberAnswer, optionalChoiceAnswer);
    if (answer === null) return;
    const command = buildV2ChooseCommand(state.choice, answer, `desktop-v2-choose-${state.choice.choice.status === "pending" ? `${state.choice.choice.choiceId}-${state.choice.choice.stateVersion}` : "none"}`);
    if (command) submit(command);
  };
  const submitDamage = (): void => {
    if (combatDamageCommand === null) return;
    submit(combatDamageCommand);
    setCombatDamageDrafts({});
    setCombatDamageOrder([]);
  };
  const anythingOperable = playableCount > 0 || movableUnits.length > 0 ||
    ownRunes.some(rune => v2RuneCanAddEnergy(rune));
  const waitingOn = pendingChoiceState.status === "pending" && !state.choice.answerable ? pendingChoiceState.ownerPlayerId :
    waitingForOpponentDamage ? projection.combat?.damage?.expectedPlayerId ?? null : projection.priority.playerId;
  const main: V2MainAction = matchEnded ? { label: "对局结束", detail: winner === null ? "" : `胜者：${winner.name}`, tone: "wait", run: null }
    : setup ? { label: "换牌", detail: mulliganOpen ? "在手牌中点选要换掉的牌" : "等待对手换牌", tone: "wait", run: null }
    : busy ? { label: "处理中…", detail: "等待服务端回执", tone: "wait", run: null }
    : choiceMine ? { label: "确认选择", detail: "完成选择请求", tone: "go",
      run: canAct && buildV2ChoiceAnswer(state.choice.choice, selectedChoiceIds, numberAnswer, optionalChoiceAnswer) !== null ? submitChoice : null }
    : combatDamage !== null ? { label: "确认伤害", detail: `${plannedDamage} / ${combatDamageBudget ?? 0}`, tone: "fight",
      run: canSubmitCombatDamage ? submitDamage : null }
    : readyPlayCommand !== null && selectedCard !== null ? { label: `打出 ${objectLabel(selectedCard)}`, detail: "确认打出", tone: "go",
      run: () => submit(readyPlayCommand) }
    : canPass && (topChain !== null || showdown) ? { label: "让过",
      detail: topChain !== null ? `结算 ${chainItems.length} ${chainSourceName(topChain)}` : "对决中不再出牌",
      tone: showdown || projection.combat?.status === "active" ? "fight" : "go", run: () => submit(buildV2PassCommand()) }
    : canAdvance ? { label: "推进", detail: projection.combat?.status === "active" ? "进入下一战斗步骤" : "继续结算", tone: "fight",
      run: () => submit(buildV2AdvanceCommand()) }
    : canEndTurn ? { label: "结束回合", detail: "空格", tone: anythingOperable ? "go" : "end", run: () => submit(buildV2EndTurnCommand()) }
    : canPass ? { label: "让过", detail: "交出优先权", tone: "go", run: () => submit(buildV2PassCommand()) }
    : { label: waitingOn === null ? "等待" : `等待 ${v2PlayerName(projection, waitingOn)}`, detail: "对手行动中", tone: "wait", run: null };
  mainActionRef.current = main.run;

  const banner: { readonly text: string; readonly tone: V2MainAction["tone"] } =
    matchEnded ? { text: winner === null ? "对局结束" : winner.playerId === viewerId ? "你获胜" : "你落败", tone: "wait" }
    : setup ? { text: "换牌阶段", tone: "wait" }
    : combatDamage !== null ? { text: `分配 ${combatDamageBudget ?? 0} 点伤害：点击${combatFieldName}的敌方单位`, tone: "fight" }
    : targetingRequirements.length > 0 ? { text: `选择目标：点击带准星的单位（${targetingRequirements.map(requirement =>
      requirement.min === requirement.max ? String(requirement.min) : `${requirement.min}-${requirement.max}`).join(" / ")} 个）`, tone: "fight" }
    : choiceMine ? { text: "请完成选择请求", tone: "go" }
    : showdown ? { text: `${combatFieldName || "战场"} · 对决 — 焦点：${nameOrYou(projection.priority.focusPlayerId ?? projection.priority.playerId)}`, tone: "fight" }
    : waitingForOpponentDamage ? { text: `等待 ${v2PlayerName(projection, projection.combat?.damage?.expectedPlayerId)} 分配伤害`, tone: "wait" }
    : projection.combat?.status === "active" ? { text: canAdvance ? `${combatFieldName || "战场"}战斗：按「推进」进入下一步` : `${combatFieldName || "战场"}战斗中`, tone: "fight" }
    : topChain !== null ? (hasPriority ? { text: "轮到你响应", tone: "go" } : { text: `等待 ${v2PlayerName(projection, projection.priority.playerId)} 响应`, tone: "wait" })
    : projection.activePlayerId === viewerId ? { text: "你的回合", tone: "go" }
    : { text: `${v2PlayerName(projection, projection.activePlayerId)} 的回合`, tone: "wait" };

  const promptOpen = !setup && !matchEnded && canPass && choiceOpen && !choiceExpired && (topChain !== null || showdown) &&
    responseMode !== "off" && (responseMode === "on" || playableCount > 0) && promptDismissedScene !== sceneKey &&
    selectedCardId === null && combatDamage === null;

  const playmatHeader = (
    <div className="full-product-duel-header v2-playmat-header v2t-top">
      <span className="full-product-duel-header-matchup">{viewerSide?.name ?? "—"} vs {opponentSide?.name ?? "—"}</span>
      <span className="full-product-duel-header-round" aria-label="回合">第 {projection.turnNumber} 回合</span>
      <span className="full-product-duel-header-phase" aria-label="阶段">{phaseLabel(projection.phase)}</span>
      <span className="full-product-duel-header-turn" aria-label="行动玩家">行动：{v2PlayerName(projection, projection.activePlayerId)}</span>
      <span className={`v2t-banner is-${banner.tone}`} role="status" aria-label="当前时点">{banner.text}</span>
      <span className="v2-playmat-score" aria-label="比分">比分 {scoreLine}</span>
      <V2ScorePips projection={projection} />
      <span className="v2-playmat-meta"><ConnectionState state={state.connectionStatus} /><span>状态 {projection.stateVersion}</span><span>事件 {projection.eventSeq}</span></span>
      {onReportIssue ? (
        <button type="button" className="v2-playmat-report" onClick={onReportIssue} title="提交问题描述和本局日志">问题上报</button>
      ) : null}
    </div>
  );
  const handPanel = (
    <section className="v2-hand v2-playmat-hand" aria-label="我的手牌">
          <div className="v2-section-heading"><h3>我的手牌</h3><span>{ownHand.length} / {viewer?.handCount ?? ownHand.length}</span></div>
          {ownHand.length === 0 ? <p className="v2-muted">手牌为空</p> : (
            <div className="v2-card-row">{ownHand.map(card => {
              const playable = !setup && canPlay && v2PlayDropTargets(projection, card.objectId).size > 0;
              const dim = !setup && !playable;
              const reason = dim ? (!canAct ? "现在不能操作" : !hasPriority ? "现在没有优先权" : !choiceOpen ? "请先完成选择请求" :
                topChain !== null || showdown ? "当前时点不能打出这张牌" : "现在没有这张牌的打出选项（费用、时机或目标不满足）") : null;
              const selected = selectedMulliganIds.includes(card.objectId) || selectedCardId === card.objectId;
              return <div key={card.objectId} className={`v2-hand-slot${playable ? " v2-operable" : ""}${dim ? " is-dim" : ""}`}
                {...(reason === null ? {} : { title: reason })} {...v2HoverProps(hoverHandler, card.cardId, card)}><button type="button"
              className={`v2-card${selected ? " is-selected" : ""}${playable ? " v2-draggable" : ""}`}
              disabled={setup ? !canChooseMulligan : !canPlay}
              onPointerDown={playable
                ? beginDrag({ kind: "play", objectId: card.objectId, label: objectLabel(card),
                  ...(card.cardId === undefined ? {} : { cardId: card.cardId }) }) : undefined}
              onClick={event => {
                if (consumeDragClick()) return;
                if (setup) {
                  const choice = mulliganSelection;
                  if (!choice || choice.status !== "pending") return;
                  const selectedOption = choice.options?.find(option =>
                    option.objectRef?.objectId === card.objectId &&
                    option.objectRef.zoneEntryId === (card.zoneEntryId ?? 0));
                  if (!selectedOption) return;
                  setSelectedMulliganIds(current => current.includes(selectedOption.id) ? current.filter(id => id !== selectedOption.id) :
                    current.length < (choice.max ?? 2) ? [...current, selectedOption.id] : current);
                }
                else {
                  const rect = event.currentTarget.getBoundingClientRect();
                  setMenuAnchor({ x: rect.left + rect.width / 2, y: rect.top });
                  setSelectedCardId(current => current === card.objectId ? null : card.objectId);
                  setSelectedPlayTargets({});
                  setSelectedPlayDestination("");
                }
              }} title={card.name ?? card.cardId} aria-label={setup ? `选择调度 ${objectLabel(card)}` : `选择打出 ${objectLabel(card)}`}>
              {card.cardId !== undefined && playmatCards.image(card.cardId) !== null ? <img className="v2-hand-face" src={playmatCards.image(card.cardId)!} alt="" draggable={false} /> : <span className="v2-hand-face is-missing" aria-hidden="true" />}
              <strong>{objectLabel(card)}</strong><small>{card.faceDown ? "牌面朝下" : card.zone}</small>{card.might !== undefined ? <small>战力 {card.might}</small> : null}
            </button>{card.cardId !== undefined ? <button type="button" className="v2-hand-zoom" aria-label={`查看大图：${objectLabel(card)}`}
              title="查看大图" onClick={() => setPreviewCardId(card.cardId!)}>⤢</button> : null}
            </div>;
            })}</div>
          )}
    </section>
  );
  const selectedPlays = selectedCard !== null && canPlay && targetingRequirements.length === 0
    ? projection.actionOptions.plays.filter(option => option.cardObjectId === selectedCard.objectId) : [];
  const playMenu = selectedCard !== null && selectedPlays.length > 0 && menuAnchor !== null ? (
    <PlayMenu card={selectedCard} plays={selectedPlays} label={objectLabel(selectedCard)} disabled={!canPlay} anchor={menuAnchor}
      destinationLabel={destination => locationLabel(projection, cardNames, destination)}
      onPlay={option => {
        if (v2PlayNeedsSelection(option)) {
          if (option.requiresDestination !== false) setSelectedPlayDestination(v2LocationKey(option.destination));
          setDragNotice(`请在牌桌上点选 ${objectLabel(selectedCard)} 的目标`);
          return;
        }
        const command = buildProjectedV2PlayCommand(projection, selectedCard.objectId,
          option.requiresDestination === false ? undefined : option.destination);
        if (command !== null) submit(command);
      }} />
  ) : null;
  const statusArea = (
    <div className="v2t-status">
        {dragNotice ? <p className="v2-waiting" role="status" aria-label="拖动提示">{dragNotice}</p> : null}
        {activeMoveGroup.length > 1 ? (
          <p className="v2-waiting" role="status" aria-label="同行单位">
            已选 {activeMoveGroup.length} 个单位一起移动：拖动其中任意一张到目的地。
            <button type="button" onClick={() => setMoveGroup([])}>取消选择</button>
          </p>
        ) : movableUnits.length > 1 && !setup ? (
          <p className="v2-muted" aria-label="多选提示">按住 Shift（或 Ctrl / ⌘）点选多个单位，可以一起移动进攻。</p>
        ) : null}
        {busy ? (
          <p className="v2-waiting" role="status" aria-live="polite" aria-label="命令处理中">
            {waitedSeconds >= 5
              ? `服务器仍在处理（已等待 ${waitedSeconds} 秒），请稍候；命令完成前，重复操作已停用。`
              : "正在处理…请等待服务端回执；命令完成前，重复操作已停用。"}
          </p>
        ) : null}
        {matchEnded ? (
          <section className="v2-lobby" role="status" aria-label="对局结果">
            <h3>{winner === null ? "对局结束" : projection.winnerPlayerId === projection.viewerPlayerId ? "你获胜" : "你落败"}</h3>
            <p>{winner === null ? "服务端尚未公布胜者。" : `胜者：${winner.name}`}</p>
            <p>{`比分：${scoreLine}`}</p>
            {onLeaveRoom ? <button type="button" className="v2-primary-action" onClick={onLeaveRoom}>返回大厅</button> : null}
          </section>
        ) : null}
        {lastReceipt ? (
          <p className={lastReceipt.accepted ? "v2-receipt" : "v2-error"} role="status" aria-label="最近的命令确认">
            {lastReceipt.accepted
              ? `命令 ${lastReceipt.commandId} 已接受${lastReceipt.duplicate ? "（幂等重复）" : ""}`
              : `命令 ${lastReceipt.commandId} 未执行：${commandRejectionReason(lastReceipt) ?? "服务端未提供拒绝原因。"}`}
            {` · 状态 ${lastReceipt.stateVersion}`}
          </p>
        ) : null}
        {transportError ? <p className="v2-error" role="alert">{transportError}</p> : null}
        {state.lastError && state.lastError !== transportError ? <p className="v2-error" role="alert">{state.lastError}</p> : null}
        {commandError && commandError !== transportError && commandError !== state.lastError ?
          <p className="v2-error" role="alert">{commandError}</p> : null}
        {choiceExpired ? (
          <p className="v2-waiting" role="status">
            本地选择提示已到期；等待服务端提供新的 choice 状态，当前动作已停用。
          </p>
        ) : null}
        {waitingForOpponentDamage ? <p className="v2-waiting" role="status">等待对方分配伤害</p> : null}
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
    </div>
  );
  const dock = (
    <div className="v2t-dock">
      {statusArea}
      {!setup ? <div className="v2t-modes" role="radiogroup" aria-label="响应提示">
        <span>响应提示</span>
        {(["on", "auto", "off"] as const).map(mode => (
          <button key={mode} type="button" role="radio" aria-checked={responseMode === mode}
            title={mode === "on" ? "链上有东西或对决时总是询问" : mode === "auto" ? "只有你有牌可打时才询问" : "不弹询问框，用主按钮操作"}
            onClick={() => setResponseMode(mode)}>{mode === "on" ? "开" : mode === "auto" ? "自动" : "关"}</button>
        ))}
      </div> : null}
      <button type="button" className={`v2t-main is-${main.run === null ? "wait" : main.tone}`} disabled={main.run === null}
        aria-label={`主操作：${main.label}`} onClick={() => main.run?.()}>
        <span>{main.label}</span>{main.detail ? <small>{main.detail}</small> : null}
      </button>
      {!setup ? <section className="v2-action-row v2t-secondary" aria-label="对局操作">
          <button type="button" disabled={setup || !canPass} onClick={() => submit(buildV2PassCommand())}>Pass</button>
          <button type="button" disabled={setup || !canAdvance} onClick={() => submit(buildV2AdvanceCommand())}>推进</button>
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
        </section> : null}
      <p className="v2t-keys">空格 = 主操作 · Esc = 取消选择</p>
    </div>
  );
  const actionPanel = (
    <div className="v2-playmat-actions">
        {!setup ? <section className="v2-action-panel" aria-label="出牌目标" data-v2-ui-hook="play-card-placement-and-target-candidates">
          <div className="v2-section-heading"><h3>出牌</h3><span>{selectedCard === null ? "先选择手牌" : objectLabel(selectedCard)}</span></div>
          {playDestinationOptions.length === 0 ? null : <label>永久物落点
            <select aria-label="永久物落点" disabled={!canPlay} value={selectedPlayDestinationOption?.key ?? ""}
              onChange={event => setSelectedPlayDestination(event.currentTarget.value)}>
              <option value="">选择</option>
              {playDestinationOptions.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
            </select>
          </label>}
          {playTargetRequirements.length > 0 ? <div aria-label="服务端投影出牌目标要求">{playTargetRequirements.map(requirement => {
            const optionLabels = duplicateObjectLabels(projection, requirement.options.flatMap(option =>
              option.objectRef === undefined ? [] : [{ objectId: option.objectRef.objectId,
                label: referencedLabel(option.objectRef.objectId, option.label, option.objectRef.objectId),
                allowLocation: objectById(option.objectRef.objectId)?.visibility === "public" }]), cardNames);
            const displayOption = (option: V2ChoiceOption): string => option.objectRef === undefined ? option.label :
              optionLabels.get(option.objectRef.objectId) ?? referencedLabel(option.objectRef.objectId, option.label, option.objectRef.objectId);
            return <fieldset key={requirement.id} disabled={!canPlay}><legend>{requirement.label}（{requirement.min === requirement.max ? requirement.min : `${requirement.min}-${requirement.max}`}）</legend>
              <div className="v2-choice-options">{requirement.options.map(option => <button key={option.id} type="button"
                aria-label={`选择${requirement.label}：${displayOption(option)}`}
                aria-pressed={(selectedPlayTargets[requirement.id] ?? []).includes(optionRefKey(option))}
                onClick={() => togglePlayTarget(requirement.id, requirement.max, optionRefKey(option))}>{displayOption(option)}</button>)}</div>
            </fieldset>;
          })}
          </div> : targetCandidates.length > 0 ? <div className="v2-choice-options" aria-label="服务端投影候选目标">{
            targetCandidates.map(target => <button key={target.objectId} type="button" aria-pressed={selectedTargetId === target.objectId}
              onClick={() => setSelectedTargetId(target.objectId)}>{
                targetCandidateLabels.get(target.objectId) ?? objectLabel(target)}</button>)
          }</div> : pendingSelectObjects ? <p className="v2-muted">服务端未公布该次出牌的目标候选。</p> :
            selectedPlayOption === null ? null : <p className="v2-muted">此牌不需要目标。</p>}
          <button type="button" className="v2-primary-action" disabled={!canPlay || selectedCard === null || selectedPlayOption === null ||
            playTargetRequirements.some(requirement => {
              const count = (selectedPlayTargets[requirement.id] ?? []).length;
              return count < requirement.min || count > requirement.max;
            })} onClick={() => {
            if (!selectedCard) return;
            const option = selectedPlayOption;
            if (!option) return;
            const command = buildProjectedV2PlayCommand(projection, selectedCard.objectId,
              option.requiresDestination === false ? undefined : option.destination, playTargetsFromSelection(option));
            if (command !== null) submit(command);
          }}>打出手牌</button>
        </section> : null}
        {!setup ? <section className="v2-action-panel" aria-label="符文操作">
          <div className="v2-section-heading"><h3>符文</h3><span>能量 {viewer?.energy ?? 0} · Power {formatPower(viewer?.power ?? {})}</span></div>
          {ownRunes.length === 0 ? <p className="v2-muted">没有公开的我方符文。符文区顺序由服务端隐藏，只显示投影对象。</p> : <div className="v2-choice-options">{ownRunes.map(rune => <div key={rune.objectId}><strong title={rune.name ?? rune.cardId}>{objectLabel(rune)}</strong><button type="button" aria-label={`${objectLabel(rune)} 取能量`} disabled={!canAct || !v2RuneCanAddEnergy(rune)} onClick={() => submit(buildV2RuneCommand("rune-energy", rune))}>取能量</button><button type="button" aria-label={`${objectLabel(rune)} 取 Power`} disabled={!canAct || !v2RuneCanAddPower(rune)} onClick={() => submit(buildV2RuneCommand("rune-power", rune))}>取 Power</button></div>)}</div>}
        </section> : null}
        {!setup ? <section className="v2-action-panel" aria-label="战斗推进与伤害操作" data-v2-ui-hook="combat-advance-and-damage">
          <div className="v2-section-heading"><h3>战斗</h3><span>{projection.combat?.status === "active" ? `${projection.combat.step ?? "active"}${combatDamageSide === null ? "" : ` · ${combatDamageSide}`}` : "无进行中的战斗"}</span></div>
          {combatDamage === null ? null : <div aria-label="战斗伤害分配">
            <p>需分配 {combatDamageBudget} 点伤害；也可以直接在战场上点击敌方单位分配。</p>
            {combatDamageTargets.length === 0 ? <p className="v2-muted">服务端未投影本场战斗的公开目标。</p> :
              <div className="v2-choice-options">{combatDamageTargets.map(target => {
                const label = combatDamageTargetLabels.get(target.objectId) ?? objectLabel(target);
                return <label key={target.objectId}>
                {label}
                <input aria-label={`${label} 伤害`} type="number" min="0" step="1"
                  value={combatDamageDrafts[target.objectId] ?? ""}
                  onChange={event => {
                    // Read the value now: React clears currentTarget before it runs
                    // the updater, which crashed the board on the first keystroke.
                    const amount = event.currentTarget.value;
                    setCombatDamageDrafts(current => ({ ...current, [target.objectId]: amount }));
                    setCombatDamageOrder(current => amount === "" ? current.filter(id => id !== target.objectId) :
                      current.includes(target.objectId) ? current : [...current, target.objectId]);
                  }} />
              </label>;
              })}</div>}
            <button type="button" className="v2-primary-action" disabled={!canSubmitCombatDamage} onClick={submitDamage}>提交战斗伤害</button>
          </div>}
        </section> : null}
        {!setup ? <section className="v2-action-panel" aria-label="移动操作">
          <div className="v2-section-heading"><h3>移动</h3><span>{selectedUnitId === null ? "选择单位与目的地" :
            movableUnitLabels.get(selectedUnitId) ?? objectName(selectedUnitId)}</span></div>
          <div className="v2-choice-options">{movableUnits.length === 0 ? <p className="v2-muted">当前没有可移动的单位</p> : null}{movableUnits.map(unit => <button key={unit.objectId} type="button" aria-pressed={selectedUnitId === unit.objectId} disabled={setup} onClick={() => setSelectedUnitId(unit.objectId)}>{
            movableUnitLabels.get(unit.objectId) ?? objectLabel(unit)}</button>)}</div>
          <label>目的地 <select value={selectedDestination} onChange={event => setSelectedDestination(event.currentTarget.value)}><option value="">选择</option>{destinationOptions.map(destination => <option key={destination.id} value={destination.id}>{destination.label}</option>)}</select></label>
          <button type="button" disabled={setup || !canAct || selectedUnitId === null || selectedDestination === ""} onClick={() => {
            const destination = destinationOptions.find(value => value.id === selectedDestination);
            if (destination) submit(buildV2MoveCommand(selectedUnitId!, destination.value));
          }}>移动单位</button>
        </section> : null}
    </div>
  );
  const choicePanel = !setup ? <ChoicePanel cardNames={cardNames} projection={projection} choice={state.choice} selectedIds={selectedChoiceIds} numberAnswer={numberAnswer} optionalAnswer={optionalChoiceAnswer} disabled={!canAct}
    onNumberChange={setNumberAnswer}
    onOptionalAnswerChange={setOptionalChoiceAnswer}
    onToggle={id => setSelectedChoiceIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])}
    onSubmit={submitChoice} /> : null;
  const prompt = promptOpen ? (
    <div className="v2t-prompt" role="dialog" aria-label="响应确认">
      <h4>{topChain !== null
        ? `${nameOrYou(topChain.controllerPlayerId)}的${v2ChainKindLabel(topChain.kind)}【${chainSourceName(topChain)}】在链上（第 ${chainItems.length} 项）`
        : `${combatFieldName || "战场"} 对决 · 焦点在你`}</h4>
      <p>{playableCount > 0 ? `你有 ${playableCount} 张牌可以响应：亮起蓝光的手牌可直接拖动或点选打出。` : "你没有可以打出的牌。"}
        {topChain !== null ? ` 让过后，若对手也让过，将从第 ${chainItems.length} 项开始结算。` : " 双方都让过后进入下一步。"}</p>
      <div className="v2t-prompt-actions">
        <button type="button" onClick={() => setPromptDismissedScene(sceneKey)}>{playableCount > 0 ? "我要响应" : "先看看牌桌"}</button>
        <button type="button" className="is-primary" disabled={!canPass} onClick={() => submit(buildV2PassCommand())}>让过</button>
      </div>
    </div>
  ) : null;

  return (
    <section className="v2-match-board v2-playmat full-product-duel-match v2t" aria-label="协议 v2 对局"
      {...(drag?.active ? { "data-dragging": drag.source.kind } : {})}>
      {playmatHeader}
      <div className="v2t-body">
        <div className="v2t-table" role="region" aria-label="对局桌面">
          <div className="v2t-opp-hand" role="region" aria-label="对手手牌"><V2OpponentHand player={opponentSide} /></div>
          <div className="v2t-band is-opponent" role="region" aria-label="对手基地">
            {opponentSide === null ? null : <V2PlaymatSide projection={projection} player={opponentSide} position="opponent"
              baseObjects={sideBase(opponentSide.playerId)} runes={sideRunes(opponentSide.playerId)} cards={playmatCards} onInspect={inspectCard}
              interaction={boardInteraction} />}
          </div>
          <div className="v2t-fields" role="region" aria-label="中央战场">
            {projection.scoring.battlefieldLocationIds.map(battlefieldId => (
              <V2BattlefieldCard key={battlefieldId} projection={projection} battlefieldId={battlefieldId} cards={playmatCards} onInspect={inspectCard}
                interaction={boardInteraction}
                objects={battlefieldPanels.find(panel => panel.battlefieldId === battlefieldId)?.objects ?? []} />
            ))}
          </div>
          <div className="v2t-band is-player" role="region" aria-label="我方基地">
            {viewerSide === null ? null : <V2PlaymatSide projection={projection} player={viewerSide} position="player"
              baseObjects={sideBase(viewerSide.playerId)} runes={sideRunes(viewerSide.playerId)} cards={playmatCards} onInspect={inspectCard}
              interaction={boardInteraction} />}
          </div>
          <div className="v2t-hand" role="region" aria-label="手牌">{handPanel}</div>
          {prompt}
          {playMenu}
          {drag?.active ? null : <V2CardHoverPanel cardId={hoverCard?.cardId ?? null} side={hoverCard?.side ?? "left"} cards={playmatCards}
            object={hoverCard?.objectId === undefined ? undefined : objectById(hoverCard.objectId)} />}
          {choicePanel !== null && choiceMine ? <div className="v2t-choice-overlay">{choicePanel}</div> : null}
        </div>
        <aside className="v2t-rail">
          <ChainRail cardNames={cardNames} projection={projection} cards={playmatCards} onHover={hoverHandler} />
          <div className="v2t-comms">
            {chat ? <div className="v2t-tabs" role="tablist" aria-label="聊天与日志">
              <button type="button" role="tab" aria-selected={commTab === "log"} onClick={() => setCommTab("log")}>记录</button>
              <button type="button" role="tab" aria-selected={commTab === "chat"} onClick={() => setCommTab("chat")}>聊天</button>
            </div> : null}
            {chat && commTab === "chat" ? chat : <LogPanel cardNames={cardNames} projection={projection} events={state.events} />}
          </div>
          {choicePanel !== null && !choiceMine ? choicePanel : null}
          {dock}
          <details className="v2t-drawer">
            <summary>辅助操作：出牌 / 符文 / 战斗 / 移动表单</summary>
            {controls}
            <div className="v2t-actions" role="region" aria-label="操作面板">{actionPanel}</div>
          </details>
        </aside>
      </div>
      <V2CardPreview cardId={previewCardId} cards={playmatCards} onClose={() => setPreviewCardId(null)}
        object={previewObjectId === null ? undefined : objectById(previewObjectId)} />
      {drag?.active ? (
        <div className="v2-drag-ghost" style={{ left: drag.x, top: drag.y }} aria-hidden="true">
          {drag.source.cardId !== undefined && playmatCards.image(drag.source.cardId) !== null
            ? <img src={playmatCards.image(drag.source.cardId)!} alt="" draggable={false} />
            : <span>{drag.source.label}</span>}
        </div>
      ) : null}
      {drag?.active ? (
        <p className="v2-drag-hint" role="status">
          {drag.source.kind === "play" ? "拖到高亮的基地或战场松开即可打出" : "拖到高亮的位置松开即可移动；拖到有敌人的战场即发起进攻"}，按 Esc 取消
        </p>
      ) : null}
    </section>
  );
}

type V2ResponseMode = "on" | "auto" | "off";

interface V2MainAction {
  readonly label: string;
  readonly detail: string;
  readonly tone: "go" | "fight" | "end" | "wait";
  readonly run: (() => void) | null;
}

export interface V2CombatResult {
  readonly battlefieldId: string;
  readonly title: string;
  readonly lines: readonly string[];
}

/**
 * What a finished combat did, read only from public events after it began:
 * who was killed on each side and who controls the battlefield now.
 */
export function v2CombatResult(
  projection: V2Projection,
  events: readonly { readonly eventSeq: number; readonly timingPoint: string; readonly payload: V2EventPayload }[],
  watched: { readonly battlefieldId: string; readonly fromSeq: number; readonly contested?: boolean },
  cardNames: CardNameIndex
): V2CombatResult {
  const seen = new Set<number>();
  const killed: { readonly name: string; readonly mine: boolean }[] = [];
  for (const event of events) {
    if (event.eventSeq <= watched.fromSeq || seen.has(event.eventSeq) || event.timingPoint !== "object-killed") continue;
    seen.add(event.eventSeq);
    const objectField = event.payload.objectId;
    const playerField = event.payload.playerId;
    const objectId = objectField !== undefined && "value" in objectField && typeof objectField.value === "string" ? objectField.value : null;
    const playerId = playerField !== undefined && "value" in playerField && typeof playerField.value === "string" ? playerField.value : null;
    if (objectId === null) continue;
    const object = projection.objects.find(candidate => candidate.objectId === objectId);
    const name = object === undefined ? cardNames.localizedById.get(objectId) ?? objectId : projectedObjectCardName(cardNames, object, objectId);
    const owner = object === undefined ? playerId : object.controllerPlayerId ?? object.ownerPlayerId;
    killed.push({ name, mine: owner === projection.viewerPlayerId });
  }
  const controller = projection.battlefields?.find(field => field.battlefieldId === watched.battlefieldId)?.controllerPlayerId ?? null;
  const field = projection.objects.find(object => object.objectId === watched.battlefieldId);
  const fieldName = field === undefined ? watched.battlefieldId : projectedObjectCardName(cardNames, field, watched.battlefieldId);
  const list = (mine: boolean): string => {
    const counts = new Map<string, number>();
    for (const entry of killed.filter(value => value.mine === mine)) counts.set(entry.name, (counts.get(entry.name) ?? 0) + 1);
    return [...counts].map(([name, count]) => count > 1 ? `${name} ×${count}` : name).join("、") || "无";
  };
  if (watched.contested === false && killed.length === 0) {
    const who = controller === projection.viewerPlayerId ? "你" :
      projection.players.find(player => player.playerId === controller)?.name ?? "无人";
    return { battlefieldId: watched.battlefieldId, title: controller === null ? `${fieldName}：无人占领` : `${who}占领了${fieldName}`, lines: [] };
  }
  const title = controller === projection.viewerPlayerId ? `你赢得${fieldName}之战` :
    controller === null ? `${fieldName}之战结束：无人控制` :
      `${fieldName}之战结束：${projection.players.find(player => player.playerId === controller)?.name ?? "对手"} 控制`;
  return { battlefieldId: watched.battlefieldId, title, lines: [`击杀：${list(false)}`, `损失：${list(true)}`] };
}

/** One hand card's play choices, shown above it when selected (Master Duel style). */
function PlayMenu({ card, plays, label, disabled, anchor, destinationLabel, onPlay }: {
  readonly card: V2ProjectedObject;
  readonly anchor: { readonly x: number; readonly y: number };
  readonly plays: readonly V2PlayOption[];
  readonly label: string;
  readonly disabled: boolean;
  readonly destinationLabel: (destination: V2PlayOption["destination"]) => string;
  readonly onPlay: (option: V2PlayOption) => void;
}) {
  const unique = new Map<string, V2PlayOption>();
  for (const option of plays) {
    const key = option.requiresDestination === false ? "none" : v2LocationKey(option.destination);
    if (!unique.has(key)) unique.set(key, option);
  }
  return (
    <div className="v2t-play-menu" role="menu" aria-label={`${label} 的打出方式`} data-object-id={card.objectId}
      style={{ left: anchor.x, top: anchor.y }}>
      {[...unique.values()].map(option => (
        <button key={option.requiresDestination === false ? "none" : v2LocationKey(option.destination)} type="button" role="menuitem"
          disabled={disabled} onClick={() => onPlay(option)}>
          {v2PlayNeedsSelection(option) ? "选择目标" : "打出"}{option.requiresDestination === false ? "" : ` · ${destinationLabel(option.destination)}`}
        </button>
      ))}
    </div>
  );
}

/** Both players' victory tracks as pips (the official mat prints 1–8 along its edge). */
function V2ScorePips({ projection }: { readonly projection: V2Projection }) {
  const target = projection.scoring.victoryScore;
  return (
    <span className="v2t-pips" aria-hidden="true">
      {projection.scoring.players.map(player => (
        <span key={player.playerId} className={player.playerId === projection.viewerPlayerId ? "is-me" : "is-opp"}>
          {Array.from({ length: target }, (_, index) => <i key={index} className={index < player.points ? "is-on" : ""} />)}
        </span>
      ))}
    </span>
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

function projectedMoveDestinations(projection: V2Projection, cardNames: CardNameIndex): readonly {
  readonly id: string;
  readonly label: string;
  readonly value: { readonly kind: "base"; readonly playerId: string } | { readonly kind: "battlefield"; readonly battlefieldId: string };
}[] {
  const base = projection.viewerPlayerId ? [{ id: `base:${projection.viewerPlayerId}`, label: "我的基地", value: { kind: "base" as const, playerId: projection.viewerPlayerId } }] : [];
  return [...base, ...projection.scoring.battlefieldLocationIds.map(id => {
    const value = { kind: "battlefield" as const, battlefieldId: id };
    return { id: `battlefield:${id}`, label: locationLabel(projection, cardNames, value), value };
  })];
}

/** The player whose base holds this object, or null when it is not in a base. */
function baseOwnerOf(object: V2ProjectedObject): string | null {
  if (object.location?.kind === "base") return object.location.playerId;
  return object.zone === "base" && object.location === undefined ? object.controllerPlayerId ?? object.ownerPlayerId : null;
}

function battlefieldName(projection: V2Projection, cardNames: CardNameIndex, battlefieldId: string): string {
  const card = projection.objects.find(object => object.objectId === battlefieldId);
  return card === undefined ? battlefieldId : projectedObjectCardName(cardNames, card, battlefieldId);
}

function locationLabel(projection: V2Projection, cardNames: CardNameIndex, location: V2PlayOption["destination"]): string {
  if (location.kind === "battlefield") return `战场 ${battlefieldName(projection, cardNames, location.battlefieldId)}`;
  return location.playerId === projection.viewerPlayerId ? "我的基地" :
    `${projection.players.find(player => player.playerId === location.playerId)?.name ?? "对手"} 的基地`;
}

interface ObjectLabelCandidate {
  readonly objectId: string;
  readonly label: string;
  /** Private/owner-only cards may reveal their name but never their board identity. */
  readonly allowLocation: boolean;
}

function objectLocationLabel(projection: V2Projection, cardNames: CardNameIndex, location: V2PlayOption["destination"]): string {
  if (location.kind === "battlefield") return battlefieldName(projection, cardNames, location.battlefieldId);
  return location.playerId === projection.viewerPlayerId ? "我的基地" :
    `${projection.players.find(player => player.playerId === location.playerId)?.name ?? "对手"} 的基地`;
}

/** Disambiguate repeated names using only the objects' public projected location. */
function duplicateObjectLabels(projection: V2Projection, candidates: readonly ObjectLabelCandidate[], cardNames: CardNameIndex): ReadonlyMap<string, string> {
  const duplicates = new Set<string>();
  const byLabel = new Map<string, ObjectLabelCandidate[]>();
  for (const candidate of candidates) {
    if (byLabel.has(candidate.label)) duplicates.add(candidate.label);
    byLabel.set(candidate.label, [...(byLabel.get(candidate.label) ?? []), candidate]);
  }
  const labels = new Map<string, string>();
  for (const [label, group] of byLabel) {
    if (!duplicates.has(label)) continue;
    const locationGroups = new Map<string, ObjectLabelCandidate[]>();
    for (const candidate of group) {
      const object = projection.objects.find(value => value.objectId === candidate.objectId);
      const locationKey = candidate.allowLocation !== true || object?.location === undefined ? "unknown" :
        object.location.kind === "base" ? `base:${object.location.playerId}` : `battlefield:${object.location.battlefieldId}`;
      locationGroups.set(locationKey, [...(locationGroups.get(locationKey) ?? []), candidate]);
    }
    const locations = [...locationGroups.values()];
    const needsNumber = locationGroups.has("unknown") || locations.some(values => values.length > 1);
    let occurrenceOffset = 0;
    for (const sameLocation of locations) {
      const object = projection.objects.find(value => value.objectId === sameLocation[0]!.objectId);
      const location = sameLocation[0]!.allowLocation !== true || object?.location === undefined ? "位置未明" :
        objectLocationLabel(projection, cardNames, object.location);
      for (const [index, candidate] of sameLocation.entries()) {
        labels.set(candidate.objectId, `${label} · ${location}${needsNumber ? ` #${String(occurrenceOffset + index + 1)}` : ""}`);
      }
      occurrenceOffset += sameLocation.length;
    }
  }
  return labels;
}

/** One panel per battlefield: the battlefield card's name, its controller, and the units there. */
function projectedBattlefieldPanels(projection: V2Projection, cardNames: CardNameIndex, boardObjects: readonly V2ProjectedObject[]): readonly {
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
      title: `战场 · ${battlefieldName(projection, cardNames, battlefieldId)}（${controller}）`,
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



function ChoicePanel({ cardNames, projection: choiceProjection, choice, selectedIds, numberAnswer, optionalAnswer, disabled, onNumberChange, onOptionalAnswerChange, onToggle, onSubmit }: { readonly cardNames: CardNameIndex; readonly projection: V2Projection; readonly choice: V2ChoiceUiState; readonly selectedIds: readonly string[]; readonly numberAnswer: string; readonly optionalAnswer: boolean; readonly disabled: boolean; readonly onNumberChange: (value: string) => void; readonly onOptionalAnswerChange: (value: boolean) => void; readonly onToggle: (id: string) => void; readonly onSubmit: () => void }) {
  if (choice.choice.status === "none") return null;
  const pending = choice.choice;
  const options = pending.options ?? [];
  const multiple = pending.kind === "select-objects" || pending.kind === "order" || (pending.max ?? 1) > 1;
  const objectChoice = pending.kind === "select-objects" || pending.kind === "order";
  // A select-objects choice that may legally pick nothing (min 0) with no
  // projected candidates is answered with an empty selection; treating it as
  // "candidates not yet projected" left the only action as concede (RIFT-1078).
  const emptySelectionOnly = pending.kind === "select-objects" && options.length === 0 && (pending.min ?? 0) === 0;
  const missingCandidates = objectChoice && !emptySelectionOnly &&
    (options.length === 0 || options.some(option => option.objectRef === undefined));
  const selectionComplete = pending.kind === "order" ? selectedIds.length === options.length :
    !objectChoice || (selectedIds.length >= (pending.min ?? 0) && selectedIds.length <= (pending.max ?? Number.POSITIVE_INFINITY));
  return <section className="v2-choice" aria-label="选择请求"><div className="v2-section-heading"><h3>选择请求 · {choiceKindLabel(pending.kind)}</h3><span>{choice.status === "expired" ? "已过期" : choice.answerable ? "请作出选择" : "等待对手回应"}</span></div>
    {(() => {
      // A redacted object id is not a readable name. Keep source metadata absent
      // unless the server supplied a name or that exact id has an official name.
      const sourceName = pending.source === undefined ? undefined :
        pending.source.name === undefined
          ? pending.source.objectId === undefined ? undefined : cardNames.localizedById.get(pending.source.objectId)
          : cardReferenceName(cardNames, pending.source.objectId, pending.source.name);
      return sourceName === undefined ? null : <p className="v2-choice-source">来源：{sourceName}</p>;
    })()}
    {pending.prompt === undefined ? null : <p className="v2-choice-prompt">{pending.prompt}</p>}
    {pending.kind === "number" ? <input aria-label="选择数值" type="number" min={pending.min} max={pending.max} value={numberAnswer} disabled={disabled || !choice.answerable || choice.status === "expired"} onChange={event => onNumberChange(event.currentTarget.value)} /> :
      <div className="v2-choice-options">{options.length === 0 && pending.kind === "optional" ? <><button type="button" aria-pressed={optionalAnswer} disabled={disabled || !choice.answerable || choice.status === "expired"} onClick={() => onOptionalAnswerChange(true)}>接受</button><button type="button" aria-pressed={!optionalAnswer} disabled={disabled || !choice.answerable || choice.status === "expired"} onClick={() => onOptionalAnswerChange(false)}>拒绝</button></> : emptySelectionOnly ? <p className="v2-muted" role="status">没有可选对象，直接提交即可继续。</p> : missingCandidates ? <p className="v2-waiting" role="status">等待服务端投影选择候选；客户端不会从手牌或其他对象自行推导。</p> : (() => {
        const labels = duplicateObjectLabels(choiceProjection, options.flatMap(option => option.objectRef === undefined ? [] :
          [{ objectId: option.objectRef.objectId,
            label: cardReferenceName(cardNames, option.objectRef.objectId, option.label, option.objectRef.objectId)!,
            allowLocation: choiceProjection.objects.find(object => object.objectId === option.objectRef!.objectId)?.visibility === "public" }]), cardNames);
        return options.map(option => <button key={`${option.id}:${String(option.objectRef?.zoneEntryId ?? option.value ?? option.id)}`} type="button" aria-pressed={selectedIds.includes(option.id)} disabled={disabled || !choice.answerable || choice.status === "expired"} onClick={() => onToggle(option.id)}>{
          option.objectRef === undefined ? option.label : labels.get(option.objectRef.objectId) ??
            cardReferenceName(cardNames, option.objectRef.objectId, option.label, option.objectRef.objectId)}{pending.kind === "order" && selectedIds.includes(option.id) ? ` · 第 ${selectedIds.indexOf(option.id) + 1} 位` : ""}</button>);
      })()}</div>}
    {pending.min !== undefined || pending.max !== undefined ? <p className="v2-muted">可选数量：{pending.min ?? 0}–{pending.max ?? "不限"}{multiple ? "（可多选）" : ""}</p> : null}
    {pending.kind === "order" && !missingCandidates && !selectionComplete ? <p className="v2-muted" role="status">请按期望顺序继续点击：第 {selectedIds.length + 1} 张</p> : null}
    <button type="button" className="v2-primary-action" disabled={disabled || !choice.answerable || choice.status === "expired" || missingCandidates || !selectionComplete} onClick={onSubmit}>提交选择</button>
  </section>;
}

function choiceKindLabel(kind: Extract<V2PendingChoice, { status: "pending" }>["kind"]): string {
  return { optional: "可选效果", mode: "模式", "select-objects": "选择对象", order: "排序", number: "数值" }[kind];
}

function ChainRail({ cardNames, projection, cards, onHover }: {
  readonly cardNames: CardNameIndex;
  readonly projection: V2Projection;
  readonly cards: V2PlaymatCards;
  readonly onHover?: (cardId: string | null, clientX?: number) => void;
}) {
  const playerName = (playerId: string): string =>
    projection.players.find(player => player.playerId === playerId)?.name ?? playerId;
  const sourceObject = (objectId: string | undefined): V2ProjectedObject | undefined =>
    objectId === undefined ? undefined : projection.objects.find(candidate => candidate.objectId === objectId);
  const sourceName = (objectId: string): string => {
    const object = sourceObject(objectId);
    return object === undefined ? objectId : projectedObjectCardName(cardNames, object, objectId);
  };
  const viewerId = projection.viewerPlayerId;
  const priorityId = projection.priority.playerId;
  const items = projection.chain.items.map((item, index) => ({ item, n: index + 1 })).reverse();
  const focusId = projection.priority.focusPlayerId;
  return <section className="v2-chain v2t-chain" aria-label="链与优先权">
    <div className="v2-section-heading"><h3>链</h3><span>{items.length === 0 ? "" : `${items.length} 项 · 最上方先结算`}</span></div>
    <p className={`v2t-priority ${priorityId === null ? "is-none" : priorityId === viewerId ? "is-me" : "is-opp"}`}>
      {priorityId ? `优先权：${playerName(priorityId)}` : "无优先权"}
      {priorityId === null ? "" : priorityId === viewerId ? " · 你可以行动" : " · 等待其行动"}
      {projection.priority.window === "showdown" && focusId ? ` · 对决焦点：${playerName(focusId)}` : ""}
    </p>
    {items.length === 0 ? <p className="v2-muted">链为空。出牌、触发和能力会按顺序叠在这里。</p> :
      <ol className="v2t-chain-list">{items.map(({ item, n }, index) => {
        const source = sourceObject(item.sourceObjectId);
        const image = source?.cardId === undefined ? null : cards.image(source.cardId);
        return <li key={item.itemId} {...v2HoverProps(onHover, source?.cardId)} className={`v2t-chain-item${item.controllerPlayerId === viewerId ? " is-me" : " is-opp"}${
          index === 0 ? " is-next" : ""}${item.status === "resolving" ? " is-resolving" : ""}`}>
          <span className="v2t-chain-n">{n}</span>
          {image === null ? <span className="v2t-chain-art is-missing" aria-hidden="true" /> : <img className="v2t-chain-art" src={image} alt="" draggable={false} />}
          <span className="v2t-chain-text"><b>{item.sourceObjectId ? sourceName(item.sourceObjectId) : v2ChainKindLabel(item.kind)}</b>
            <small>{playerName(item.controllerPlayerId)} · {v2ChainKindLabel(item.kind)} · {v2ChainStatusLabel(item.status)}{index === 0 ? " · 下一个结算" : ""}</small></span>
        </li>;
      })}</ol>}
  </section>;
}

function LogPanel({ cardNames, projection, events }: { readonly cardNames: CardNameIndex; readonly projection: V2Projection; readonly events: V2ClientState["events"] }) {
  const allEvents = useMemo(() => {
    const bySeq = new Map<number, V2ClientState["events"][number]>();
    for (const event of projection.events) bySeq.set(event.eventSeq, event);
    for (const event of events) bySeq.set(event.eventSeq, event);
    return [...bySeq.values()].sort((left, right) => left.eventSeq - right.eventSeq);
  }, [events, projection.events]);
  // Housekeeping steps are hidden; the newest entries come last.
  const shown = allEvents.filter(event => !v2EventHidden(event.timingPoint));
  return <section className="v2-log" aria-label="对局日志"><div className="v2-section-heading"><h3>对局记录</h3><span>{shown.length}</span></div>{shown.length === 0 ? <p className="v2-muted">暂无事件</p> : <ol>{shown.slice(-60).map(event => <li key={event.eventSeq}><span>#{event.eventSeq}</span> <b>{v2EventLabel(event.timingPoint)}</b> <small>{eventSummary(event.payload, projection, cardNames)}</small></li>)}</ol>}</section>;
}

function eventSummary(payload: V2EventPayload, projection: V2Projection, cardNames: CardNameIndex): string {
  // `reason` repeats the timing point the entry is already titled with.
  return Object.entries(payload).flatMap(([key, field]) => key !== "reason" && "value" in field ? [
    `${key}: ${eventFieldValue(key, field.value, projection, cardNames)}`
  ] : []).join(" · ");
}

const CARD_IDENTITY_EVENT_FIELDS = new Set([
  "objectId", "cardId", "canonicalCardId", "printingId", "sourceObjectId", "targetObjectId",
  "battlefieldId"
]);

function eventFieldValue(key: string, value: unknown, projection: V2Projection, cardNames: CardNameIndex): string {
  if (typeof value !== "string") return JSON.stringify(value);
  if (!CARD_IDENTITY_EVENT_FIELDS.has(key)) return value;
  const object = projection.objects.find(candidate => candidate.objectId === value || candidate.cardId === value);
  if (object !== undefined) return projectedObjectCardName(cardNames, object, value);
  return cardNames.localizedById.get(value) ?? value;
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
