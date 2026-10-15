import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type {
  DuelProjectionTransport,
  DuelWireBaseRune,
  DuelWireGearPermanent,
  DuelWireGoldToken,
  DuelWireLegendPermanent,
  DuelWireUnit
} from "@riftbound/protocol";
import {
  DUEL_BASE_MIGHT_LABEL,
  DUEL_BASE_RUNE_LABEL,
  DUEL_CARD_ROLE_PORTRAIT,
  DUEL_DAMAGE_LABEL,
  DUEL_DOMAIN_LABELS,
  DUEL_GEAR_ATTACH_LABEL,
  DUEL_GEAR_ATTACH_UNKNOWN_LABEL,
  DUEL_GEAR_SECTION_LABEL,
  DUEL_GEAR_UNATTACHED_LABEL,
  DUEL_GOLD_LABEL,
  DUEL_INSPECT_TRIGGER_PREFIX,
  DUEL_LEGEND_CONTROLLER_LABEL,
  DUEL_LEGEND_READINESS_LABELS,
  DUEL_NO_BASE_RUNE_NOTICE,
  DUEL_NO_CHAMPION_LABEL,
  DUEL_READY_LABEL,
  DUEL_TAPPED_LABEL,
  cardEventIsInspect,
  duelLegendPowerDomains,
  nameFor,
  orderUnitGroupsForViewer,
  unitDisplayLabel,
  useDuelCardInteraction
} from "./duel-board-model";
import { duelGearHostLabel } from "./DuelBoardViewModel";
import type { DuelCardRole, DuelSides } from "./duel-board-model";

export function CardArt({
  cardId,
  resolveCardTitle,
  resolveCardImage,
  className,
  cardRole = DUEL_CARD_ROLE_PORTRAIT,
  onInspect,
  interactionUID
}: {
  readonly cardId: string;
  readonly resolveCardTitle: (cardId: string) => string;
  readonly resolveCardImage?: (cardId: string) => string | null;
  readonly className: string;
  readonly cardRole?: DuelCardRole;
  readonly onInspect?: (cardId: string) => void;
  readonly interactionUID?: string;
}) {
  const cardInteraction = useDuelCardInteraction();
  if (cardInteraction !== null && !cardInteraction.canInspectCard(cardId)) return null;
  const interactive = interactionUID !== undefined && cardInteraction?.canInteract === true;
  const imageUrl = resolveCardImage?.(cardId) ?? null;
  const title = resolveCardTitle(cardId);
  if (imageUrl === null && !onInspect) {
    return (
      <div
        className={`${className} is-missing`}
        aria-hidden="true"
        data-card-id={cardId}
        data-card-role={cardRole}
      />
    );
  }
  const image = imageUrl === null
    ? <span className={`${className} is-missing`} aria-hidden="true" data-card-role={cardRole} />
    : <img className={className} src={imageUrl} alt={title} data-card-role={cardRole} draggable={false} />;
  if (!onInspect) return image;
  // A real, keyboard-reachable button. Preview only — it forwards no action,
  // cost or hidden zone; clicking it just shows the image at full size.
  return (
    <button
      type="button"
      className="full-product-duel-card-button"
      data-card-id={cardId}
      data-card-role={cardRole}
      data-card-inspect-only={interactive ? undefined : "true"}
      aria-label={`${interactive ? "操作卡牌：" : DUEL_INSPECT_TRIGGER_PREFIX}${title}`}
      title={title}
      onClick={interactive ? undefined : () => onInspect(cardId)}
      onDragStart={event => event.preventDefault()}
    >
      {image}
    </button>
  );
}
/**
 * One V3 Gear permanent: card face, name, current controller, ready/exhausted
 * state and — when the wire says so — its attachment host. Every value is read
 * straight from `DuelWireGearPermanent`; a host that cannot be resolved to a
 * public card/unit shows a neutral label without leaking a uid. Attaching never
 * emits a command: the whole chip is display-only (its only optional control is
 * the shared read-only card preview).
 */
export function GearChip({
  gear,
  controllerLabel,
  hostLabel,
  resolveCardTitle,
  resolveCardImage,
  onInspect
}: {
  readonly gear: DuelWireGearPermanent;
  readonly controllerLabel: string;
  readonly hostLabel: string | null;
  readonly resolveCardTitle: (cardId: string) => string;
  readonly resolveCardImage?: (cardId: string) => string | null;
  readonly onInspect?: (cardId: string) => void;
}) {
  const title = resolveCardTitle(gear.cardId);
  const hostText = hostLabel ?? DUEL_GEAR_ATTACH_UNKNOWN_LABEL;
  return (
    <li
      className="full-product-duel-gear"
      data-controller-player-id={gear.controllerPlayerId}
      data-readied={gear.readied ? "true" : "false"}
    >
      <CardArt
        cardId={gear.cardId}
        resolveCardTitle={resolveCardTitle}
        resolveCardImage={resolveCardImage}
        className="full-product-duel-gear-thumb"
        onInspect={onInspect}
      />
      <span className="full-product-duel-gear-details">
        <span className="full-product-duel-gear-name" title={title}>
          {title}
        </span>
        <span className="full-product-duel-gear-controller" title={controllerLabel}>
          {DUEL_LEGEND_CONTROLLER_LABEL}：{controllerLabel}
        </span>
        <span className="full-product-duel-gear-state">
          {gear.readied ? DUEL_READY_LABEL : DUEL_TAPPED_LABEL}
        </span>
        {gear.attachedToUID !== null ? (
          <span className="full-product-duel-gear-host" title={`${DUEL_GEAR_ATTACH_LABEL}：${hostText}`}>
            {DUEL_GEAR_ATTACH_LABEL}：{hostText}
          </span>
        ) : (
          <span className="full-product-duel-gear-host is-independent">{DUEL_GEAR_UNATTACHED_LABEL}</span>
        )}
      </span>
    </li>
  );
}

/**
 * The Gears at one location, or nothing at all when that location projects no
 * Gear — an empty `gears` list must not leave a placeholder band. `units` are
 * the units at the same location (the wire guard only ever attaches a Gear to a
 * host at its own location), so a Gear-on-Gear chain still resolves.
 */
export function GearList({
  locationId,
  gears,
  units,
  projection,
  resolveCardTitle,
  resolveCardImage,
  onInspect
}: {
  readonly locationId: string;
  readonly gears: readonly DuelWireGearPermanent[];
  readonly units: readonly DuelWireUnit[];
  readonly projection: DuelProjectionTransport;
  readonly resolveCardTitle: (cardId: string) => string;
  readonly resolveCardImage?: (cardId: string) => string | null;
  readonly onInspect?: (cardId: string) => void;
}) {
  const atLocation = gears.filter(gear => gear.locationId === locationId);
  if (atLocation.length === 0) return null;
  return (
    <div
      className="full-product-duel-gears"
      data-location-id={locationId}
      aria-label={DUEL_GEAR_SECTION_LABEL}
    >
      <span className="full-product-duel-section-label">{DUEL_GEAR_SECTION_LABEL}</span>
      <ul className="full-product-duel-gear-list">
        {atLocation.map(gear => (
          <GearChip
            key={gear.uid}
            gear={gear}
            controllerLabel={nameFor(projection, gear.controllerPlayerId)}
            hostLabel={
              gear.attachedToUID === null
                ? null
                : duelGearHostLabel(gears, units, gear.attachedToUID, resolveCardTitle)
            }
            resolveCardTitle={resolveCardTitle}
            resolveCardImage={resolveCardImage}
            onInspect={onInspect}
          />
        ))}
      </ul>
    </div>
  );
}
/**
 * The V3 Legend's server-projected status: its current controller and one of
 * three readiness states (未建立 / 就绪 / 已横置). Rendered only when the board
 * actually projects a Legend permanent, so V1/V2 are untouched.
 */
export function LegendState({
  legend,
  projection
}: {
  readonly legend: DuelWireLegendPermanent;
  readonly projection: DuelProjectionTransport;
}) {
  return (
    <p className="full-product-duel-legend-state" data-readiness={legend.readiness}>
      <span className="full-product-duel-legend-controller">
        {DUEL_LEGEND_CONTROLLER_LABEL}：{nameFor(projection, legend.controllerPlayerId)}
      </span>
      <span className="full-product-duel-legend-readiness" data-readiness={legend.readiness}>
        {DUEL_LEGEND_READINESS_LABELS[legend.readiness]}
      </span>
    </p>
  );
}

export function UnitChip({
  unit,
  resolveCardTitle,
  resolveCardImage,
  onInspect
}: {
  readonly unit: DuelWireUnit;
  readonly resolveCardTitle: (cardId: string) => string;
  readonly resolveCardImage?: (cardId: string) => string | null;
  readonly onInspect?: (cardId: string) => void;
}) {
  const label = unitDisplayLabel(unit, resolveCardTitle);
  const cardInteraction = useDuelCardInteraction();
  const interactive = cardInteraction?.canInteract === true &&
    cardInteraction.viewerPlayerId === unit.controllerPlayerId &&
    cardInteraction.isCardActionable(unit.objectId);
  const onCardClick = (event: ReactMouseEvent<HTMLElement> | ReactPointerEvent<HTMLElement>): void => {
    if (!interactive || cardEventIsInspect(event)) return;
    cardInteraction?.onCardClick(event, unit.objectId, unit.trait.kind === "card" ? unit.trait.cardId : null, "unit");
  };
  return (
    <li
      data-object-id={unit.objectId}
      data-card-uid={interactive ? unit.objectId : undefined}
      data-card-zone={interactive ? "unit" : undefined}
      data-owner-player-id={unit.ownerPlayerId}
      data-controller-player-id={unit.controllerPlayerId}
      data-readied={unit.readied ? "true" : "false"}
      onClick={interactive ? onCardClick : undefined}
      onPointerDown={interactive ? event => {
        if (!cardEventIsInspect(event)) cardInteraction?.onCardPointerDown(event, unit.objectId, "unit");
      } : undefined}
      onPointerMove={interactive ? event => cardInteraction?.onCardPointerMove(event) : undefined}
      onPointerUp={interactive ? event => cardInteraction?.onCardPointerUp(event) : undefined}
      onPointerCancel={interactive ? () => cardInteraction?.onCardPointerCancel() : undefined}
      className={interactive ? "full-product-duel-unit full-product-duel-card-surface" : "full-product-duel-unit"}
    >
      {unit.trait.kind === "card" ? (
        <CardArt
          cardId={unit.trait.cardId}
          resolveCardTitle={resolveCardTitle}
          resolveCardImage={resolveCardImage}
          className="full-product-duel-unit-thumb"
          onInspect={onInspect}
          interactionUID={interactive ? unit.objectId : undefined}
        />
      ) : null}
      <span className="full-product-duel-unit-details">
        <span className="full-product-duel-unit-name">{label}</span>
        {unit.trait.kind === "token" ? (
          <span className="full-product-duel-unit-token">
            <span className="full-product-duel-unit-might">
              {DUEL_BASE_MIGHT_LABEL} {unit.trait.baseMight}
            </span>
            {unit.trait.tags.length > 0 ? (
              <span className="full-product-duel-unit-tags">{unit.trait.tags.join("、")}</span>
            ) : null}
          </span>
        ) : null}
        <span className="full-product-duel-unit-state">
          <span className="full-product-duel-unit-readied">
            {unit.readied ? DUEL_READY_LABEL : DUEL_TAPPED_LABEL}
          </span>
          {unit.totalDamage > 0 ? (
            <span className="full-product-duel-unit-damage" aria-label={DUEL_DAMAGE_LABEL}>
              {DUEL_DAMAGE_LABEL} {unit.totalDamage}
            </span>
          ) : null}
        </span>
      </span>
    </li>
  );
}

export function UnitGroupList({
  units,
  projection,
  sides,
  resolveCardTitle,
  resolveCardImage,
  onInspect
}: {
  readonly units: readonly DuelWireUnit[];
  readonly projection: DuelProjectionTransport;
  readonly sides: DuelSides;
  readonly resolveCardTitle: (cardId: string) => string;
  readonly resolveCardImage?: (cardId: string) => string | null;
  readonly onInspect?: (cardId: string) => void;
}) {
  if (units.length === 0) {
    return <p className="full-product-duel-empty">暂无单位</p>;
  }
  // Group by *current controller* so a stolen unit shows under the player who
  // actually controls it; both controllers can appear on the same field, with
  // the opposing seat's group first/left (same order as the two base bands).
  const groups = orderUnitGroupsForViewer(units, sides);
  return (
    <div className="full-product-duel-unit-groups" data-slot="unit-groups">
      {groups.map(([controllerId, groupUnits]) => (
        <div
          key={controllerId}
          className="full-product-duel-unit-group"
          data-slot="unit-group"
          data-controller-player-id={controllerId}
          aria-label={`${nameFor(projection, controllerId)} 单位`}
        >
          <h5 className="full-product-duel-unit-group-owner">
            {nameFor(projection, controllerId)}
          </h5>
          <ul className="full-product-duel-unit-list">
            {groupUnits.map(unit => (
              <UnitChip
                key={unit.objectId}
                unit={unit}
                resolveCardTitle={resolveCardTitle}
                resolveCardImage={resolveCardImage}
                onInspect={onInspect}
              />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function BaseRuneChip({
  rune,
  ownerPlayerId,
  resolveCardTitle,
  resolveCardImage,
  onInspect
}: {
  readonly rune: DuelWireBaseRune;
  readonly ownerPlayerId: string;
  readonly resolveCardTitle: (cardId: string) => string;
  readonly resolveCardImage?: (cardId: string) => string | null;
  readonly onInspect?: (cardId: string) => void;
}) {
  const cardInteraction = useDuelCardInteraction();
  if (cardInteraction !== null && !cardInteraction.canInspectCard(rune.cardId)) return null;
  const interactive = cardInteraction?.canInteract === true &&
    cardInteraction.viewerPlayerId === ownerPlayerId &&
    cardInteraction.isCardActionable(rune.uid);
  const domainLabel = DUEL_DOMAIN_LABELS[rune.domain];
  const state = rune.readied ? DUEL_READY_LABEL : DUEL_TAPPED_LABEL;
  const title = resolveCardTitle(rune.cardId);
  const imageUrl = resolveCardImage?.(rune.cardId) ?? null;
  const body = (
    <>
      {imageUrl !== null ? (
        <img
          className="full-product-duel-baserune-thumb"
          src={imageUrl}
          alt={title}
          data-card-role={DUEL_CARD_ROLE_PORTRAIT}
        />
      ) : (
        <div
          className="full-product-duel-baserune-thumb is-missing"
          aria-hidden="true"
          data-card-role={DUEL_CARD_ROLE_PORTRAIT}
        />
      )}
      <span className="full-product-duel-baserune-caption">
        <span className="full-product-duel-baserune-domain">{domainLabel}</span>
        <span className="full-product-duel-baserune-state">{state}</span>
      </span>
    </>
  );
  const shared = {
    className: interactive ? "full-product-duel-baserune full-product-duel-card-surface" : "full-product-duel-baserune",
    "data-uid": rune.uid,
    "data-card-uid": interactive ? rune.uid : undefined,
    "data-card-zone": interactive ? "rune" : undefined,
    "data-domain": rune.domain,
    "data-readied": rune.readied ? "true" : "false"
  } as const;
  if (onInspect) {
    return (
      <li {...shared}
        onClick={interactive ? event => {
          if (cardEventIsInspect(event)) return;
          cardInteraction?.onCardClick(event, rune.uid, rune.cardId, "rune");
        } : undefined}
        onPointerDown={interactive ? event => {
          if (!cardEventIsInspect(event)) cardInteraction?.onCardPointerDown(event, rune.uid, "rune");
        } : undefined}
        onPointerMove={interactive ? event => cardInteraction?.onCardPointerMove(event) : undefined}
        onPointerUp={interactive ? event => cardInteraction?.onCardPointerUp(event) : undefined}>
        <button
          type="button"
          className="full-product-duel-baserune-button"
          data-card-id={rune.cardId}
          data-card-inspect-only={interactive ? undefined : "true"}
          aria-label={`${interactive ? "操作符文：" : DUEL_INSPECT_TRIGGER_PREFIX}${domainLabel}符文`}
          title={`${title}（${state}）`}
          onClick={interactive ? undefined : () => onInspect(rune.cardId)}
          onDragStart={event => event.preventDefault()}
        >
          {body}
        </button>
      </li>
    );
  }
  return (
    <li {...shared} aria-label={`${domainLabel}符文（${state}）`}
      onClick={interactive ? event => cardInteraction?.onCardClick(event, rune.uid, rune.cardId, "rune") : undefined}
      onPointerDown={interactive ? event => {
        if (!cardEventIsInspect(event)) cardInteraction?.onCardPointerDown(event, rune.uid, "rune");
      } : undefined}
      onPointerMove={interactive ? event => cardInteraction?.onCardPointerMove(event) : undefined}
      onPointerUp={interactive ? event => cardInteraction?.onCardPointerUp(event) : undefined}>
      {body}
    </li>
  );
}

export function BaseRuneList({
  playerName,
  ownerPlayerId,
  runes,
  resolveCardTitle,
  resolveCardImage,
  onInspect
}: {
  readonly playerName: string;
  readonly ownerPlayerId: string;
  readonly runes: readonly DuelWireBaseRune[];
  readonly resolveCardTitle: (cardId: string) => string;
  readonly resolveCardImage?: (cardId: string) => string | null;
  readonly onInspect?: (cardId: string) => void;
}) {
  return (
    <div className="full-product-duel-baserunes" aria-label={`${playerName} ${DUEL_BASE_RUNE_LABEL}`}>
      <span className="full-product-duel-section-label">{DUEL_BASE_RUNE_LABEL}</span>
      {runes.length === 0 ? (
        <p className="full-product-duel-empty">{DUEL_NO_BASE_RUNE_NOTICE}</p>
      ) : (
        <ul className="full-product-duel-baserune-list">
          {runes.map(rune => (
            <BaseRuneChip
              key={rune.uid}
              rune={rune}
              ownerPlayerId={ownerPlayerId}
              resolveCardTitle={resolveCardTitle}
              resolveCardImage={resolveCardImage}
              onInspect={onInspect}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

export function GoldTokenList({
  playerName,
  ownerPlayerId,
  tokens
}: {
  readonly playerName: string;
  readonly ownerPlayerId: string;
  readonly tokens: readonly DuelWireGoldToken[];
}) {
  const cardInteraction = useDuelCardInteraction();
  const isInteractive = (uid: string): boolean => cardInteraction?.canInteract === true &&
    cardInteraction.viewerPlayerId === ownerPlayerId && cardInteraction.isCardActionable(uid);
  const readied = tokens.filter(token => token.readied).length;
  return (
    <div className="full-product-duel-gold-line" aria-label={`${playerName} ${DUEL_GOLD_LABEL}`}>
      <span className="full-product-duel-section-label">{DUEL_GOLD_LABEL}</span>
      <span className="full-product-duel-gold-summary">
        {tokens.length}（{DUEL_READY_LABEL} {readied}／{DUEL_TAPPED_LABEL} {tokens.length - readied}）
      </span>
      {tokens.length > 0 ? (
        <ul className="full-product-duel-gold-list">
          {tokens.map(token => {
            const interactive = isInteractive(token.uid);
            return (
              <li
                key={token.uid}
                className={interactive ? "full-product-duel-gold full-product-duel-card-surface" : "full-product-duel-gold"}
                data-card-uid={interactive ? token.uid : undefined}
                data-card-zone={interactive ? "gold" : undefined}
                data-readied={token.readied ? "true" : "false"}
                aria-label={`${DUEL_GOLD_LABEL} ${token.readied ? DUEL_READY_LABEL : DUEL_TAPPED_LABEL}`}
                role={interactive ? "button" : undefined}
                tabIndex={interactive ? 0 : undefined}
                onKeyDown={interactive ? event => {
                  if (event.target !== event.currentTarget || event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  cardInteraction?.onCardClick(event, token.uid, null, "gold");
                } : undefined}
                onClick={interactive ? event => cardInteraction?.onCardClick(event, token.uid, null, "gold") : undefined}
                onPointerDown={interactive ? event => cardInteraction?.onCardPointerDown(event, token.uid, "gold") : undefined}
                onPointerMove={interactive ? event => cardInteraction?.onCardPointerMove(event) : undefined}
                onPointerUp={interactive ? event => cardInteraction?.onCardPointerUp(event) : undefined}
              >
                {/* No card id, no printing metadata: a plain gold mark only. */}
                <span className="full-product-duel-gold-glyph" aria-hidden="true">
                  金
                </span>
                <span className="full-product-duel-gold-state">
                  {token.readied ? DUEL_READY_LABEL : DUEL_TAPPED_LABEL}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

export function IdentityRow({
  role,
  cardId,
  fallbackLabel,
  resolveCardTitle,
  resolveCardImage,
  onInspect
}: {
  readonly role: string;
  readonly cardId: string | null;
  readonly fallbackLabel?: string;
  readonly resolveCardTitle: (cardId: string) => string;
  readonly resolveCardImage?: (cardId: string) => string | null;
  readonly onInspect?: (cardId: string) => void;
}) {
  const title = cardId === null ? (fallbackLabel ?? DUEL_NO_CHAMPION_LABEL) : resolveCardTitle(cardId);
  return (
    <div>
      <dt>{role}</dt>
      <dd>
        {cardId !== null ? (
          <CardArt
            cardId={cardId}
            resolveCardTitle={resolveCardTitle}
            resolveCardImage={resolveCardImage}
            className="full-product-duel-identity-thumb"
            onInspect={onInspect}
          />
        ) : null}
        <span className="full-product-duel-identity-title">{title}</span>
      </dd>
    </div>
  );
}
