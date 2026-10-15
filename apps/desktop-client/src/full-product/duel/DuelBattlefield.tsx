import type {
  DuelProjectionTransport,
  DuelWireBattlefield,
  DuelWireGearPermanent,
  DuelWireUnit
} from "@riftbound/protocol";
import {
  DUEL_CARD_ROLE_LANDSCAPE,
  DUEL_CONTESTED_LABEL,
  nameFor,
  useDuelCardInteraction
} from "./duel-board-model";
import type { DuelSides } from "./duel-board-model";
import { CardArt, GearList, UnitGroupList } from "./DuelCardComponents";

export function BattlefieldCard({
  field,
  units,
  gears,
  projection,
  sides,
  resolveCardTitle,
  resolveCardImage,
  onInspect
}: {
  readonly field: DuelWireBattlefield;
  readonly units: readonly DuelWireUnit[];
  readonly gears: readonly DuelWireGearPermanent[];
  readonly projection: DuelProjectionTransport;
  readonly sides: DuelSides;
  readonly resolveCardTitle: (cardId: string) => string;
  readonly resolveCardImage?: (cardId: string) => string | null;
  readonly onInspect?: (cardId: string) => void;
}) {
  const title = resolveCardTitle(field.cardId);
  const cardInteraction = useDuelCardInteraction();
  return (
    <section
      data-location-id={field.locationId}
      data-instance-id={field.instanceId}
      data-drop-kind="battlefield"
      data-drop-location={field.locationId}
      className={`full-product-duel-battlefield${cardInteraction?.dropTargetState("battlefield", field.locationId) ?? ""}`}
      aria-label={`中央战场 ${title}`}
    >
      <header className="full-product-duel-battlefield-head">
        <div className="full-product-duel-battlefield-head-main">
          <h4 className="full-product-duel-battlefield-title">{title}</h4>
          <div className="full-product-duel-battlefield-tags">
            <span>贡献者：{nameFor(projection, field.ownerPlayerId)}</span>
            <span>控制者：{nameFor(projection, field.controllerPlayerId)}</span>
            {field.contested ? (
              <span className="full-product-duel-contested">{DUEL_CONTESTED_LABEL}</span>
            ) : null}
          </div>
        </div>
        {/* The battlefield art is a small, clickable horizontal thumbnail beside
            the name/owner/contested text, so it never consumes the column's
            vertical room and both controller groups stay on screen. */}
        <CardArt
          cardId={field.cardId}
          resolveCardTitle={resolveCardTitle}
          resolveCardImage={resolveCardImage}
          className="full-product-duel-battlefield-thumb"
          cardRole={DUEL_CARD_ROLE_LANDSCAPE}
          onInspect={onInspect}
        />
      </header>
      <GearList
        locationId={field.locationId}
        gears={gears}
        units={units}
        projection={projection}
        resolveCardTitle={resolveCardTitle}
        resolveCardImage={resolveCardImage}
        onInspect={onInspect}
      />
      <UnitGroupList
        units={units}
        projection={projection}
        sides={sides}
        resolveCardTitle={resolveCardTitle}
        resolveCardImage={resolveCardImage}
        onInspect={onInspect}
      />
    </section>
  );
}

/** Only public counts enter a concealed hand; it cannot resolve a card identity. */
