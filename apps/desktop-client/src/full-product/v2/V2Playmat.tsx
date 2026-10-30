import { useEffect } from "react";
import type { CSSProperties, MouseEvent, PointerEvent, ReactNode } from "react";
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
import { CardArt, closeOnBackdropClick, DuelScoreRail, HiddenHand, PlaymatPile } from "../duel/DuelBoardComponents";
import { CardText } from "../duel/card-text";
import type { CardTextData } from "../duel/card-text";
import { projectedObjectCardName, type CardNameIndex } from "./card-names";
import { v2RuneCanAddEnergy, v2RuneCanAddPower } from "./playmat-interactions";
import { v2GroupUnits, v2MightAt, type V2UnitGroup } from "./unit-groups";
import "../DuelMatchBoard.css";

/**
 * Playmat presentation for the V2 board (RIFT-1125, redesigned in RIFT-1146).
 *
 * Each seat follows the official mat: the row next to the battlefields holds
 * the Base, Legend and Champion; the outer row holds the Rune Deck, Runes,
 * Trash and Main Deck. The opposing seat is the same mat turned around.
 * Identical permanents stack with a count. Everything here is display or a
 * click forwarded to V2MatchBoard, which owns every command.
 */

/**
 * Official Chinese state word for an exhausted permanent: the zh_CN card
 * gallery writes it as 休眠 (e.g. ven-075-166 / unl-136-219 “此牌以休眠状态进场”).
 */
export const V2_EXHAUSTED_LABEL = "休眠";

/** How a permanent is marked while the board waits for a click. */
export type V2ObjectMark = "selectable" | "selected" | "damage";

/** Local damage draft shown on one unit during the viewer's allocation. */
export interface V2UnitAllocation {
  readonly amount: number;
  readonly lethal: boolean;
  readonly order: number | null;
}

/** Drag-and-drop, clicks and highlights the board passes into the playmat (RIFT-1144/1146). */
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
  /** Blue glow: the server lists an action for this permanent right now. */
  readonly operable?: (object: V2ProjectedObject) => boolean;
  /** Target/choice/damage marking while the board is waiting for a click. */
  readonly markFor?: (object: V2ProjectedObject) => V2ObjectMark | null;
  /**
   * A left click on a stack or one of its members; returns true when the board
   * used it. `multi` is a Shift/Ctrl/⌘ click, which selects units that move
   * together (RIFT-1154).
   */
  readonly onObjectClick?: (objects: readonly V2ProjectedObject[], multi?: boolean) => boolean;
  /** A right click on a stack or one of its members; returns true when the board used it. */
  readonly onObjectContext?: (objects: readonly V2ProjectedObject[]) => boolean;
  readonly allocationFor?: (object: V2ProjectedObject) => V2UnitAllocation | null;
  /** The one stack shown expanded, by group key. */
  readonly expandedKey?: string | null;
  readonly onExpand?: (groupKey: string | null) => void;
  /** Attack estimate shown on a battlefield while a unit is dragged over it. */
  readonly dropPreviewFor?: (dropKey: string) => string | null;
  /** Combat header extras for the battlefield in combat (allocation meter, clear button). */
  readonly combatHeader?: (battlefieldId: string) => ReactNode;
  /** Combat result summary for a battlefield after a combat ends. */
  readonly resultFor?: (battlefieldId: string) => ReactNode;
  /** Pointer over a card face: shows the docked card info (with the live object when on the board); null when it leaves. */
  readonly onHover?: (cardId: string | null, clientX?: number, object?: V2ProjectedObject) => void;
}

/** Hover props for any card face: report the card on enter, clear on leave. */
export function v2HoverProps(onHover: V2BoardInteraction["onHover"], cardId: string | undefined | null, object?: V2ProjectedObject) {
  if (onHover === undefined || cardId === undefined || cardId === null) return {};
  return {
    onPointerEnter: (event: PointerEvent<HTMLElement>) => onHover(cardId, event.clientX, object),
    onPointerLeave: () => onHover(null)
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

/** The face of one permanent: art, name, readiness, Might and damage, plus any allocation draft. */
function UnitFace({ object, cards, allocation }: {
  readonly object: V2ProjectedObject;
  readonly cards: V2PlaymatCards;
  readonly allocation: V2UnitAllocation | null;
}) {
  const name = cards.objectName(object);
  const image = object.cardId !== undefined && !object.faceDown ? cards.image(object.cardId) : null;
  return (
    <span className={`v2m-face${object.exhausted === true ? " is-exhausted" : ""}`}>
      {object.faceDown ? <span className="full-product-duel-card-back v2m-art" aria-hidden="true" /> :
        image !== null ? <img className="v2m-art" src={image} alt={name} draggable={false} /> :
          <span className="v2m-art is-missing" aria-hidden="true" />}
      <span className="v2m-name">{object.faceDown ? "牌面朝下" : name}</span>
      <span className="v2m-state">
        <span className="v2m-readied">{object.exhausted === true ? V2_EXHAUSTED_LABEL : DUEL_READY_LABEL}</span>
        {object.might !== undefined ? <span className="v2m-might">战力 {object.might}</span> : null}
        {object.damage !== undefined && object.damage > 0 ? <span className="v2m-damage">伤害 {object.damage}</span> : null}
      </span>
      {allocation !== null && allocation.amount > 0 ? (
        <span className={`v2m-alloc${allocation.lethal ? " is-lethal" : ""}`}>
          {allocation.order !== null ? <b>{allocation.order}</b> : null}{allocation.amount}{allocation.lethal ? " · 将阵亡" : ""}
        </span>
      ) : null}
    </span>
  );
}

/**
 * One stack: a single permanent, or several identical ones shown once with a
 * count. Clicking forwards to the board (targets, damage); a stack nobody is
 * waiting on expands so each member can be seen and picked.
 */
function UnitStack({ group, cards, onInspect, interaction }: {
  readonly group: V2UnitGroup;
  readonly cards: V2PlaymatCards;
  readonly onInspect: (cardId: string, objectId?: string) => void;
  readonly interaction?: V2BoardInteraction | undefined;
}) {
  const objects = group.objects;
  const first = objects[0]!;
  const count = objects.length;
  const name = cards.objectName(first);
  const marks = objects.map(object => interaction?.markFor?.(object) ?? null);
  const mark = marks.includes("selected") ? "selected" : marks.includes("damage") ? "damage" :
    marks.includes("selectable") ? "selectable" : null;
  const operable = objects.some(object => interaction?.operable?.(object) === true);
  const dragObject = objects.find(object => interaction?.dragHandlerFor(object) != null);
  const onDragStart = dragObject === undefined ? null : interaction!.dragHandlerFor(dragObject);
  const expanded = count > 1 && interaction?.expandedKey === group.key;
  const totals = objects.reduce((sum, object) => {
    const allocation = interaction?.allocationFor?.(object) ?? null;
    return allocation === null ? sum : { amount: sum.amount + allocation.amount, lethal: sum.lethal + (allocation.lethal ? 1 : 0) };
  }, { amount: 0, lethal: 0 });
  const groupAllocation: V2UnitAllocation | null = count === 1 ? interaction?.allocationFor?.(first) ?? null :
    totals.amount === 0 ? null : { amount: totals.amount, lethal: false, order: null };
  const click = (members: readonly V2ProjectedObject[], multi = false): void => {
    if (interaction?.onObjectClick?.(members, multi) === true) return;
    if (members.length > 1) interaction?.onExpand?.(expanded ? null : group.key);
    else if (members[0]?.cardId !== undefined && !members[0].faceDown && count === 1) onInspect(members[0].cardId, members[0].objectId);
  };
  const context = (event: MouseEvent<HTMLElement>, members: readonly V2ProjectedObject[]): void => {
    if (interaction?.onObjectContext?.(members) === true) event.preventDefault();
  };
  const ready = objects.filter(object => object.exhausted !== true).length;
  return (
    <li className={`v2m-stack${count > 1 ? " is-stacked" : ""}${first.exhausted === true ? " is-exhausted" : ""}${
      operable ? " v2-operable" : ""}${onDragStart ? " v2-draggable" : ""}${expanded ? " is-expanded" : ""}`}
      data-object-id={first.objectId} data-object-ids={objects.map(object => object.objectId).join(" ")}
      data-controller-player-id={controllerOf(first)} data-readied={first.exhausted === true ? "false" : "true"}
      {...(mark === null ? {} : { "data-mark": mark })}>
      <span role="button" tabIndex={0} className="v2m-hit"
        {...v2HoverProps(interaction?.onHover, first.faceDown ? null : first.cardId, first)}
        aria-label={count > 1 ? `${name} ×${count}` : name}
        title={onDragStart ? `${name}：拖动到其他位置即可移动；按住 Shift 点选多个单位可一起移动` : name}
        {...(onDragStart ? { onPointerDown: onDragStart } : {})}
        onClick={event => click(objects, event.shiftKey || event.ctrlKey || event.metaKey)}
        onContextMenu={event => context(event, objects)}
        onKeyDown={event => { if (event.key === "Enter") click(objects); }}>
        {count > 1 ? <><span className="v2m-layer" aria-hidden="true" /><span className="v2m-layer is-second" aria-hidden="true" /></> : null}
        <UnitFace object={first} cards={cards} allocation={count === 1 ? groupAllocation : null} />
        {count > 1 ? <span className="v2m-count">×{count}</span> : null}
        {count > 1 && groupAllocation !== null ? (
          <span className="v2m-alloc is-group">{groupAllocation.amount} 点 · {totals.lethal}/{count} 将阵亡</span>
        ) : null}
      </span>
      {first.cardId !== undefined && !first.faceDown ? (
        <button type="button" className="v2m-zoom" aria-label={`查看大图：${name}`} title="查看大图"
          onClick={() => onInspect(first.cardId!, first.objectId)}>⤢</button>
      ) : null}
      {expanded ? (
        <div className="v2m-expand" role="dialog" aria-label={`${name} ×${count} 展开`}>
          <header><strong>{name} ×{count}</strong><span>{ready} 就绪 · {count - ready} 休眠</span>
            <button type="button" onClick={() => interaction?.onExpand?.(null)}>收起</button></header>
          <ul>
            {objects.map(object => {
              const memberMark = interaction?.markFor?.(object) ?? null;
              return (
                <li key={object.objectId} className="v2m-member" data-object-id={object.objectId}
                  {...(memberMark === null ? {} : { "data-mark": memberMark })}>
                  <span role="button" tabIndex={0} className="v2m-hit" aria-label={`${name} #${objects.indexOf(object) + 1}`}
                    onClick={event => click([object], event.shiftKey || event.ctrlKey || event.metaKey)}
                    onContextMenu={event => context(event, [object])}
                    onKeyDown={event => { if (event.key === "Enter") click([object]); }}>
                    <UnitFace object={object} cards={cards} allocation={interaction?.allocationFor?.(object) ?? null} />
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </li>
  );
}

/** A row of stacks that compresses (cards overlap) once there are more than fit. */
function StackRow({ objects, cards, onInspect, interaction, label }: {
  readonly objects: readonly V2ProjectedObject[];
  readonly cards: V2PlaymatCards;
  readonly onInspect: (cardId: string) => void;
  readonly interaction?: V2BoardInteraction | undefined;
  readonly label?: string;
}) {
  const groups = v2GroupUnits(objects);
  return (
    <ul className="v2m-row" style={{ "--v2m-n": String(groups.length) } as CSSProperties}
      {...(label === undefined ? {} : { "aria-label": label })}>
      {groups.map(group => <UnitStack key={group.key} group={group} cards={cards} onInspect={onInspect} interaction={interaction} />)}
    </ul>
  );
}

function IdentitySlot({ role, object, cards, onInspect, onHover }: {
  readonly role: string;
  readonly object: V2ProjectedObject | undefined;
  readonly cards: V2PlaymatCards;
  readonly onInspect: (cardId: string) => void;
  readonly onHover?: V2BoardInteraction["onHover"];
}) {
  return (
    <div className="v2m-identity-slot" {...v2HoverProps(onHover, object?.cardId, object)}>
      <dt>{role}</dt>
      <dd>
        {object?.cardId !== undefined ? (
          <CardArt cardId={object.cardId} resolveCardTitle={cards.title} resolveCardImage={cards.image}
            className="v2m-identity-art" onInspect={onInspect} />
        ) : null}
        <span className="v2m-identity-title">{object === undefined ? "未入场" : cards.objectName(object)}</span>
      </dd>
    </div>
  );
}

/** One rune: a card tile; the viewer's own runes are buttons (left: Energy, right: Power). */
function RuneTile({ rune, cards, onInspect, runeActions, onHover }: {
  readonly rune: V2ProjectedObject;
  readonly cards: V2PlaymatCards;
  readonly onInspect: (cardId: string) => void;
  readonly runeActions: V2BoardInteraction["rune"] | undefined;
  readonly onHover?: V2BoardInteraction["onHover"];
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
        title={`${name}（${state}）`} {...v2HoverProps(onHover, rune.cardId, rune)}>
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
    <li className={`full-product-duel-baserune v2-rune${canEnergy ? " v2-operable" : ""}`} data-readied={rune.exhausted === true ? "false" : "true"}
      {...v2HoverProps(onHover, rune.cardId, rune)}>
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
 * One seat's mat in the official two rows. The DOM order is the viewer's own
 * order (Base row, then Rune row); the opposing seat is turned around by CSS
 * (`data-position="opponent"`), so its Base row faces the battlefields too.
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
    <section className="v2m-mat" data-position={position}
      data-owner-player-id={player.playerId} aria-label={`${name} 卡垫区域`}>
      <div className="v2m-mat-row v2m-mat-row-base">
        <div className="v2m-zone v2m-base" role="group" aria-label={`${name} 基地`}
          {...dropZoneProps(interaction, `base:${player.playerId}`)}>
          <header className="v2m-zone-head">
            <h4>{name} 基地</h4>
            <span className="v2m-score" aria-label={`${name} 得分`}>{points}</span>
          </header>
          <article className="v2-zone" aria-label={isViewer ? "我的基地" : "对手基地"}>
            {baseObjects.length === 0 ? <p className="full-product-duel-empty">暂无公开牌</p> :
              <StackRow objects={baseObjects} cards={cards} onInspect={onInspect} interaction={interaction} />}
          </article>
        </div>
        <div className="v2m-zone v2m-identity" role="group" aria-label={`${name} 传奇与英雄`}>
          <dl className="v2m-identity-list">
            <IdentitySlot role="传奇" object={legend} cards={cards} onInspect={onInspect} onHover={interaction?.onHover} />
            <IdentitySlot role="英雄" object={champion} cards={cards} onInspect={onInspect} onHover={interaction?.onHover} />
          </dl>
        </div>
      </div>
      <div className="v2m-mat-row v2m-mat-row-runes">
        <div className="v2m-zone v2m-pile"><PlaymatPile playerName={name} label="符文库" count={player.runeDeckCount} area="rune-deck" /></div>
        <div className="v2m-zone v2m-runes" role="group" aria-label={`${name} 符文区`}>
          <article className="v2-zone" aria-label={isViewer ? "我的符文" : "对手公开符文"}>
            {runes.length === 0 ? <p className="full-product-duel-empty">暂无公开牌</p> : (
              <ul className="full-product-duel-baserune-list">
                {runes.map(rune => (
                  <RuneTile key={rune.objectId} rune={rune} cards={cards} onInspect={onInspect}
                    runeActions={isViewer ? interaction?.rune : undefined} onHover={interaction?.onHover} />
                ))}
              </ul>
            )}
          </article>
          <dl className="v2m-pool" aria-label={`${name} 当前资源池`}>
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
        <div className="v2m-zone v2m-pile"><PlaymatPile playerName={name} label="废牌堆" count={player.zoneCounts.trash ?? 0} area="trash" /></div>
        <div className="v2m-zone v2m-pile"><PlaymatPile playerName={name} label="主牌堆" count={player.deckCount} area="main-deck" /></div>
      </div>
    </section>
  );
}

/**
 * One shared battlefield: its card and controller, then a lane per side
 * (opponent above, viewer below) with that side's Might total. During combat
 * the battlefield grows into the combat panel.
 */
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
  const combat = projection.combat?.status === "active" && projection.combat.battlefieldId === battlefieldId ? projection.combat : null;
  const anyCombat = projection.combat?.status === "active";
  const viewerId = projection.viewerPlayerId;
  const sides = [...new Set([...projection.players.map(player => player.playerId), ...objects.map(controllerOf)])]
    .sort((left, right) => Number(left === viewerId) - Number(right === viewerId));
  const mightFor = (playerId: string): number => {
    const damage = combat?.damage;
    if (damage !== undefined && playerId === combat?.attackerPlayerId) return damage.attackerMight;
    if (damage !== undefined && playerId === combat?.defenderPlayerId) return damage.defenderMight;
    return v2MightAt(projection, battlefieldId, playerId);
  };
  const attacker = combat?.attackerPlayerId ?? null;
  const defender = combat?.defenderPlayerId ?? null;
  const preview = interaction?.dropPreviewFor?.(`battlefield:${battlefieldId}`) ?? null;
  const result = interaction?.resultFor?.(battlefieldId) ?? null;
  const stepLabel = combat?.step === "showdown" ? "对决" : combat?.step === "damage" ? "分配伤害" : combat ? "战斗结算" : null;
  return (
    <section className={`v2m-field${combat ? " v2-battlefield-in-combat is-combat" : anyCombat ? " is-aside" : ""}`}
      data-location-id={battlefieldId} aria-label={`中央战场 ${title}`}
      {...dropZoneProps(interaction, `battlefield:${battlefieldId}`)}>
      <header className="v2m-field-head" {...v2HoverProps(interaction?.onHover, card?.cardId)}>
        {card?.cardId !== undefined ? (
          <CardArt cardId={card.cardId} resolveCardTitle={cards.title} resolveCardImage={cards.image}
            className="v2m-field-art" cardRole={DUEL_CARD_ROLE_LANDSCAPE} onInspect={onInspect} />
        ) : null}
        <h4 className="v2m-field-title">{title}</h4>
        <span className={`v2m-chip${controllerId === null ? "" : controllerId === viewerId ? " is-me" : " is-opp"}`}>
          控制者：{controllerId === null ? "无人" : playerName(projection, controllerId)}
        </span>
        {snapshot?.contestedByPlayerId ? <span className="v2m-chip is-hot">{DUEL_CONTESTED_LABEL}</span> : null}
        {snapshot?.staged === "showdown" ? <span className="v2m-chip is-hot">对决中</span> : null}
        {combat ? <span className="v2m-chip is-hot">战斗中{stepLabel ? ` · ${stepLabel}` : ""}</span> : null}
        {combat && attacker !== null && defender !== null ? (
          <span className="v2m-versus" aria-label="双方战力">
            {attacker === viewerId ? "你" : playerName(projection, attacker)}（攻）{mightFor(attacker)}
            <i>:</i>{mightFor(defender)}（守）{defender === viewerId ? "你" : playerName(projection, defender)}
          </span>
        ) : null}
        {combat ? interaction?.combatHeader?.(battlefieldId) ?? null : null}
      </header>
      <article className="v2-zone" aria-label={`战场 · ${title}（${controllerText}）`}>
        {objects.length === 0 ? <p className="full-product-duel-empty">暂无公开牌</p> : <div className="v2m-lanes">{sides.map(playerId => {
          const laneObjects = objects.filter(object => controllerOf(object) === playerId);
          return (
            <div key={playerId} className={`v2m-lane${playerId === viewerId ? " is-me" : " is-opp"}`}
              data-controller-player-id={playerId} aria-label={`${playerName(projection, playerId)} 单位`}>
              <h5 className="v2m-lane-owner">{playerName(projection, playerId)}</h5>
              {laneObjects.length === 0 ? <span className="v2m-lane-empty" /> :
                <StackRow objects={laneObjects} cards={cards} onInspect={onInspect} interaction={interaction} />}
              <span className="v2m-lane-sum" title="该侧战力合计">{laneObjects.length === 0 ? "" : `Σ ${mightFor(playerId)}`}</span>
            </div>
          );
        })}</div>}
      </article>
      {preview !== null ? <p className="v2m-drop-preview" role="status">{preview}</p> : null}
      {result !== null ? <div className="v2m-result" role="status">{result}</div> : null}
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

function domainClass(domain: string): string {
  return `is-${domain.toLowerCase()}`;
}

/** Keyword boxes such as [强攻 2], read only from the official Chinese text. */
export function v2CardKeywords(card: CatalogCard | undefined): readonly string[] {
  if (card === undefined || (card.localizedAbilityStatus !== "official-structured" &&
      card.localizedAbilityStatus !== "official-accessibility-supplemented")) return [];
  const text = `${card.localizedAbilityRulesText ?? ""}\n${card.localizedAbilityEffectText ?? ""}`.replace(/<[^>]*>/gu, " ");
  const found: string[] = [];
  for (const match of text.matchAll(/\[([^\]\r\n]{1,40})\]/gu)) {
    const keyword = match[1]!.trim();
    if (keyword !== "" && !found.includes(keyword)) found.push(keyword);
  }
  return found;
}

/**
 * The numbers band: cost, Power and Might from the catalog. A permanent on the
 * board shows its current Might from the projection (with the change from the
 * printed value), its marked damage and whether it is exhausted.
 */
function CardStats({ card, object }: { readonly card: CatalogCard | undefined; readonly object?: V2ProjectedObject | undefined }) {
  const printedMight = card?.might ?? null;
  // Only a permanent on the board has a current Might; elsewhere the printed value is the fact.
  const onBoard = object !== undefined && (object.zone === "board" || object.zone === "base" || object.zone === "battlefield");
  const liveMight = onBoard ? object.might ?? null : null;
  const might = liveMight ?? printedMight;
  const delta = liveMight !== null && printedMight !== null ? liveMight - printedMight : 0;
  const stats: { key: string; label: string; value: ReactNode }[] = [];
  if (card?.energy !== null && card?.energy !== undefined) stats.push({ key: "energy", label: "费用", value: card.energy });
  if (card?.power !== null && card?.power !== undefined) stats.push({ key: "power", label: "符能", value: card.power });
  if (might !== null) stats.push({ key: "might", label: liveMight !== null ? "当前战力" : "战力",
    value: <>{might}{delta !== 0 ? <em className={delta > 0 ? "is-up" : "is-down"}>{delta > 0 ? `+${delta}` : delta}</em> : null}</> });
  if (object?.damage !== undefined && object.damage > 0) stats.push({ key: "damage", label: "伤害", value: object.damage });
  if (stats.length === 0 && !onBoard) return null;
  return (
    <div className="v2cd-stats">
      {stats.map(stat => <span key={stat.key} className={`v2cd-stat is-${stat.key}`}><i aria-hidden="true" />{stat.label}<b>{stat.value}</b></span>)}
      {object !== undefined && (onBoard || object.zone === "rune-zone") ? (
        <span className="v2cd-stat is-state">{object.exhausted === true ? V2_EXHAUSTED_LABEL : DUEL_READY_LABEL}</span>
      ) : null}
    </div>
  );
}

function KeywordChips({ card }: { readonly card: CatalogCard | undefined }) {
  const keywords = v2CardKeywords(card);
  return keywords.length === 0 ? null : (
    <div className="v2cd-keywords" aria-label="关键字">{keywords.map(keyword => <span key={keyword}>{keyword}</span>)}</div>
  );
}

/**
 * Card detail (Master Duel style): the full card on the left; on the right a
 * name bar with the card's domains, its numbers, type facts and the official
 * Chinese text. Closes on Esc or a backdrop click.
 */
export function V2CardPreview({ cardId, cards, onClose, object }: {
  readonly cardId: string | null;
  readonly cards: V2PlaymatCards;
  readonly onClose: () => void;
  /** The board object clicked, when there is one: its live Might, damage and state. */
  readonly object?: V2ProjectedObject | undefined;
}): ReactNode {
  useEffect(() => {
    if (cardId === null) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [cardId, onClose]);
  if (cardId === null) return null;
  const text = cards.text(cardId);
  const catalog = cards.card(cardId);
  const details = v2CardDetails(catalog);
  const title = cards.title(cardId);
  const image = cards.image(cardId);
  return (
    <div className="full-product-duel-preview v2cd" role="dialog" aria-modal="true" aria-label="卡牌大图预览"
      onClick={closeOnBackdropClick(onClose)}>
      <div className="full-product-duel-preview-body is-split v2cd-body" data-card-id={cardId}>
        <div className="full-product-duel-preview-art v2cd-art">
          {image !== null ? <img className="full-product-duel-preview-image" src={image} alt={title} /> :
            <p className="full-product-duel-preview-missing">该卡暂无本地图片</p>}
        </div>
        <div className="full-product-duel-preview-info v2cd-info">
          <header className="v2cd-name">
            <h3 className="full-product-duel-preview-title">{title}</h3>
            {(catalog?.domains ?? []).map(domain => <span key={domain} className={`v2cd-domain ${domainClass(domain)}`}>{domainLabel(domain)}</span>)}
          </header>
          <CardStats card={catalog} object={object} />
          <KeywordChips card={catalog} />
          {details.length > 0 ? (
            <ul className="full-product-duel-preview-details v2cd-tags">
              {details.map(detail => <li key={detail}>{detail}</li>)}
            </ul>
          ) : null}
          {text !== undefined ? <div className="v2cd-text"><CardText card={text} /></div> : null}
          <button type="button" className="full-product-duel-preview-close v2cd-close" aria-label="关闭大图" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Card info docked at the table's edge while the pointer rests on a card
 * (Master Duel's left-hand card panel). It never takes clicks.
 */
export function V2CardHoverPanel({ cardId, side, cards, object }: {
  readonly cardId: string | null;
  readonly side: "left" | "right";
  readonly cards: V2PlaymatCards;
  readonly object?: V2ProjectedObject | undefined;
}): ReactNode {
  if (cardId === null) return null;
  const catalog = cards.card(cardId);
  const text = cards.text(cardId);
  const image = cards.image(cardId);
  const type = catalog === undefined ? null : CARD_TYPE_LABELS[catalog.cardType] ?? catalog.cardType;
  return (
    <aside className={`v2ch is-${side}`} aria-label="卡牌简介" data-card-id={cardId}>
      <header className="v2cd-name">
        <h4>{cards.title(cardId)}</h4>
        {(catalog?.domains ?? []).map(domain => <span key={domain} className={`v2cd-domain ${domainClass(domain)}`}>{domainLabel(domain)}</span>)}
      </header>
      <div className="v2ch-top">
        {image !== null ? <img src={image} alt="" draggable={false} /> : <span className="v2ch-missing" aria-hidden="true" />}
        <CardStats card={catalog} object={object} />
      </div>
      <KeywordChips card={catalog} />
      {catalog !== undefined ? <p className="v2ch-type">【{type}】{catalog.cardNumber}</p> : null}
      {text !== undefined ? <div className="v2ch-text"><CardText card={text} /></div> : null}
    </aside>
  );
}
