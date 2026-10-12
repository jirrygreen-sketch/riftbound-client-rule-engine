import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Layers,
  ListChecks,
  Radio,
  RefreshCw,
  ShieldCheck,
  UserCheck
} from "lucide-react";
import { ActionBar } from "./components/ActionBar";
import { ChainPanel } from "./components/ChainPanel";
import { ConnectionPanel } from "./components/ConnectionPanel";
import { DeckBuilder, type DeckBuilderEntry } from "./components/DeckBuilder";
import { LogPanel } from "./components/LogPanel";
import { PlayerBoard } from "./components/PlayerBoard";
import { PromptPanel } from "./components/PromptPanel";
import { PlayableMatchBoard } from "./full-product/PlayableMatchBoard";
import {
  buildPlayableCommand,
  buildPlayableMatchView,
  isFullProductRuleset,
  toPlayableConnectionStatus
} from "./full-product/transport";
import type { ActionSelection } from "./full-product/types";
import {
  buildProjectedGameView,
  buildProjectedPlayerView,
  getActionState,
  type BoardCardInfo
} from "./game/projectionContract";
import { useCardCatalog, type DeckByZone } from "./hooks/useCardCatalog";
import { useGameClient } from "./hooks/useGameClient";
import {
  cardImageServerUrl,
  DEFAULT_CARD_SERVER_URL,
  normalizeCardServerUrl,
  type CatalogCard,
  type DeckZone
} from "./net/CardCatalogClient";
import type { CardInstance, GameEvent } from "@riftbound/protocol";

type AppTab = "deck-builder" | "game-table";

const DECK_ZONE_LABELS: Readonly<Record<DeckZone, string>> = {
  mainDeck: "主卡组",
  runes: "符文",
  legend: "传说",
  champion: "英雄",
  battlefields: "战场",
  sideboard: "备牌"
};

const DECK_ZONE_ORDER: readonly DeckZone[] = [
  "mainDeck",
  "runes",
  "legend",
  "champion",
  "battlefields",
  "sideboard"
];

export function App() {
  const {
    status,
    handshakeReady,
    commandPending,
    requestPending,
    projection,
    lastError,
    errorRevision,
    roomId,
    roomView,
    gameEvents,
    roomEvents,
    session,
    storedSession,
    connect,
    createRoom,
    joinRoom,
    pass,
    playCard,
    submitPlayerCommand,
    concede,
    respondPrompt,
    submitDeck,
    setReady,
    syncEvents,
    clearError
  } = useGameClient();
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [actionSelection, setActionSelection] = useState<ActionSelection>({
    actionId: null,
    cardId: null,
    targetIds: []
  });
  const [pendingOptionId, setPendingOptionId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>("deck-builder");
  const [catalogServerUrl, setCatalogServerUrl] = useState(DEFAULT_CARD_SERVER_URL);
  const [activeDeckZone, setActiveDeckZone] = useState<DeckZone>("mainDeck");
  const [retryToken, setRetryToken] = useState(0);

  const {
    catalog,
    catalogStatus,
    catalogError,
    deck,
    setZoneFromEntries,
    validation,
    validationStatus,
    validationError,
    validateDeck,
    retryCatalog
  } = useCardCatalog({ serverUrl: catalogServerUrl, retryToken });

  const viewerPlayerId = session?.playerId ?? null;
  const roomSelf = useMemo(
    () => roomView?.players.find(player => player.id === viewerPlayerId) ?? null,
    [roomView, viewerPlayerId]
  );
  const roomOpponent = useMemo(
    () => roomView?.players.find(player => player.id !== viewerPlayerId) ?? null,
    [roomView, viewerPlayerId]
  );
  const projectedGame = useMemo(() => buildProjectedGameView(projection), [projection]);
  const self = useMemo(
    () => buildProjectedPlayerView(projectedGame, viewerPlayerId),
    [projectedGame, viewerPlayerId]
  );
  const opponent = useMemo(
    () =>
      buildProjectedPlayerView(
        projectedGame,
        projectedGame.players.find(player => player.id !== viewerPlayerId)?.id ?? null
      ),
    [projectedGame, viewerPlayerId]
  );
  const selectedCard = useMemo<CardInstance | null>(() => {
    if (!self || !selectedCardId) return null;
    return self.hand.find(card => card.instanceId === selectedCardId) ?? null;
  }, [self, selectedCardId]);

  const connected = status === "connected" && handshakeReady;
  const fullProductEnabled = isFullProductRuleset(projection?.rulesetId);
  const mergedGameEvents = useMemo(
    () => mergeEvents(projection?.events ?? [], gameEvents),
    [gameEvents, projection?.events]
  );
  const actionState = getActionState({
    connected,
    commandPending,
    projection,
    viewerPlayerId,
    selectedCard
  });

  const builderCards = useMemo(() => {
    if (!catalog) return [];
    return catalog.cards
      .filter(card => allowedZonesFor(card).includes(activeDeckZone))
      .map(card => ({
        ...card,
        subtitle: card.subtitle ?? "",
        localizedName: card.localizedName ?? card.name,
        localizedSubtitle: card.localizedSubtitle ?? card.subtitle ?? "",
        imageUrl: cardImageServerUrl(catalogServerUrl, card.id)
      }));
  }, [activeDeckZone, catalog, catalogServerUrl]);

  const builderDeck = useMemo<readonly DeckBuilderEntry[]>(() =>
    Object.entries(deck[activeDeckZone])
      .map(([cardId, quantity]) => ({ cardId, quantity }))
      .sort((left, right) => left.cardId.localeCompare(right.cardId)),
    [activeDeckZone, deck]
  );

  const validationIssues = useMemo(() => {
    if (!validation) return [];
    return [
      ...validation.issues.map(issue => ({
        key: `issue:${issue.code}:${issue.canonicalCardId ?? ""}:${issue.cardId ?? ""}:${issue.zone ?? ""}`,
        message: issue.message
      })),
      ...validation.printingIssues.map(issue => ({
        key: `printing:${issue.cardId}:${issue.canonicalCardId ?? ""}:${issue.zone ?? ""}:${issue.status}`,
        message: issue.message
      }))
    ];
  }, [validation]);

  const cardLimits = useMemo(
    () => buildCardLimits(catalog?.cards ?? [], activeDeckZone, deck),
    [activeDeckZone, catalog, deck]
  );

  const resolveCardInfo = useCallback(
    (cardId: string): BoardCardInfo | null => {
      const card =
        catalog?.cards.find(candidate => candidate.id === cardId) ??
        catalog?.cards.find(candidate => candidate.canonicalCardId === cardId) ??
        null;
      if (!card) return null;
      return {
        title: [card.localizedName ?? card.name, card.localizedSubtitle ?? card.subtitle]
          .filter(Boolean)
          .join(" · "),
        imageUrl: card.imageUrl ?? cardImageServerUrl(catalogServerUrl, card.id),
        typeLabel: [card.cardType, ...card.domains].join(" · "),
        implemented: isCardAbilityImplemented(card)
      };
    },
    [catalog, catalogServerUrl]
  );
  const resolvePlayableCard = useCallback(
    (cardId: string) => {
      const info = resolveCardInfo(cardId);
      return info === null ? null : {
        title: info.title,
        imageUrl: info.imageUrl
      };
    },
    [resolveCardInfo]
  );
  const playableMatchView = useMemo(
    () =>
      fullProductEnabled && projection !== null && viewerPlayerId !== null
        ? buildPlayableMatchView({
            projection,
            viewerPlayerId,
            connectionStatus: toPlayableConnectionStatus(status, handshakeReady),
            commandPending,
            resolveCard: resolvePlayableCard
          })
        : null,
    [
      commandPending,
      fullProductEnabled,
      handshakeReady,
      projection,
      resolvePlayableCard,
      status,
      viewerPlayerId
    ]
  );
  const selectedCardLabel = selectedCard
    ? resolveCardInfo(selectedCard.cardId)?.title ?? selectedCard.cardId
    : "未选择手牌";

  const deckCardCount = useMemo(
    () => DECK_ZONE_ORDER.reduce(
      (total, zone) => total + Object.values(deck[zone]).reduce((sum, count) => sum + count, 0),
      0
    ),
    [deck]
  );
  useEffect(() => {
    if (!projection) {
      setSelectedCardId(null);
      return;
    }
    if (
      selectedCardId &&
      !self?.hand.some(card => card.instanceId === selectedCardId)
    ) {
      setSelectedCardId(null);
    }
  }, [projection, selectedCardId, self?.hand]);

  useEffect(() => {
    if (!projection?.prompt) setPendingOptionId(null);
  }, [projection?.prompt]);

  useEffect(() => {
    if (!fullProductEnabled) {
      setActionSelection({ actionId: null, cardId: null, targetIds: [] });
      return;
    }
    if (playableMatchView === null) return;
    const selectedCard = playableMatchView.projection.players
      .find(player => player.id === viewerPlayerId)
      ?.hand.find(card => card.instanceId === actionSelection.cardId);
    if (selectedCard === undefined) {
      setActionSelection({ actionId: null, cardId: null, targetIds: [] });
    }
  }, [
    actionSelection.cardId,
    fullProductEnabled,
    playableMatchView,
    viewerPlayerId
  ]);

  useEffect(() => {
    if (errorRevision > 0) setPendingOptionId(null);
  }, [errorRevision]);

  useEffect(() => {
    if (roomView?.status === "playing") setActiveTab("game-table");
  }, [roomView?.status]);

  const submitCurrentDeck = useCallback(() => {
    submitDeck(deck);
  }, [deck, submitDeck]);

  const toggleReady = useCallback(() => {
    setReady(!(roomSelf?.ready ?? false));
  }, [roomSelf?.ready, setReady]);

  const submitPlayableSelection = useCallback(() => {
    if (playableMatchView === null) return;
    const command = buildPlayableCommand(actionSelection, playableMatchView);
    if (command !== null) submitPlayerCommand(command);
  }, [actionSelection, playableMatchView, submitPlayerCommand]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>Riftbound 桌面客户端</h1>
          <p>服务端权威结算</p>
          <nav className="app-tabs" aria-label="主视图">
            <button
              type="button"
              className={`tab-button ${activeTab === "deck-builder" ? "active" : ""}`}
              onClick={() => setActiveTab("deck-builder")}
            >
              <Layers size={16} aria-hidden />
              组卡
            </button>
            <button
              type="button"
              className={`tab-button ${activeTab === "game-table" ? "active" : ""}`}
              onClick={() => setActiveTab("game-table")}
            >
              <Radio size={16} aria-hidden />
              牌局
            </button>
          </nav>
        </div>
        <ConnectionPanel
          status={status}
          handshakeReady={handshakeReady}
          roomId={roomId}
          storedSession={storedSession}
          lastError={lastError}
          onConnect={connect}
          onCreateRoom={createRoom}
          onJoinRoom={joinRoom}
          onClearError={clearError}
        />
      </header>

      {activeTab === "deck-builder" ? (
        <main className="deck-shell" aria-label="组卡工具">
          <section className="deck-summary" aria-label="卡组状态">
            <div>
              <h2>我的卡组</h2>
              <p>{`${deckCardCount} 张 · ${DECK_ZONE_LABELS[activeDeckZone]}`}</p>
            </div>
            <form
              className="catalog-controls"
              onSubmit={event => {
                event.preventDefault();
                const input = event.currentTarget.elements.namedItem("catalog-server");
                if (input instanceof HTMLInputElement) {
                  const normalized = normalizeCardServerUrl(input.value);
                  if (normalized) setCatalogServerUrl(normalized);
                }
                setRetryToken(token => token + 1);
                retryCatalog();
              }}
            >
              <label className="field">
                <span>仓库服务地址</span>
                <input
                  name="catalog-server"
                  defaultValue={catalogServerUrl}
                  spellCheck={false}
                  autoComplete="url"
                />
              </label>
              <button className="button primary" type="submit">
                <RefreshCw size={16} aria-hidden />
                重试
              </button>
            </form>
            <button
              className="button primary"
              type="button"
              onClick={() => {
                void validateDeck();
              }}
              disabled={catalogStatus !== "ready" || validationStatus === "pending"}
            >
              <ShieldCheck size={16} aria-hidden />
              校验卡组
            </button>
            <button
              className="button primary"
              type="button"
              onClick={submitCurrentDeck}
              disabled={!canSubmitRoomDeck({
                requestPending,
                roomStatus: roomView?.status ?? null
              })}
            >
              <ListChecks size={16} aria-hidden />
              提交卡组
            </button>
            <button
              className="button primary"
              type="button"
              onClick={toggleReady}
              disabled={
                requestPending ||
                roomView === null ||
                roomView.status !== "waiting" ||
                roomSelf?.deckSubmitted !== true
              }
            >
              <UserCheck size={16} aria-hidden />
              {roomSelf?.ready ? "取消准备" : "准备开局"}
            </button>
          </section>

          {roomView ? (
            <section className="lobby-panel" aria-label="房间状态">
              <div>
                <span>房间</span>
                <strong>{`${roomView.roomId} · ${roomView.status}`}</strong>
              </div>
              <div>
                <span>规则</span>
                <strong>{roomView.rulesetId}</strong>
              </div>
              <div>
                <span>我</span>
                <strong>{`卡组 ${roomSelf?.deckSubmitted ? "已提交" : "未提交"} · 准备 ${roomSelf?.ready ? "是" : "否"}`}</strong>
              </div>
              <div>
                <span>对手</span>
                <strong>
                  {roomOpponent
                    ? `${roomOpponent.name} · 卡组 ${roomOpponent.deckSubmitted ? "已提交" : "未提交"} · 准备 ${roomOpponent.ready ? "是" : "否"}`
                    : "等待加入"}
                </strong>
              </div>
              <button className="button" type="button" onClick={syncEvents}>
                <RefreshCw size={16} aria-hidden />
                同步事件
              </button>
            </section>
          ) : null}

          {catalogStatus === "loading" ? (
            <section className="catalog-state">
              <RefreshCw size={20} aria-hidden />
              <p>正在加载官方仓库...</p>
            </section>
          ) : catalogStatus === "error" ? (
            <section className="catalog-state error">
              <AlertTriangle size={20} aria-hidden />
              <p>{catalogError}</p>
              <button className="button primary" type="button" onClick={retryCatalog}>
                <RefreshCw size={16} aria-hidden />
                重试
              </button>
            </section>
          ) : (
            <>
              <nav className="deck-zone-tabs" aria-label="卡组区域">
                {DECK_ZONE_ORDER.map(zone => (
                  <button
                    key={zone}
                    type="button"
                    className={activeDeckZone === zone ? "active" : ""}
                    aria-pressed={activeDeckZone === zone}
                    onClick={() => setActiveDeckZone(zone)}
                  >
                    {DECK_ZONE_LABELS[zone]}
                  </button>
                ))}
              </nav>
              <DeckBuilder
                cards={builderCards}
                deck={builderDeck}
                cardLimits={cardLimits}
                onChange={nextDeck => setZoneFromEntries(activeDeckZone, nextDeck)}
              />
            </>
          )}

          {validationStatus === "error" || validation ? (
            <section className={`validation-panel ${validation?.valid === false ? "invalid" : ""}`} role="status">
              {validationStatus === "error" || validation?.valid === false ? (
                <AlertTriangle size={18} aria-hidden />
              ) : (
                <CheckCircle2 size={18} aria-hidden />
              )}
              <div>
                {validationError ? (
                  <p>{validationError}</p>
                ) : validation?.valid ? (
                  <p>服务端校验通过。</p>
                ) : validation ? (
                  <ul>
                    {validationIssues.map(issue => (
                      <li key={issue.key}>{issue.message}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </section>
          ) : null}
        </main>
      ) : fullProductEnabled && playableMatchView !== null ? (
        <main className="table-shell">
          <PlayableMatchBoard
            view={playableMatchView}
            selection={actionSelection}
            onSelectionChange={setActionSelection}
            onSubmit={() => submitPlayableSelection()}
          />
          <button
            className="button"
            type="button"
            onClick={concede}
            disabled={!connected || commandPending || projection?.phase === "ended"}
          >
            认输
          </button>
        </main>
      ) : (
        <main className="table-shell">
          <PlayerBoard
            player={opponent}
            viewerPlayerId={viewerPlayerId}
            sideName="对手公开区域"
            selectedCardId={null}
            canSelect={false}
            isActive={projection?.activePlayerId === opponent?.playerId}
            resolveCardInfo={resolveCardInfo}
          />

          <ChainPanel projection={projection} />

          <PlayerBoard
            player={self}
            viewerPlayerId={viewerPlayerId}
            sideName="我的区域"
            selectedCardId={selectedCardId}
            onSelectCard={card => {
              setSelectedCardId(card.instanceId);
            }}
            onPlayCard={playCard}
            canSelect={actionState.canPass || actionState.canRespondPrompt}
            isActive={projection?.activePlayerId === viewerPlayerId}
            resolveCardInfo={resolveCardInfo}
          />
        </main>
      )}

      {activeTab === "game-table" ? (
        <footer className="bottom-rail">
          <ActionBar
            selectedCard={selectedCard}
            canAct={actionState.canPass}
            canPlay={actionState.canPlay}
            blockedReason={actionState.blockedReason}
            onPass={pass}
            onPlayCard={playCard}
            selectedCardLabel={selectedCardLabel}
          />
        </footer>
      ) : null}

      {activeTab === "game-table" ? (
        <aside className="side-rail">
          <PromptPanel
            prompt={projection?.prompt ?? null}
            viewerPlayerId={viewerPlayerId}
            pendingOptionId={pendingOptionId}
            disabled={commandPending || !actionState.canRespondPrompt}
            onRespond={(promptId, optionId, stateVersion) => {
              setPendingOptionId(optionId);
              respondPrompt(promptId, optionId, stateVersion);
            }}
          />
          <LogPanel log={mergedGameEvents} />
        </aside>
      ) : null}
    </div>
  );
}

export function allowedZonesFor(card: CatalogCard): readonly DeckZone[] {
  if (card.allowedZones !== undefined) return card.allowedZones;
  return allowedZonesFromCardType(card);
}

export function isCardAbilityImplemented(card: CatalogCard): boolean {
  const supportedFoundationTypes = new Set([
    "unit",
    "spell",
    "battlefield",
    "champion",
    "legend"
  ]);

  return card.ability.trim().length === 0 &&
    supportedFoundationTypes.has(card.cardType.trim().toLowerCase());
}

export function canSubmitRoomDeck(options: {
  requestPending: boolean;
  roomStatus: "waiting" | "playing" | "ended" | null;
}): boolean {
  return !options.requestPending && options.roomStatus === "waiting";
}

function mergeEvents(
  left: readonly GameEvent[],
  right: readonly GameEvent[]
): readonly GameEvent[] {
  const bySeq = new Map(left.map(event => [event.seq, event]));
  for (const event of right) bySeq.set(event.seq, event);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

function allowedZonesFromCardType(card: CatalogCard): readonly DeckZone[] {
  const cardType = card.cardType.toLowerCase();
  const tags = card.tags.map(tag => tag.toLowerCase());
  if (cardType === "rune") return ["runes"];
  if (cardType === "legend") return ["legend"];
  if (cardType === "battlefield") return ["battlefields"];
  if (cardType === "champion" || tags.includes("champion")) {
    return ["mainDeck", "champion", "sideboard"];
  }
  return ["mainDeck", "sideboard"];
}

export function limitFor(card: CatalogCard, zone: DeckZone): number {
  const zoneLimit =
    zone === "runes" ? 12 :
    zone === "battlefields" ? 1 :
    zone === "legend" ? 1 :
    3;
  return card.maxCopies === undefined ? zoneLimit : Math.min(card.maxCopies, zoneLimit);
}

export function buildCardLimits(
  cards: readonly CatalogCard[],
  activeZone: DeckZone,
  deck: DeckByZone
): Map<string, number> {
  const candidates = new Map<string, { limit: number; hasLegalPrinting: boolean }>();

  const limits = new Map<string, number>();
  for (const card of cards) {
    if (!allowedZonesFor(card).includes(activeZone)) continue;

    const current = candidates.get(card.canonicalCardId) ?? {
      limit: 0,
      hasLegalPrinting: false
    };
    const printingLimit = limitFor(card, activeZone);
    if (
      card.banned !== true &&
      card.available !== false &&
      printingLimit > 0
    ) {
      current.limit = Math.max(current.limit, printingLimit);
      current.hasLegalPrinting = true;
    }
    candidates.set(card.canonicalCardId, current);
  }

  for (const [canonicalCardId, candidate] of candidates) {
    const usedElsewhere = sharedLimitZones(activeZone)
      .filter(zone => zone !== activeZone)
      .reduce(
        (total, zone) => total + zoneCanonicalCount(deck, zone, canonicalCardId, cards),
        0
      );
    limits.set(
      canonicalCardId,
      candidate.hasLegalPrinting
        ? Math.max(0, candidate.limit - usedElsewhere)
        : 0
    );
  }
  return limits;
}

export function sharedLimitZones(activeZone: DeckZone): readonly DeckZone[] {
  const sharedZones: readonly DeckZone[] = ["mainDeck", "champion", "sideboard"];
  return sharedZones.includes(activeZone) ? sharedZones : [activeZone];
}

export function zoneCanonicalCount(
  deck: DeckByZone,
  zone: DeckZone,
  canonicalCardId: string,
  cards: readonly CatalogCard[]
): number {
  const printingIds = new Set(
    cards
      .filter(card => card.canonicalCardId === canonicalCardId)
      .map(card => card.id)
  );
  return Object.entries(deck[zone]).reduce(
    (total, [printingId, quantity]) =>
      printingIds.has(printingId) ? total + quantity : total,
    0
  );
}
