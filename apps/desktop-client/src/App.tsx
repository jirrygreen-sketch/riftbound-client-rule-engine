import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Layers, Radio, RefreshCw, ShieldCheck } from "lucide-react";
import { ActionBar } from "./components/ActionBar";
import { ChainPanel } from "./components/ChainPanel";
import { ConnectionPanel } from "./components/ConnectionPanel";
import { DeckBuilder, type DeckBuilderEntry } from "./components/DeckBuilder";
import { LogPanel } from "./components/LogPanel";
import { PlayerBoard } from "./components/PlayerBoard";
import { PromptPanel } from "./components/PromptPanel";
import { useCardCatalog, type DeckByZone } from "./hooks/useCardCatalog";
import { useGameClient } from "./hooks/useGameClient";
import {
  cardImageServerUrl,
  DEFAULT_CARD_SERVER_URL,
  normalizeCardServerUrl,
  type CatalogCard,
  type DeckZone
} from "./net/CardCatalogClient";
import { TRIGGER_CONQUER_CARD, type CardInstance } from "@riftbound/protocol";

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
    projection,
    lastError,
    errorRevision,
    roomId,
    session,
    storedSession,
    connect,
    createRoom,
    joinRoom,
    pass,
    playCard,
    respondPrompt,
    clearError
  } = useGameClient();
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
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
  const self = projection?.players.find(player => player.id === viewerPlayerId) ?? null;
  const opponent = projection?.players.find(player => player.id !== viewerPlayerId) ?? null;
  const selectedCard = useMemo<CardInstance | null>(() => {
    if (!self || !selectedCardId) return null;
    return self.hand.find(card => card.instanceId === selectedCardId) ?? null;
  }, [self, selectedCardId]);

  const connected = status === "connected" && handshakeReady;
  const canAct =
    connected &&
    !commandPending &&
    projection !== null &&
    projection.players.length === 2 &&
    projection.phase !== "ended" &&
    projection.prompt === null &&
    projection.activePlayerId === viewerPlayerId;
  const canPlay = canAct && selectedCard?.cardId === TRIGGER_CONQUER_CARD.id;

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

  const cardLimits = useMemo(() => {
    const limits = new Map<string, number>();
    if (!catalog) return limits;
    for (const card of catalog.cards) {
      if (card.banned === true) {
        limits.set(card.canonicalCardId, 0);
        continue;
      }
      if (!allowedZonesFor(card).includes(activeDeckZone)) continue;
      const limit = limitFor(card, activeDeckZone);
      const usedElsewhere = sharedLimitZones(activeDeckZone)
        .filter(zone => zone !== activeDeckZone)
        .reduce(
          (total, zone) =>
            total + zoneCanonicalCount(deck, zone, card.canonicalCardId, catalog.cards),
          0
        );
      const remaining = limit - usedElsewhere;
      limits.set(card.canonicalCardId, Math.max(0, remaining));
    }
    return limits;
  }, [activeDeckZone, catalog, deck]);

  const deckCardCount = useMemo(
    () => DECK_ZONE_ORDER.reduce(
      (total, zone) => total + Object.values(deck[zone]).reduce((sum, count) => sum + count, 0),
      0
    ),
    [deck]
  );
  const blockedReason =
    !connected
      ? "尚未连接游戏服务端"
      : !projection
        ? "等待对手加入"
        : commandPending
          ? "操作确认中"
          : projection.phase === "ended"
            ? "对局已结束"
            : projection.prompt
              ? "请先响应 Prompt"
              : projection.activePlayerId !== viewerPlayerId
                ? "尚未轮到你的回合"
                : null;

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
    if (errorRevision > 0) setPendingOptionId(null);
  }, [errorRevision]);

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
          </section>

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
      ) : (
        <main className="table-shell">
          <PlayerBoard
            player={opponent}
            sideName="对手公开区域"
            selectedCardId={null}
            viewerIsSelf={false}
            isActive={projection?.activePlayerId === opponent?.id}
          />

          <ChainPanel projection={projection} />

          <PlayerBoard
            player={self}
            sideName="我的区域"
            selectedCardId={selectedCardId}
            onSelectCard={card => {
              setSelectedCardId(card.instanceId);
              if (
                canAct &&
                card.cardId === TRIGGER_CONQUER_CARD.id
              ) {
                playCard(card.instanceId);
              }
            }}
            viewerIsSelf
            isActive={projection?.activePlayerId === viewerPlayerId}
          />
        </main>
      )}

      {activeTab === "game-table" ? (
        <footer className="bottom-rail">
          <ActionBar
            selectedCard={selectedCard}
            canAct={Boolean(canAct)}
            canPlay={Boolean(canPlay)}
            blockedReason={blockedReason}
            onPass={pass}
            onPlayCard={playCard}
          />
        </footer>
      ) : null}

      {activeTab === "game-table" ? (
        <aside className="side-rail">
          <PromptPanel
            prompt={projection?.prompt ?? null}
            viewerPlayerId={viewerPlayerId}
            pendingOptionId={pendingOptionId}
            disabled={commandPending}
            onRespond={(promptId, optionId, stateVersion) => {
              setPendingOptionId(optionId);
              respondPrompt(promptId, optionId, stateVersion);
            }}
          />
          <LogPanel log={projection?.events ?? []} />
        </aside>
      ) : null}
    </div>
  );
}

export function allowedZonesFor(card: CatalogCard): readonly DeckZone[] {
  if (card.allowedZones !== undefined) return card.allowedZones;
  return allowedZonesFromCardType(card);
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
