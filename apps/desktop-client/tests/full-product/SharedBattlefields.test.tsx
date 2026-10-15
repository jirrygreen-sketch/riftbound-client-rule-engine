import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import {
  CONTESTED_LABEL,
  CONTROLLED_BY_NOBODY_LABEL,
  MISSING_UNIT_NOTICE,
  SHARED_BATTLEFIELDS_INCOMPLETE_NOTICE,
  SharedBattlefields,
  resolvePublicUnit
} from "../../src/full-product/components/SharedBattlefields";
import type { DuelBoardView } from "../../src/full-product/components/SharedBattlefields";
import type { PlayableMatchView } from "../../src/full-product/types";
import type {
  GameProjection,
  GamePhase,
  ProjectionObject
} from "@riftbound/protocol";

const aliceUnit: ProjectionObject = {
  objectId: "unit-a1",
  cardId: "card-a1",
  zone: "board",
  controllerId: "player-1",
  ownerPlayerId: "player-1",
  faceUp: true
};

const bobUnit: ProjectionObject = {
  objectId: "unit-b1",
  cardId: "card-b1",
  zone: "board",
  controllerId: "player-2",
  ownerPlayerId: "player-2",
  faceUp: true
};

const bobHiddenHand: ProjectionObject = {
  objectId: "bob-hand-1",
  cardId: "bob-secret",
  zone: "hand",
  controllerId: "player-2",
  ownerPlayerId: "player-2",
  faceUp: false
};

// A wire that wrongly marks an opponent hand card face-up must still be ignored.
const bobFaceUpHand: ProjectionObject = {
  objectId: "bob-hand-2",
  cardId: "bob-secret-2",
  zone: "hand",
  controllerId: "player-2",
  ownerPlayerId: "player-2",
  faceUp: true
};

// Alice's unit that Bob has stolen: ownership stays with Alice, control moves.
const stolenUnit: ProjectionObject = {
  objectId: "unit-stolen",
  cardId: "card-stolen",
  zone: "board",
  controllerId: "player-2",
  ownerPlayerId: "player-1",
  faceUp: true
};

// Legitimate on-board zones from the real `ProjectionZone` union.
const aliceBaseUnit: ProjectionObject = {
  objectId: "unit-a-base",
  cardId: "card-a-base",
  zone: "base",
  controllerId: "player-1",
  ownerPlayerId: "player-1",
  faceUp: true
};

const aliceBattlefieldUnit: ProjectionObject = {
  objectId: "unit-a-field",
  cardId: "card-a-field",
  zone: "battlefield",
  controllerId: "player-1",
  ownerPlayerId: "player-1",
  faceUp: true
};

// Off-board zones that must never render through this component, face-up or not.
const faceUpDiscard: ProjectionObject = {
  objectId: "discard-1",
  cardId: "trash-secret",
  zone: "discard",
  controllerId: "player-2",
  ownerPlayerId: "player-2",
  faceUp: true
};

const faceUpLegend: ProjectionObject = {
  objectId: "legend-1",
  cardId: "legend-secret",
  zone: "legend",
  controllerId: "player-1",
  ownerPlayerId: "player-1",
  faceUp: true
};

const faceDownBoardUnit: ProjectionObject = {
  objectId: "unit-facedown",
  cardId: "hidden-unit",
  zone: "board",
  controllerId: "player-1",
  ownerPlayerId: "player-1",
  faceUp: false
};

describe("SharedBattlefields display", () => {
  it("renders exactly two central battlefields and one base per player", () => {
    const html = render(makeBoard(), makeView());
    expect(count(html, 'class="full-product-shared-battlefield"')).toBe(2);
    expect(count(html, 'class="full-product-shared-base"')).toBe(2);
    expect(html).not.toContain(SHARED_BATTLEFIELDS_INCOMPLETE_NOTICE);
    expect(html).toContain("Card field-1");
    expect(html).toContain("Card field-2");
    expect(html).toContain("Alice 基地");
    expect(html).toContain("Bob 基地");
  });

  it("groups both players' public units together on the same battlefield", () => {
    const html = render(makeBoard(), makeView());
    expect(html).toContain("Card card-a1");
    expect(html).toContain("Card card-b1");
    expect(html).toContain('aria-label="Alice 公共单位"');
    expect(html).toContain('aria-label="Bob 公共单位"');
    // Alice's group and Bob's group both arrive from battlefield-1's index list.
    const bf1 = battlefieldSection(html, "Card field-1");
    expect(bf1).toContain("Card card-a1");
    expect(bf1).toContain("Card card-b1");
  });

  it("shows contributor, controller and contested straight from the board", () => {
    const html = render(makeBoard(), makeView());
    expect(html).toContain("贡献者：Alice");
    // Field 1 is controlled by Bob and contested; field 2 has no controller.
    expect(html).toContain("控制者：Bob");
    expect(html).toContain(`控制者：${CONTROLLED_BY_NOBODY_LABEL}`);
    expect(html).toContain(CONTESTED_LABEL);
    expect(count(html, CONTESTED_LABEL)).toBe(1);
  });

  it("never leaks an opponent's hand even when it is indexed or marked face-up", () => {
    const board = makeBoard({
      battlefields: [
        battlefield("bf-1", { unitObjectIds: ["bob-hand-1", "bob-hand-2", "unit-a1"] }),
        battlefield("bf-2", { unitObjectIds: [] })
      ]
    });
    const html = render(board, makeView());
    expect(html).not.toContain("bob-secret");
    expect(html).not.toContain("Card bob-secret");
    expect(html).not.toContain("Card bob-secret-2");
    // The two private ids must degrade to the explicit missing notice.
    expect(html).toContain(MISSING_UNIT_NOTICE);
    // The genuinely public unit is still rendered.
    expect(html).toContain("Card card-a1");
  });

  it("refuses to fabricate fields when the projection is incomplete", () => {
    const html = render(makeBoard({ battlefields: [battlefield("bf-1")] }), makeView());
    expect(html).toContain(SHARED_BATTLEFIELDS_INCOMPLETE_NOTICE);
    expect(html).toContain('role="note"');
    expect(html).not.toContain("Card field-1");
    expect(html).not.toContain("Alice 基地");
  });

  it("gates unit selection on connection, pending, phase and selectable index", () => {
    const selectable = ["unit-a1"];
    const connected = render(makeBoard(), makeView(), {
      selectableObjectIds: selectable,
      onSelectTarget: () => {}
    });
    expect(unitButton(connected, "Card card-a1")).not.toContain("disabled");
    expect(unitButton(connected, "Card card-b1")).toContain("disabled");

    const disconnected = render(makeBoard(), makeView({ connectionStatus: "disconnected" }), {
      selectableObjectIds: selectable,
      onSelectTarget: () => {}
    });
    expect(unitButton(disconnected, "Card card-a1")).toContain("disabled");

    const pending = render(makeBoard(), makeView({ commandPending: true }), {
      selectableObjectIds: selectable,
      onSelectTarget: () => {}
    });
    expect(unitButton(pending, "Card card-a1")).toContain("disabled");

    const ended = render(makeBoard(), makeView({ phase: "ended" }), {
      selectableObjectIds: selectable,
      onSelectTarget: () => {}
    });
    expect(unitButton(ended, "Card card-a1")).toContain("disabled");

    const noSelectable = render(makeBoard(), makeView(), {
      selectableObjectIds: [],
      onSelectTarget: () => {}
    });
    expect(unitButton(noSelectable, "Card card-a1")).toContain("disabled");
  });

  it("accepts the object:id selection key without deriving targets", () => {
    const html = render(makeBoard(), makeView(), {
      selectableObjectIds: ["unit-a1"],
      selectedTargetIds: ["object:unit-a1"],
      onSelectTarget: () => {}
    });
    expect(unitButton(html, "Card card-a1")).toContain('aria-pressed="true"');
  });
});

describe("SharedBattlefields controller grouping", () => {
  it("groups a stolen unit under its current controller, not its owner", () => {
    const board = makeBoard({
      battlefields: [
        battlefield("bf-1", { unitObjectIds: ["unit-a1", "unit-stolen"] }),
        battlefield("bf-2", { unitObjectIds: [] })
      ]
    });
    const html = render(board, makeView());
    const bobGroup = unitGroup(html, "Bob 公共单位");
    const aliceGroup = unitGroup(html, "Alice 公共单位");
    // Bob controls the stolen unit, so it lands in Bob's group...
    expect(bobGroup).toContain("Card card-stolen");
    // ...and Alice's group only keeps her own, non-stolen card.
    expect(aliceGroup).not.toContain("Card card-stolen");
    expect(aliceGroup).toContain("Card card-a1");
    // The group key is the controller; ownership survives as data only.
    expect(bobGroup).toContain('data-controller-player-id="player-2"');
    expect(bobGroup).toContain('data-owner-player-id="player-1"');
  });

  it("degrades indexed face-up trash and legend objects to the missing notice", () => {
    const board = makeBoard({
      bases: [
        { locationId: "base-1", ownerPlayerId: "player-1", unitObjectIds: ["discard-1"] },
        { locationId: "base-2", ownerPlayerId: "player-2", unitObjectIds: [] }
      ],
      battlefields: [
        battlefield("bf-1", { unitObjectIds: ["discard-1", "legend-1", "unit-a1"] }),
        battlefield("bf-2", { unitObjectIds: [] })
      ]
    });
    const html = render(board, makeView());
    expect(html).not.toContain("trash-secret");
    expect(html).not.toContain("Card trash-secret");
    expect(html).not.toContain("legend-secret");
    expect(html).not.toContain("Card legend-secret");
    // battlefield-1 drops both off-board ids, base-1 drops its one.
    expect(missingNoticeCounts(html)).toEqual([
      `${MISSING_UNIT_NOTICE}（2）`,
      `${MISSING_UNIT_NOTICE}（1）`
    ]);
    // The genuinely on-board unit still renders.
    expect(html).toContain("Card card-a1");
  });

  it("renders face-up objects indexed from the on-board base and battlefield zones", () => {
    const board = makeBoard({
      bases: [
        { locationId: "base-1", ownerPlayerId: "player-1", unitObjectIds: ["unit-a-base"] },
        { locationId: "base-2", ownerPlayerId: "player-2", unitObjectIds: [] }
      ],
      battlefields: [
        battlefield("bf-1", { unitObjectIds: ["unit-a-field"] }),
        battlefield("bf-2", { unitObjectIds: [] })
      ]
    });
    const html = render(board, makeView());
    expect(html).toContain("Card card-a-base");
    expect(html).toContain("Card card-a-field");
    expect(html).not.toContain(MISSING_UNIT_NOTICE);
  });

  it("still refuses a face-down object sitting on a legal on-board zone", () => {
    const board = makeBoard({
      battlefields: [
        battlefield("bf-1", { unitObjectIds: ["unit-facedown", "unit-a1"] }),
        battlefield("bf-2", { unitObjectIds: [] })
      ]
    });
    const html = render(board, makeView());
    expect(html).not.toContain("hidden-unit");
    expect(html).not.toContain("Card hidden-unit");
    expect(missingNoticeCounts(html)).toEqual([`${MISSING_UNIT_NOTICE}（1）`]);
    expect(html).toContain("Card card-a1");
  });
});

describe("SharedBattlefields tabletop arrangement", () => {
  it("places the opponent's base on top and the viewer's base on the bottom, swapping for the reversed viewpoint", () => {
    // Viewer is Alice (player-1): Bob's base is the opponent band on top.
    const asAlice = render(makeBoard(), makeView({ viewerPlayerId: "player-1" }));
    expect(baseSection(asAlice, "Bob 基地")).toContain('data-position="opponent"');
    expect(baseSection(asAlice, "Alice 基地")).toContain('data-position="self"');
    expect(asAlice).toContain(
      'full-product-shared-base-row-top" data-position="opponent"'
    );
    expect(asAlice).toContain(
      'full-product-shared-base-row-bottom" data-position="self"'
    );
    expect(asAlice.indexOf("Bob 基地")).toBeLessThan(asAlice.indexOf("Alice 基地"));

    // Viewer is Bob (player-2): the exact same board flips top and bottom.
    const asBob = render(makeBoard(), makeView({ viewerPlayerId: "player-2" }));
    expect(baseSection(asBob, "Alice 基地")).toContain('data-position="opponent"');
    expect(baseSection(asBob, "Bob 基地")).toContain('data-position="self"');
    expect(asBob.indexOf("Alice 基地")).toBeLessThan(asBob.indexOf("Bob 基地"));

    // The two central fields stay exactly two and keep their controller groups.
    expect(count(asBob, 'class="full-product-shared-battlefield"')).toBe(2);
    expect(asBob).toContain('aria-label="Alice 公共单位"');
    expect(asBob).toContain('aria-label="Bob 公共单位"');
  });

  it("resolves the base bands from owner ids, not the input array order", () => {
    // base-2 (Bob) is listed first; the viewer-aware placement must ignore that.
    const html = render(
      makeBoard({
        bases: [
          { locationId: "base-2", ownerPlayerId: "player-2", unitObjectIds: [] },
          { locationId: "base-1", ownerPlayerId: "player-1", unitObjectIds: [] }
        ]
      }),
      makeView({ viewerPlayerId: "player-1" })
    );
    expect(baseSection(html, "Alice 基地")).toContain('data-position="self"');
    expect(baseSection(html, "Bob 基地")).toContain('data-position="opponent"');
    expect(html.indexOf("Bob 基地")).toBeLessThan(html.indexOf("Alice 基地"));
    expect(count(html, 'class="full-product-shared-battlefield"')).toBe(2);
  });

  it("uses stable seat order for a spectator and fails closed when no seat maps to a base", () => {
    // No base belongs to the viewer: seat 1 (Alice) sits at the bottom, seat 2
    // (Bob) on top, with real names and no "our side"/"opponent" framing.
    const spectator = render(
      makeBoard(),
      makeView({ viewerPlayerId: "spectator-9" })
    );
    expect(baseSection(spectator, "Alice 基地")).toContain('data-position="seat-1"');
    expect(baseSection(spectator, "Bob 基地")).toContain('data-position="seat-2"');
    expect(spectator).not.toContain(SHARED_BATTLEFIELDS_INCOMPLETE_NOTICE);
    expect(spectator).not.toContain("我方");
    expect(spectator).not.toContain("对手");

    // The second seat owns no base: the projection cannot be located, so we
    // must show the incomplete notice and fabricate no base.
    const cannotLocate = render(
      makeBoard(),
      makeView({
        viewerPlayerId: "spectator-9",
        players: [
          alicePlayer,
          { ...bobPlayer, id: "player-3", name: "Carol" }
        ]
      })
    );
    expect(cannotLocate).toContain(SHARED_BATTLEFIELDS_INCOMPLETE_NOTICE);
    expect(cannotLocate).toContain('role="note"');
    expect(cannotLocate).not.toContain("Alice 基地");
    expect(cannotLocate).not.toContain("Carol 基地");
  });
});

describe("resolvePublicUnit zone whitelist", () => {
  const objects = [
    aliceUnit,
    aliceBaseUnit,
    aliceBattlefieldUnit,
    faceUpDiscard,
    faceUpLegend,
    faceDownBoardUnit
  ];

  it("resolves only face-up objects sitting on a legal on-board zone", () => {
    expect(resolvePublicUnit(objects, "unit-a1")).toBe(aliceUnit);
    expect(resolvePublicUnit(objects, "unit-a-base")).toBe(aliceBaseUnit);
    expect(resolvePublicUnit(objects, "unit-a-field")).toBe(aliceBattlefieldUnit);
    expect(resolvePublicUnit(objects, "discard-1")).toBeNull();
    expect(resolvePublicUnit(objects, "legend-1")).toBeNull();
    expect(resolvePublicUnit(objects, "unit-facedown")).toBeNull();
  });
});

describe("resolvePublicUnit", () => {
  const objects = [aliceUnit, bobHiddenHand, bobFaceUpHand];

  it("resolves face-up public objects only", () => {
    expect(resolvePublicUnit(objects, "unit-a1")).toBe(aliceUnit);
    expect(resolvePublicUnit(objects, "bob-hand-1")).toBeNull();
    expect(resolvePublicUnit(objects, "bob-hand-2")).toBeNull();
    expect(resolvePublicUnit(objects, "unknown")).toBeNull();
  });
});

function battlefield(
  locationId: string,
  overrides: Partial<Omit<DuelBoardView["battlefields"][number], "locationId">> = {}
): DuelBoardView["battlefields"][number] {
  return {
    locationId,
    cardObjectId: `obj-${locationId}`,
    cardId: locationId === "bf-1" ? "field-1" : "field-2",
    ownerPlayerId: "player-1",
    controllerPlayerId: null,
    contested: false,
    unitObjectIds: [],
    ...overrides
  };
}

function makeBoard(overrides: Partial<DuelBoardView> = {}): DuelBoardView {
  return {
    bases: [
      { locationId: "base-1", ownerPlayerId: "player-1", unitObjectIds: [] },
      { locationId: "base-2", ownerPlayerId: "player-2", unitObjectIds: [] }
    ],
    battlefields: [
      battlefield("bf-1", {
        controllerPlayerId: "player-2",
        contested: true,
        unitObjectIds: ["unit-a1", "unit-b1"]
      }),
      battlefield("bf-2")
    ],
    ...overrides
  };
}

function makeView(
  overrides: {
    connectionStatus?: PlayableMatchView["connectionStatus"];
    commandPending?: boolean;
    phase?: GamePhase;
    viewerPlayerId?: string;
    players?: GameProjection["players"];
  } = {}
): PlayableMatchView {
  return {
    connectionStatus: overrides.connectionStatus ?? "connected",
    commandPending: overrides.commandPending ?? false,
    viewerPlayerId: overrides.viewerPlayerId ?? "player-1",
    resolveCardTitle: cardId => `Card ${cardId}`,
    resolveCardImage: () => null,
    projection: makeProjection(overrides.phase ?? "main", overrides.players)
  };
}

const alicePlayer: GameProjection["players"][number] = {
  id: "player-1",
  name: "Alice",
  handCount: 0,
  hand: [],
  zoneCounts: { board: 1 }
};

const bobPlayer: GameProjection["players"][number] = {
  id: "player-2",
  name: "Bob",
  handCount: 2,
  hand: [],
  zoneCounts: { board: 1, hand: 2 }
};

function makeProjection(
  phase: GamePhase,
  players: GameProjection["players"] = [alicePlayer, bobPlayer]
): GameProjection {
  return {
    version: 1,
    eventSeq: 0,
    phase,
    turnNumber: 1,
    activePlayerId: "player-1",
    priority: { playerId: "player-1" },
    winnerPlayerId: null,
    prompt: null,
    waitingForPlayerId: null,
    objects: [
      aliceUnit,
      bobUnit,
      bobHiddenHand,
      bobFaceUpHand,
      stolenUnit,
      aliceBaseUnit,
      aliceBattlefieldUnit,
      faceUpDiscard,
      faceUpLegend,
      faceDownBoardUnit
    ],
    players,
    events: []
  };
}

function render(
  board: DuelBoardView,
  view: PlayableMatchView,
  props: {
    selectableObjectIds?: readonly string[];
    selectedTargetIds?: readonly string[];
    onSelectTarget?: (objectId: string) => void;
  } = {}
): string {
  return renderToStaticMarkup(
    <SharedBattlefields board={board} view={view} {...props} />
  );
}

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

function battlefieldSection(html: string, title: string): string {
  const index = html.indexOf(title);
  const start = html.lastIndexOf("<section", index);
  const end = html.indexOf("</section>", index);
  return html.slice(start, end);
}

function baseSection(html: string, label: string): string {
  const index = html.indexOf(label);
  if (index === -1) return "";
  const start = html.lastIndexOf("<section", index);
  const end = html.indexOf("</section>", index);
  return html.slice(start, end);
}

function unitGroup(html: string, ariaLabel: string): string {
  const marker = `aria-label="${ariaLabel}"`;
  const index = html.indexOf(marker);
  if (index === -1) return "";
  const start = html.lastIndexOf("<div", index);
  const end = html.indexOf("</div>", index);
  return html.slice(start, end);
}

/** Visible text of every "missing unit" notice, with SSR text separators removed. */
function missingNoticeCounts(html: string): string[] {
  const marker = `aria-label="${MISSING_UNIT_NOTICE}"`;
  const notices: string[] = [];
  let index = html.indexOf(marker);
  while (index !== -1) {
    const end = html.indexOf("</div>", index);
    notices.push(
      html
        .slice(index + marker.length, end)
        .replace(/<!--.*?-->/g, "")
        .replace(/^>/, "")
    );
    index = html.indexOf(marker, end);
  }
  return notices;
}

function unitButton(html: string, title: string): string {
  const close = html.indexOf(`>${title}</button>`);
  const open = html.lastIndexOf("<button", close);
  return html.slice(open, close + 1);
}
