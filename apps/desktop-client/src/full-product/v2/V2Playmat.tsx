import type { MouseEvent, PointerEvent, ReactNode } from "react";
import type { DuelWireScoring } from "@riftbound/protocol";
import type {
  V2PlayerSnapshot,
  V2ProjectedObject,
  V2Projection
} from "../../../../../packages/protocol/src/v2/index.js";
import type { CatalogCard } from "../../net/CardCatalogClient";
import { preferLocalCardImage } from "../../net/local-card-images";
import {
  DUEL_CARD_ROLE_LANDSCAPE,
  DUEL_CONTESTED_LABEL,
  DUEL_DOMAIN_LABELS,
  DUEL_READY_LABEL
} from "../duel/duel-board-model";
import { CardArt, CardPreviewOverlay, DuelScoreRail, HiddenHand, PlaymatPile } from "../duel/DuelBoardComponents";
import type { CardTextData } from "../duel/card-text";
import { projectedObjectCardName, type CardNameIndex } from "./card-names";
import { v2RuneCanAddEnergy, v2RuneCanAddPower } from "./playmat-interactions";
import "../DuelMatchBoard.css";

/**
 * Playmat presentation for the V2 board (RIFT-1125).
 *
 * The legacy Duel surface is bound to the v1 wire projection, so the V2 board
 * reuses its table shell, card faces and styles but reads only the V2
 * projection. Everything here is display: commands stay in V2MatchBoard.
 */

/**
 * Official Chinese state word for an exhausted permanent: the zh_CN card
 * gallery writes it as 休眠 (e.g. ven-075-166 / unl-136-219 “此牌以休眠状态进场”).
 */
export const V2_EXHAUSTED_LABEL = "休眠";

/** Drag-and-drop and rune handling the board passes into the playmat (RIFT-1144). */
export interface V2BoardInteraction {
  /** While a drag is active: how a drop zone should look; null when nothing is being dragged. */
  readonly dropStateFor: (dropKey: string) => "legal" | "over" | "blocked" | null;
  /** Pointer-down handler that starts dragging this permanent, or null when it cannot move now. */
  readonly dragHandlerFor: (object: V2ProjectedObject) => ((event: PointerEvent<HTMLElement>) => void) | null;
  /** Rune clicks for the viewer's own runes. */
  readonly rune?: {
    readonly enabled: boolean;
    readonly onEnergy: (rune: V2ProjectedObject) => void;
    readonly onPower: (rune: V2ProjectedObject) => void;
  };
}

function dropZoneProps(interaction: V2BoardInteraction | undefined, dropKey: string): Record<string, string> {
  const state = interaction?.dropStateFor(dropKey) ?? null;
  return state === null ? { "data-drop-key": dropKey } : { "data-drop-key": dropKey, "data-drop-state": state };
}

/** Catalog facts the playmat needs: card art, a legend's two domains and card text. */
export interface V2CardLookup {
  readonly imageById: ReadonlyMap<string, string>;
  readonly domainsById: ReadonlyMap<string, readonly string[]>;
  readonly cardById: ReadonlyMap<string, CatalogCard>;
}

export function buildV2CardLookup(cards: readonly CatalogCard[]): V2CardLookup {
  const imageById = new Map<string, string>();
  const domainsById = new Map<string, readonly string[]>();
  const cardById = new Map<string, CatalogCard>();
  for (const card of cards) {
    for (const id of [card.id, card.canonicalCardId]) {
      if (!id) continue;
      if (!cardById.has(id)) cardById.set(id, card);
      const imageUrl = preferLocalCardImage(card.id, card.imageUrl, card.imageUrl);
      if (imageUrl) imageById.set(id, imageUrl);
      if (card.domains.length > 0) domainsById.set(id, card.domains);
    }
  }
  return { imageById, domainsById, cardById };
}

/** Card faces shown by the playmat, resolved from the projection plus the catalog. */
export interface V2PlaymatCards {
  readonly title: (cardId: string) => string;
  readonly image: (cardId: string) => string | null;
  readonly domains: (cardId: string) => readonly string[];
  readonly text: (cardId: string) => CardTextData | undefined;
  readonly card: (cardId: string) => CatalogCard | undefined;
  readonly objectName: (object: V2ProjectedObject) => string;
}

export function v2PlaymatCards(projection: V2Projection, names: CardNameIndex, lookup: V2CardLookup): V2PlaymatCards {
  const titles = new Map<string, string>();
  for (const object of projection.objects) {
    if (object.cardId !== undefined && !titles.has(object.cardId)) {
      titles.set(object.cardId, projectedObjectCardName(names, object, object.cardId));
    }
  }
  return {
    title: cardId => titles.get(cardId) ?? names.localizedById.get(cardId) ?? cardId,
    image: cardId => lookup.imageById.get(cardId) ?? null,
    domains: cardId => lookup.domainsById.get(cardId) ?? [],
    text: cardId => lookup.cardById.get(cardId),
    card: cardId => lookup.cardById.get(cardId),
    objectName: object => projectedObjectCardName(names, object)
  };
}

export function playerName(projection: V2Projection, playerId: string | null | undefined): string {
  if (playerId === null || playerId === undefined) return "无";
  return projection.players.find(player => player.playerId === playerId)?.name ?? playerId;
}

function controllerOf(object: V2ProjectedObject): string {
  return object.controllerPlayerId ?? object.ownerPlayerId;
}

function domainLabel(domain: string): string {
  const key = Object.keys(DUEL_DOMAIN_LABELS).find(name => name.toLowerCase() === domain.toLowerCase());
  return key === undefined ? domain : DUEL_DOMAIN_LABELS[key as keyof typeof DUEL_DOMAIN_LABELS];
}

function powerAmount(power: Readonly<Record<string, number>>, domain: string): number {
  const key = Object.keys(power).find(name => name.toLowerCase() === domain.toLowerCase());
  return key === undefined ? 0 : power[key] ?? 0;
}

/** One permanent (unit or gear) with its face, name, readiness, Might and damage. */
export function V2PermanentChip({ object, cards, onInspect, onDragStart }: {
  readonly object: V2ProjectedObject;
  readonly cards: V2PlaymatCards;
  readonly onInspect: (cardId: string) => void;
  readonly onDragStart?: ((event: PointerEvent<HTMLElement>) => void) | null;
}) {
  const name = cards.objectName(object);
  return (
    <li className={`full-product-duel-unit${onDragStart ? " v2-draggable" : ""}`} data-object-id={object.objectId}
      data-controller-player-id={controllerOf(object)} data-readied={object.exhausted === true ? "false" : "true"}
      {...(onDragStart ? { onPointerDown: onDragStart, title: `拖动 ${name} 到其他位置即可移动` } : {})}>
      {object.cardId !== undefined && !object.faceDown ? (
        <CardArt cardId={object.cardId} resolveCardTitle={cards.title} resolveCardImage={cards.image}
          className="full-product-duel-unit-thumb" onInspect={onInspect} />
      ) : <span className="full-product-duel-card-back" aria-hidden="true" />}
      <span className="full-product-duel-unit-details">
        <span className="full-product-duel-unit-name">{object.faceDown ? "牌面朝下" : name}</span>
        <span className="full-product-duel-unit-state">
          <span className="full-product-duel-unit-readied">{object.exhausted === true ? V2_EXHAUSTED_LABEL : DUEL_READY_LABEL}</span>
          {object.might !== undefined ? <span className="full-product-duel-unit-might">战力 {object.might}</span> : null}
          {object.damage !== undefined && object.damage > 0 ? (
            <span className="full-product-duel-unit-damage">伤害 {object.damage}</span>
          ) : null}
        </span>
      </span>
    </li>
  );
}

function PermanentGroups({ projection, objects, cards, onInspect, interaction }: {
  readonly projection: V2Projection;
  readonly objects: readonly V2ProjectedObject[];
  readonly cards: V2PlaymatCards;
  readonly onInspect: (cardId: string) => void;
  readonly interaction?: V2BoardInteraction | undefined;
}) {
  if (objects.length === 0) return <p className="full-product-duel-empty">暂无公开牌</p>;
  // Opposing seat first, matching the order of the two playmat sides.
  const controllers = [...new Set(objects.map(controllerOf))]
    .sort((left, right) => Number(left === projection.viewerPlayerId) - Number(right === projection.viewerPlayerId));
  return (
    <div className="full-product-duel-unit-groups">
      {controllers.map(controllerId => (
        <div key={controllerId} className="full-product-duel-unit-group" data-controller-player-id={controllerId}
          aria-label={`${playerName(projection, controllerId)} 单位`}>
          <h5 className="full-product-duel-unit-group-owner">{playerName(projection, controllerId)}</h5>
          <ul className="full-product-duel-unit-list">
            {objects.filter(object => controllerOf(object) === controllerId).map(object => (
              <V2PermanentChip key={object.objectId} object={object} cards={cards} onInspect={onInspect}
                onDragStart={interaction?.dragHandlerFor(object) ?? null} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function IdentitySlot({ role, object, cards, onInspect }: {
  readonly role: string;
  readonly object: V2ProjectedObject | undefined;
  readonly cards: V2PlaymatCards;
  readonly onInspect: (cardId: string) => void;
}) {
  return (
    <div>
      <dt>{role}</dt>
      <dd>
        {object?.cardId !== undefined ? (
          <CardArt cardId={object.cardId} resolveCardTitle={cards.title} resolveCardImage={cards.image}
            className="full-product-duel-identity-thumb" onInspect={onInspect} />
        ) : null}
        <span className="full-product-duel-identity-title">{object === undefined ? "未入场" : cards.objectName(object)}</span>
      </dd>
    </div>
  );
}

/** One rune: a large card tile; the viewer's own runes are buttons (left: Energy, right: Power). */
function RuneTile({ rune, cards, onInspect, runeActions }: {
  readonly rune: V2ProjectedObject;
  readonly cards: V2PlaymatCards;
  readonly onInspect: (cardId: string) => void;
  readonly runeActions: V2BoardInteraction["rune"] | undefined;
}) {
  const name = cards.objectName(rune);
  const state = rune.exhausted === true ? V2_EXHAUSTED_LABEL : DUEL_READY_LABEL;
  const face = rune.cardId !== undefined
    ? <img className="v2-rune-face" src={cards.image(rune.cardId) ?? undefined} alt="" draggable={false}
      {...(cards.image(rune.cardId) === null ? { "data-missing": "true" } : {})} />
    : <span className="v2-rune-face" data-missing="true" aria-hidden="true" />;
  if (runeActions === undefined) {
    return (
      <li className="full-product-duel-baserune v2-rune" data-readied={rune.exhausted === true ? "false" : "true"}
        title={`${name}（${state}）`}>
        {rune.cardId !== undefined ? (
          <CardArt cardId={rune.cardId} resolveCardTitle={cards.title} resolveCardImage={cards.image}
            className="full-product-duel-baserune-thumb" onInspect={onInspect} />
        ) : null}
        <span className="full-product-duel-baserune-caption">
          <span className="full-product-duel-baserune-domain">{name}</span>
          <span className="full-product-duel-baserune-state">{state}</span>
        </span>
      </li>
    );
  }
  const canEnergy = runeActions.enabled && v2RuneCanAddEnergy(rune);
  const canPower = runeActions.enabled && v2RuneCanAddPower(rune);
  const hint = `${name}（${state}）：左键横置取能量${canEnergy ? "" : "（不可用）"}，右键回收取符能${canPower ? "" : "（不可用）"}`;
  return (
    <li className="full-product-duel-baserune v2-rune" data-readied={rune.exhausted === true ? "false" : "true"}>
      <button type="button" className="v2-rune-button" aria-label={hint} title={hint}
        data-can-energy={canEnergy ? "true" : "false"} data-can-power={canPower ? "true" : "false"}
        aria-disabled={!canEnergy && !canPower}
        onClick={() => { if (canEnergy) runeActions.onEnergy(rune); }}
        onContextMenu={(event: MouseEvent<HTMLButtonElement>) => {
          event.preventDefault();
          if (canPower) runeActions.onPower(rune);
        }}>
        {face}
        <span className="full-product-duel-baserune-caption">
          <span className="full-product-duel-baserune-domain">{name}</span>
          <span className="full-product-duel-baserune-state">{state}</span>
        </span>
      </button>
    </li>
  );
}

/**
 * One seat's half of the playmat: legend and champion, base permanents, main
 * deck / rune deck / trash counts, rune row and the current rune pool. The
 * opposing seat is mirrored by the shared CSS (`data-position="opponent"`).
 */
export function V2PlaymatSide({ projection, player, position, baseObjects, runes, cards, onInspect, interaction }: {
  readonly projection: V2Projection;
  readonly player: V2PlayerSnapshot;
  readonly position: "player" | "opponent";
  readonly baseObjects: readonly V2ProjectedObject[];
  readonly runes: readonly V2ProjectedObject[];
  readonly cards: V2PlaymatCards;
  readonly onInspect: (cardId: string) => void;
  readonly interaction?: V2BoardInteraction | undefined;
}) {
  const name = player.name;
  const isViewer = player.playerId === projection.viewerPlayerId;
  const legend = projection.objects.find(object => object.zone === "legend" && object.ownerPlayerId === player.playerId);
  const champion = projection.objects.find(object => object.zone === "champion" && object.ownerPlayerId === player.playerId);
  const domains = legend?.cardId === undefined ? [] : cards.domains(legend.cardId);
  const points = projection.scoring.players.find(value => value.playerId === player.playerId)?.points ?? player.score;
  const shownDomains = new Set(domains.map(domain => domain.toLowerCase()));
  // Universal power has its own fixed row; any other non-zero pool entry that
  // is not one of the Legend's two domains is still shown, never hidden.
  const otherPower = Object.entries(player.power).filter(([domain, amount]) =>
    domain.toLowerCase() !== "any" && amount > 0 && !shownDomains.has(domain.toLowerCase()));
  return (
    <section className="full-product-duel-base full-product-duel-playmat-side" data-position={position}
      data-owner-player-id={player.playerId} aria-label={`${name} 卡垫区域`}>
      <div className="full-product-duel-mat-identity" role="group" aria-label={`${name} 传奇与英雄`}>
        <dl className="full-product-duel-setup-identity">
          <IdentitySlot role="传奇" object={legend} cards={cards} onInspect={onInspect} />
          <IdentitySlot role="英雄" object={champion} cards={cards} onInspect={onInspect} />
        </dl>
      </div>
      <div className="full-product-duel-mat-base" role="group" aria-label={`${name} 基地`}
        {...dropZoneProps(interaction, `base:${player.playerId}`)}>
        <header className="full-product-duel-base-head">
          <h4 className="full-product-duel-base-title">{name} 基地</h4>
          <span className="full-product-duel-mat-score" aria-label={`${name} 得分`}>{points}</span>
        </header>
        <div className="full-product-duel-base-body">
          <article className="v2-zone" aria-label={isViewer ? "我的基地" : "对手基地"}>
            <PermanentGroups projection={projection} objects={baseObjects} cards={cards} onInspect={onInspect}
              interaction={interaction} />
          </article>
        </div>
      </div>
      <PlaymatPile playerName={name} label="主牌堆" count={player.deckCount} area="main-deck" />
      <PlaymatPile playerName={name} label="符文库" count={player.runeDeckCount} area="rune-deck" />
      <div className="full-product-duel-mat-runes" role="group" aria-label={`${name} 符文区`}>
        <article className="v2-zone" aria-label={isViewer ? "我的符文" : "对手公开符文"}>
          {runes.length === 0 ? <p className="full-product-duel-empty">暂无公开牌</p> : (
            <ul className="full-product-duel-baserune-list">
              {runes.map(rune => (
                <RuneTile key={rune.objectId} rune={rune} cards={cards} onInspect={onInspect}
                  runeActions={isViewer ? interaction?.rune : undefined} />
              ))}
            </ul>
          )}
        </article>
        <dl className="full-product-duel-mat-pool" aria-label={`${name} 当前资源池`}>
          <div><dt>能量：</dt><dd>{player.energy}</dd></div>
          {domains.map(domain => (
            <div key={domain}><dt>{domainLabel(domain)}符能：</dt><dd>{powerAmount(player.power, domain)}</dd></div>
          ))}
          {otherPower.map(([domain, amount]) => (
            <div key={domain}><dt>{domainLabel(domain)}符能：</dt><dd>{amount}</dd></div>
          ))}
          <div><dt>通用符能：</dt><dd>{powerAmount(player.power, "any")}</dd></div>
          <div><dt>经验：</dt><dd>{player.xp}</dd></div>
        </dl>
      </div>
      <PlaymatPile playerName={name} label="废牌堆" count={player.zoneCounts.trash ?? 0} area="trash" />
    </section>
  );
}

/** One shared battlefield: its card, controller and the permanents there, grouped by controller. */
export function V2BattlefieldCard({ projection, battlefieldId, objects, cards, onInspect, interaction }: {
  readonly projection: V2Projection;
  readonly battlefieldId: string;
  readonly objects: readonly V2ProjectedObject[];
  readonly cards: V2PlaymatCards;
  readonly onInspect: (cardId: string) => void;
  readonly interaction?: V2BoardInteraction | undefined;
}) {
  const card = projection.objects.find(object => object.objectId === battlefieldId);
  const title = card === undefined ? battlefieldId : cards.objectName(card);
  const snapshot = projection.battlefields?.find(field => field.battlefieldId === battlefieldId);
  const controllerId = snapshot?.controllerPlayerId ?? null;
  const controllerText = controllerId === null ? "无人控制" : controllerId === projection.viewerPlayerId ? "我方控制" :
    `${playerName(projection, controllerId)} 控制`;
  const combatHere = projection.combat?.status === "active" && projection.combat.battlefieldId === battlefieldId;
  return (
    <section className={`full-product-duel-battlefield${combatHere ? " v2-battlefield-in-combat" : ""}`}
      data-location-id={battlefieldId} aria-label={`中央战场 ${title}`}
      {...dropZoneProps(interaction, `battlefield:${battlefieldId}`)}>
      <header className="full-product-duel-battlefield-head">
        <div className="full-product-duel-battlefield-head-main">
          <h4 className="full-product-duel-battlefield-title">{title}</h4>
          <div className="full-product-duel-battlefield-tags">
            <span>控制者：{controllerId === null ? "无人" : playerName(projection, controllerId)}</span>
            {snapshot?.contestedByPlayerId ? <span className="full-product-duel-contested">{DUEL_CONTESTED_LABEL}</span> : null}
            {snapshot?.staged === "showdown" ? <span className="full-product-duel-contested">对决中</span> : null}
            {combatHere ? <span className="full-product-duel-contested">战斗中</span> : null}
          </div>
        </div>
        {card?.cardId !== undefined ? (
          <CardArt cardId={card.cardId} resolveCardTitle={cards.title} resolveCardImage={cards.image}
            className="full-product-duel-battlefield-thumb" cardRole={DUEL_CARD_ROLE_LANDSCAPE} onInspect={onInspect} />
        ) : null}
      </header>
      <article className="v2-zone" aria-label={`战场 · ${title}（${controllerText}）`}>
        <PermanentGroups projection={projection} objects={objects} cards={cards} onInspect={onInspect}
          interaction={interaction} />
      </article>
    </section>
  );
}

/** The victory track, reusing the legacy rail with the V2 scoring snapshot. */
export function V2ScoreRail({ projection }: { readonly projection: V2Projection }) {
  const scoring = {
    victoryScore: projection.scoring.victoryScore,
    players: projection.scoring.players.map(player => ({ playerId: player.playerId, points: player.points }))
  } as unknown as DuelWireScoring;
  return <DuelScoreRail scoring={scoring} nameOf={playerId => playerName(projection, playerId)} />;
}

export function V2OpponentHand({ player }: { readonly player: V2PlayerSnapshot | null }) {
  return player === null ? null : <HiddenHand playerName={player.name} count={player.handCount} />;
}

const CARD_TYPE_LABELS: Readonly<Record<string, string>> = {
  Unit: "单位", Spell: "法术", Gear: "装备", Rune: "符文", Legend: "传奇", Battlefield: "战场", Champion: "英雄"
};

/** Short facts for the large preview, from the catalog only (no invented text). */
export function v2CardDetails(card: CatalogCard | undefined): readonly string[] {
  if (card === undefined) return [];
  const details: string[] = [];
  details.push(CARD_TYPE_LABELS[card.cardType] ?? card.cardType);
  if (card.domains.length > 0) details.push(card.domains.map(domainLabel).join(" / "));
  if (card.energy !== null) details.push(`费用 ${card.energy}`);
  if (card.power !== null) details.push(`符能 ${card.power}`);
  if (card.might !== null) details.push(`战力 ${card.might}`);
  details.push(card.cardNumber);
  return details;
}

export function V2CardPreview({ cardId, cards, onClose }: {
  readonly cardId: string | null;
  readonly cards: V2PlaymatCards;
  readonly onClose: () => void;
}): ReactNode {
  if (cardId === null) return null;
  const text = cards.text(cardId);
  const details = v2CardDetails(cards.card(cardId));
  return <CardPreviewOverlay cardId={cardId} title={cards.title(cardId)} imageUrl={cards.image(cardId)}
    {...(text === undefined ? {} : { cardText: text })} {...(details.length === 0 ? {} : { details })} onClose={onClose} />;
}
