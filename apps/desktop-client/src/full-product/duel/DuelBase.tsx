import { useRef } from "react";
import type {
  DuelProjectionTransport,
  DuelWireBase,
  DuelWireGearPermanent,
  DuelWireLegendPermanent,
  DuelWirePlayingPlayer,
  DuelWireResourceBase,
  DuelWireUnit
} from "@riftbound/protocol";
import {
  DUEL_BASE_RUNE_LABEL,
  DUEL_CHAMPION_ROLE_LABEL,
  DUEL_DOMAIN_LABELS,
  DUEL_GOLD_LABEL,
  DUEL_LEGEND_ROLE_LABEL,
  DUEL_MAIN_DECK_LABEL,
  DUEL_RUNE_DECK_LABEL,
  DUEL_TRASH_LABEL,
  duelLegendPowerDomains,
  nameFor,
  useDuelCardInteraction
} from "./duel-board-model";
import type { DuelDeckCounts } from "./DuelBoardViewModel";
import type { DuelSides } from "./duel-board-model";
import { BaseRuneList, GoldTokenList, GearList, IdentityRow, LegendState, UnitGroupList } from "./DuelCardComponents";

export function PlaymatPile({ playerName, label, count, area }: {
  readonly playerName: string;
  readonly label: string;
  readonly count: number;
  readonly area: string;
}) {
  return <dl className={`full-product-duel-mat-pile full-product-duel-mat-${area}`}>
    <dt>{label}</dt><dd aria-label={`${playerName} ${label}`}>{count}</dd>
  </dl>;
}
export function BaseBand({
  base, resourceBase, player, deck, units, gears, legend, seatId,
  position, projection, sides, resolveCardTitle, resolveCardImage, resolveCardDomains, onInspect
}: {
  readonly base: DuelWireBase;
  readonly resourceBase: DuelWireResourceBase | null;
  readonly player: DuelWirePlayingPlayer;
  readonly deck: DuelDeckCounts | null;
  readonly units: readonly DuelWireUnit[];
  readonly gears: readonly DuelWireGearPermanent[];
  readonly legend: DuelWireLegendPermanent | null;
  readonly seatId: string;
  readonly position: string;
  readonly projection: DuelProjectionTransport;
  readonly sides: DuelSides;
  readonly resolveCardTitle: (cardId: string) => string;
  readonly resolveCardImage?: (cardId: string) => string | null;
  readonly resolveCardDomains?: (cardId: string) => readonly string[];
  readonly onInspect?: (cardId: string) => void;
}) {
  const playerName = nameFor(projection, seatId);
  const cardInteraction = useDuelCardInteraction();
  const runes = resourceBase?.baseRunes ?? [];
  const gold = resourceBase?.goldTokens ?? [];
  const ribbon = useRef<HTMLDivElement>(null);
  const pool = projection.match.stage === "playing"
    ? projection.match.resources.players.find(item => item.playerId === seatId)?.runePool : undefined;
  const legendDomains = duelLegendPowerDomains(resolveCardDomains?.(player.legend.cardId) ?? []);
  const points = projection.match.stage === "playing"
    ? projection.match.scoring.players.find(item => item.playerId === seatId)?.points : undefined;
  return (
    <section className={`full-product-duel-base full-product-duel-playmat-side${cardInteraction?.dropTargetState("base", base.locationId) ?? ""}`}
      data-position={position} data-owner-player-id={base.ownerPlayerId}
      data-location-id={base.locationId} data-drop-kind="base" data-drop-location={base.locationId}
      aria-label={`${playerName} 卡垫区域`}>
      <div className="full-product-duel-mat-identity" role="group" aria-label={`${playerName} 传说与英雄`}>
        <dl className="full-product-duel-setup-identity">
          <IdentityRow role={DUEL_LEGEND_ROLE_LABEL} cardId={player.legend.cardId}
            resolveCardTitle={resolveCardTitle} resolveCardImage={resolveCardImage} onInspect={onInspect} />
          <IdentityRow role={DUEL_CHAMPION_ROLE_LABEL} cardId={player.champion?.cardId ?? null}
            resolveCardTitle={resolveCardTitle} resolveCardImage={resolveCardImage} onInspect={onInspect} />
        </dl>
        {legend ? <LegendState legend={legend} projection={projection} /> : null}
      </div>
      <div className="full-product-duel-mat-base" role="group" aria-label={`${playerName} 基地`}>
        <header className="full-product-duel-base-head">
          <h4 className="full-product-duel-base-title">{playerName} 基地</h4>
          {points !== undefined ? <span className="full-product-duel-mat-score" aria-label={`${playerName} 得分`}>{points}</span> : null}
          <span className="full-product-duel-base-scroll">
            <button type="button" aria-label={`向左查看${playerName}基地卡片`} title="向左查看基地卡片"
              onClick={() => ribbon.current?.scrollBy({ left: -240, behavior: "smooth" })}>‹</button>
            <button type="button" aria-label={`向右查看${playerName}基地卡片`} title="向右查看基地卡片"
              onClick={() => ribbon.current?.scrollBy({ left: 240, behavior: "smooth" })}>›</button>
          </span>
        </header>
        <div className="full-product-duel-base-body" ref={ribbon} tabIndex={0}
          role="region" aria-label={`${playerName}基地卡片带`}>
          <GearList locationId={base.locationId} gears={gears} units={units} projection={projection}
            resolveCardTitle={resolveCardTitle} resolveCardImage={resolveCardImage} onInspect={onInspect} />
          <UnitGroupList units={units} projection={projection} sides={sides}
            resolveCardTitle={resolveCardTitle} resolveCardImage={resolveCardImage} onInspect={onInspect} />
        </div>
      </div>
      {deck ? <PlaymatPile playerName={playerName} label={DUEL_MAIN_DECK_LABEL} count={deck.mainDeck} area="main-deck" /> : null}
      {deck ? <PlaymatPile playerName={playerName} label={DUEL_RUNE_DECK_LABEL} count={deck.runeDeck} area="rune-deck" /> : null}
      <div className="full-product-duel-mat-runes" role="group" aria-label={`${playerName} 符文区`}>
        <BaseRuneList playerName={playerName} ownerPlayerId={seatId} runes={runes} resolveCardTitle={resolveCardTitle}
          resolveCardImage={resolveCardImage} onInspect={onInspect} />
        <GoldTokenList playerName={playerName} ownerPlayerId={seatId} tokens={gold} />
        {pool ? <dl className="full-product-duel-mat-pool" aria-label={`${playerName} 当前资源池`}>
          <div><dt>能量：</dt><dd>{pool.energy}</dd></div>
          {legendDomains.map(domain => <div key={domain}><dt>{DUEL_DOMAIN_LABELS[domain]}符能：</dt><dd>{pool.power[domain]}</dd></div>)}
          <div><dt>通用符能：</dt><dd>{pool.power.any}</dd></div>
        </dl> : null}
      </div>
      {deck ? <PlaymatPile playerName={playerName} label={DUEL_TRASH_LABEL} count={deck.trash} area="trash" /> : null}
    </section>
  );
}
