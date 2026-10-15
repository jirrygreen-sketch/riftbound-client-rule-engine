import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import {
  DUEL_PROJECTION_SCHEMA_V2, DUEL_PROJECTION_SCHEMA_V3,
  isDuelProjection, isDuelProjectionAny, isDuelProjectionV2, isDuelProjectionV3
} from "@riftbound/protocol";
import type {
  DuelProjection,
  DuelProjectionV2,
  DuelProjectionV3,
  DuelWireAction,
  DuelWireCard,
  DuelWireGearPermanent,
  DuelWireLegendReadiness,
  DuelWireMatch,
  DuelWireMatchPlaying,
  DuelWireMatchPlayingV3,
  DuelWirePlayingPlayerV3,
  DuelWireSetupPlayer
} from "@riftbound/protocol";
import {
  DUEL_BASE_MIGHT_LABEL,
  DUEL_BASE_RUNE_LABEL,
  DUEL_CARD_ROLE_LANDSCAPE,
  DUEL_CARD_ROLE_PORTRAIT,
  DUEL_CONTESTED_LABEL,
  DUEL_GEAR_ATTACH_LABEL,
  DUEL_GEAR_SECTION_LABEL,
  DUEL_GEAR_UNATTACHED_LABEL,
  DUEL_GOLD_UNIVERSAL_TAG,
  DUEL_HAND_CARD_WIDTH_PX,
  DUEL_INSPECT_TRIGGER_PREFIX,
  DUEL_LEGEND_CONTROLLER_LABEL,
  DUEL_LEGEND_READINESS_LABELS,
  DUEL_MAIN_DECK_LABEL,
  DUEL_MULLIGAN_OWNER_HINT,
  DUEL_NO_CHAMPION_LABEL,
  DUEL_SCORE_TRACK_MAX_TICKS,
  DUEL_SPECTATOR_HAND_NOTICE,
  DUEL_TRASH_LABEL,
  DUEL_WAITING_TURN_START_NOTICE,
  DuelMatchBoard,
  buildDuelWireCommand,
  duelBoardGears,
  duelDeckCounts,
  duelGearHostLabel,
  duelInteractionLockedReason,
  duelLegendPermanent,
  duelPowerViews,
  duelPreviewTarget,
  duelResourceBase,
  duelScoreMarkerLabel,
  duelVisibleCardIds,
  mulliganResetKey,
  orderUnitGroupsForViewer,
  resolveDuelSides,
  resourcePoolStatusFor,
  resourceSourceActions,
  scoreTrackValues,
  toggleMulliganSelection,
  unitGroupsByController
} from "../../src/full-product/DuelMatchBoard";
import type { DuelMatchBoardProps } from "../../src/full-product/DuelMatchBoard";

// Human-readable card titles so assertions read like the tabletop, while every
// identity below is still an opaque server id from the wire.
const CARD_TITLES: Readonly<Record<string, string>> = {
  "legend.0": "旧日守望",
  "champ.0": "铁壁先锋",
  "legend.1": "暮色行者",
  "champ.1": "疾风刺客",
  "card.0.1": "符文学徒",
  "card.0.2": "战地医师",
  "card.0.3": "边境游侠",
  "card.0.4": "秘仪研习",
  "card.1.1": "阴影低语",
  "card.1.2": "毒刃忍者",
  "card.1.3": "夜行猎手",
  "card.1.4": "迷雾潜行",
  "field.0.0": "迷雾峡谷",
  "field.1.0": "焦土废墟",
  "rune.0.1": "炽烈符文",
  "rune.0.2": "翠意符文",
  "card.0.9": "亡者之息",
  "gear.p1.unit": "符能护符",
  "gear.p1.chain": "余烬徽记",
  "gear.p1.free": "铁脊护盾",
  "gear.p1.field": "战场圣物"
};
const resolveCardTitle = (cardId: string): string => CARD_TITLES[cardId] ?? cardId;

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

function buttonTags(html: string): readonly string[] {
  return html.match(/<button\b[^>]*>/g) ?? [];
}

function buttonTag(html: string, ariaLabel: string): string {
  const index = html.indexOf(`aria-label="${ariaLabel}"`);
  expect(index, `button ${ariaLabel} not found`).toBeGreaterThanOrEqual(0);
  const open = html.lastIndexOf("<button", index);
  const close = html.indexOf(">", index);
  return html.slice(open, close + 1);
}

function inspectButtonTags(html: string): readonly string[] {
  return buttonTags(html).filter(button => button.includes('data-card-inspect-only="true"'));
}

function inspectButtonCardIds(html: string): readonly string[] {
  return inspectButtonTags(html).map(button => {
    const cardId = button.match(/data-card-id="([^"]+)"/)?.[1];
    expect(button, "every inspect button must identify its visible card").toMatch(/data-card-id="[^"]+"/);
    return cardId!;
  });
}

function hiddenHandRegions(html: string): readonly string[] {
  const regions: string[] = [];
  let searchFrom = 0;
  while (true) {
    const start = html.indexOf('<div class="full-product-duel-hidden-hand"', searchFrom);
    if (start === -1) return regions;
    let end = start;
    for (let closeCount = 0; closeCount < 2; closeCount += 1) {
      end = html.indexOf("</div>", end) + "</div>".length;
      if (end < "</div>".length) return regions;
    }
    regions.push(html.slice(start, end));
    searchFrom = end;
  }
}

function pileRegion(html: string, area: string): string {
  const start = html.indexOf(`class="full-product-duel-mat-pile full-product-duel-mat-${area}"`);
  if (start === -1) return "";
  const open = html.lastIndexOf("<dl", start);
  const close = html.indexOf("</dl>", start);
  return html.slice(open, close === -1 ? html.length : close + "</dl>".length);
}

/*
 * Canonical Duel wire match, inlined from the 68-case checkpoint projection
 * sample (`public-duel-wire-contract-v1/canonical-projections.json`). The
 * `isDuelProjection` guard is asserted on every projection built from it, so
 * these fixtures are the real v1 wire shape — not a bespoke test double and not
 * a dependency on the gitignored outputs directory.
 */
const CANONICAL_SETUP_MATCH = {
  schemaVersion: 1,
  rulesetId: "riftbound-duel",
  matchId: "match-1",
  dataVersion: "data-1",
  catalogDigest: "digest-1",
  stateVersion: 0,
  eventSeq: 0,
  roster: [
    { playerId: "p1", displayName: "Player 1" },
    { playerId: "p2", displayName: "Player 2" }
  ],
  turnOrder: ["p1", "p2"],
  stage: "setup",
  setup: {
    stage: "mulligan",
    turnOrder: ["p1", "p2"],
    firstPlayerId: "p1",
    currentMulliganOwner: "p1",
    players: [
      {
        playerId: "p1",
        legend: { cardId: "legend.0" },
        champion: { cardId: "champ.0" },
        handCount: 4,
        mainDeckCount: 2,
        runeDeckCount: 1,
        mulliganStatus: "pending"
      },
      {
        playerId: "p2",
        legend: { cardId: "legend.1" },
        champion: { cardId: "champ.1" },
        handCount: 4,
        mainDeckCount: 2,
        runeDeckCount: 1,
        mulliganStatus: "pending"
      }
    ],
    selectedBattlefields: [
      { playerId: "p1", instanceId: "p1-field-0", cardId: "field.0.0" },
      { playerId: "p2", instanceId: "p2-field-0", cardId: "field.1.0" }
    ]
  }
} as const;

const HAND_P1: readonly DuelWireCard[] = [
  { uid: "p1-main-1", cardId: "card.0.1" },
  { uid: "p1-main-2", cardId: "card.0.2" },
  { uid: "p1-main-3", cardId: "card.0.3" },
  { uid: "p1-main-4", cardId: "card.0.4" }
];
const HAND_P2: readonly DuelWireCard[] = [
  { uid: "p2-main-1", cardId: "card.1.1" },
  { uid: "p2-main-2", cardId: "card.1.2" },
  { uid: "p2-main-3", cardId: "card.1.3" },
  { uid: "p2-main-4", cardId: "card.1.4" }
];

function setupProjection(
  viewer: string | null,
  viewerHand?: readonly DuelWireCard[],
  actions: readonly DuelWireAction[] = []
): DuelProjection {
  const base = CANONICAL_SETUP_MATCH.setup.players;
  const players: [DuelWireSetupPlayer, DuelWireSetupPlayer] = [
    base[0].playerId === viewer && viewerHand
      ? { ...base[0], hand: viewerHand }
      : { ...base[0] },
    base[1].playerId === viewer && viewerHand
      ? { ...base[1], hand: viewerHand }
      : { ...base[1] }
  ];
  const match = {
    ...CANONICAL_SETUP_MATCH,
    setup: { ...CANONICAL_SETUP_MATCH.setup, players }
  } as unknown as DuelWireMatch;
  return {
    projectionSchema: "riftbound-duel-v1",
    viewerPlayerId: viewer,
    match,
    actions
  };
}

const CANONICAL_PLAYING_MATCH = {
  schemaVersion: 1,
  rulesetId: "riftbound-duel",
  matchId: "match-1",
  dataVersion: "data-1",
  catalogDigest: "digest-1",
  stateVersion: 2,
  eventSeq: 2,
  roster: [
    { playerId: "p1", displayName: "Player 1" },
    { playerId: "p2", displayName: "Player 2" }
  ],
  turnOrder: ["p1", "p2"],
  stage: "playing",
  players: [
    {
      playerId: "p1",
      champion: { cardId: "champ.0" },
      legend: { cardId: "legend.0" },
      handCount: 4,
      mainDeckCount: 2,
      trash: []
    },
    {
      playerId: "p2",
      champion: { cardId: "champ.1" },
      legend: { cardId: "legend.1" },
      handCount: 4,
      mainDeckCount: 2,
      trash: []
    }
  ],
  board: {
    bases: [
      { locationId: '["duel-base","p1"]', ownerPlayerId: "p1", occupancy: [] },
      { locationId: '["duel-base","p2"]', ownerPlayerId: "p2", occupancy: [] }
    ],
    battlefields: [
      {
        locationId: '["duel-battlefield","p1-field-0"]',
        instanceId: "p1-field-0",
        cardId: "field.0.0",
        ownerPlayerId: "p1",
        controllerPlayerId: null,
        contested: false,
        contestingPlayerId: null,
        showdown: "none",
        combat: "none",
        occupancy: []
      },
      {
        locationId: '["duel-battlefield","p2-field-0"]',
        instanceId: "p2-field-0",
        cardId: "field.1.0",
        ownerPlayerId: "p2",
        controllerPlayerId: null,
        contested: false,
        contestingPlayerId: null,
        showdown: "none",
        combat: "none",
        occupancy: []
      }
    ],
    units: []
  },
  resources: {
    players: [
      {
        playerId: "p1",
        runePool: { energy: 0, power: { Fury: 0, Calm: 0, Mind: 0, Body: 0, Chaos: 0, Order: 0, any: 0 } },
        runeDeckCount: 1
      },
      {
        playerId: "p2",
        runePool: { energy: 0, power: { Fury: 0, Calm: 0, Mind: 0, Body: 0, Chaos: 0, Order: 0, any: 0 } },
        runeDeckCount: 1
      }
    ],
    bases: [
      { playerId: "p1", locationId: '["duel-base","p1"]', baseRunes: [], goldTokens: [] },
      { playerId: "p2", locationId: '["duel-base","p2"]', baseRunes: [], goldTokens: [] }
    ]
  },
  scoring: {
    playerIds: ["p1", "p2"],
    battlefieldLocationIds: [
      '["duel-battlefield","p1-field-0"]',
      '["duel-battlefield","p2-field-0"]'
    ],
    victoryScore: 8,
    turnNumber: 0,
    players: [
      { playerId: "p1", points: 0, scoredBattlefieldLocationIds: [] },
      { playerId: "p2", points: 0, scoredBattlefieldLocationIds: [] }
    ]
  },
  frame: {
    phase: "awaiting-turn-start",
    turnNumber: 1,
    turnPlayerId: "p1",
    priorityPlayerId: null,
    focusPlayerId: null,
    stateOpen: true,
    pendingPayment: null
  }
} as const;

const CANONICAL_PLAYING_P1: DuelProjection = {
  projectionSchema: "riftbound-duel-v1",
  viewerPlayerId: "p1",
  match: {
    ...CANONICAL_PLAYING_MATCH,
    players: [{ ...CANONICAL_PLAYING_MATCH.players[0], hand: HAND_P1 }, { ...CANONICAL_PLAYING_MATCH.players[1] }]
  } as unknown as DuelWireMatch,
  actions: []
};

// A synthetic-but-valid playing frame that exercises units, a token, a
// contested field with both controllers, a null champion, a live pool and the
// five real wire actions. It still satisfies `isDuelProjection`.
function richPlayingProjection(viewer: string | null): DuelProjection {
  const p1 = {
    playerId: "p1",
    champion: { cardId: "champ.0" },
    legend: { cardId: "legend.0" },
    handCount: 2,
    mainDeckCount: 3,
    ...(viewer === "p1" ? { hand: [{ uid: "p1-main-1", cardId: "card.0.1" }, { uid: "p1-main-2", cardId: "card.0.2" }] } : {}),
    trash: [{ uid: "p1-trash-1", cardId: "card.0.9" }]
  };
  const p2 = {
    playerId: "p2",
    champion: null,
    legend: { cardId: "legend.1" },
    handCount: 3,
    mainDeckCount: 4,
    trash: []
  };
  const actions: DuelWireAction[] =
    viewer === null
      ? []
      : [
          { id: "act-rune-energy", kind: "rune-energy", label: "横置符文 +1 能量", enabled: true, uid: "p1-rune-1" },
          { id: "act-rune-power", kind: "rune-power", label: "使用翠意符能", enabled: false, reason: "符文已横置", uid: "p1-rune-2" },
          { id: "act-gold", kind: "gold-power", label: "使用金币", enabled: true, uid: "p1-gold-1" },
          {
            id: "act-pay",
            kind: "pay-pending",
            label: "支付符文费用",
            enabled: true,
            paymentId: "pay-1",
            resolvedCost: { energy: 2, power: [{ allowedDomains: ["Fury"], amount: 1 }] }
          }
        ];
  const match: DuelWireMatchPlaying = {
    schemaVersion: 1,
    rulesetId: "riftbound-duel",
    matchId: "match-rich",
    dataVersion: "data-1",
    catalogDigest: "digest-1",
    stateVersion: 5,
    eventSeq: 5,
    roster: [
      { playerId: "p1", displayName: "Player 1" },
      { playerId: "p2", displayName: "Player 2" }
    ],
    turnOrder: ["p1", "p2"],
    stage: "playing",
    players: [p1, p2],
    board: {
      bases: [
        { locationId: '["duel-base","p1"]', ownerPlayerId: "p1", occupancy: ["u-p1-base"] },
        { locationId: '["duel-base","p2"]', ownerPlayerId: "p2", occupancy: [] }
      ],
      battlefields: [
        {
          locationId: '["duel-battlefield","p1-field-0"]',
          instanceId: "p1-field-0",
          cardId: "field.0.0",
          ownerPlayerId: "p1",
          controllerPlayerId: "p1",
          contested: true,
          contestingPlayerId: "p2",
          showdown: "none",
          combat: "none",
          occupancy: ["u-p1-bf", "u-p2-bf"]
        },
        {
          locationId: '["duel-battlefield","p2-field-0"]',
          instanceId: "p2-field-0",
          cardId: "field.1.0",
          ownerPlayerId: "p2",
          controllerPlayerId: null,
          contested: false,
          contestingPlayerId: null,
          showdown: "none",
          combat: "none",
          occupancy: []
        }
      ],
      units: [
        {
          objectId: "u-p1-base",
          controllerPlayerId: "p1",
          locationId: '["duel-base","p1"]',
          ownerPlayerId: "p1",
          readied: true,
          trait: { kind: "card", cardId: "card.0.2" },
          totalDamage: 0,
          damageMarks: []
        },
        {
          objectId: "u-p1-bf",
          controllerPlayerId: "p1",
          locationId: '["duel-battlefield","p1-field-0"]',
          ownerPlayerId: "p1",
          readied: true,
          trait: { kind: "card", cardId: "card.0.1" },
          totalDamage: 1,
          damageMarks: [{ amount: 1, responsiblePlayerId: "p2" }]
        },
        {
          objectId: "u-p2-bf",
          controllerPlayerId: "p2",
          locationId: '["duel-battlefield","p1-field-0"]',
          ownerPlayerId: "p2",
          readied: false,
          trait: { kind: "token", name: "幽灵傀儡", baseMight: 3, tags: ["spirit"] },
          totalDamage: 0,
          damageMarks: []
        }
      ]
    },
    resources: {
      players: [
        {
          playerId: "p1",
          runePool: { energy: 3, power: { Fury: 1, Calm: 0, Mind: 0, Body: 0, Chaos: 0, Order: 0, any: 2 } },
          runeDeckCount: 5
        },
        {
          playerId: "p2",
          runePool: { energy: 1, power: { Fury: 0, Calm: 0, Mind: 0, Body: 0, Chaos: 0, Order: 0, any: 0 } },
          runeDeckCount: 6
        }
      ],
      bases: [
        {
          playerId: "p1",
          locationId: '["duel-base","p1"]',
          baseRunes: [
            { uid: "p1-rune-1", cardId: "rune.0.1", domain: "Fury", readied: true, ownerPlayerId: "p1", controllerPlayerId: "p1", locationId: '["duel-base","p1"]' },
            { uid: "p1-rune-2", cardId: "rune.0.2", domain: "Calm", readied: false, ownerPlayerId: "p1", controllerPlayerId: "p1", locationId: '["duel-base","p1"]' }
          ],
          goldTokens: [
            { uid: "p1-gold-1", readied: true, ownerPlayerId: "p1", controllerPlayerId: "p1", locationId: '["duel-base","p1"]' }
          ]
        },
        { playerId: "p2", locationId: '["duel-base","p2"]', baseRunes: [], goldTokens: [] }
      ]
    },
    scoring: {
      playerIds: ["p1", "p2"],
      battlefieldLocationIds: [
        '["duel-battlefield","p1-field-0"]',
        '["duel-battlefield","p2-field-0"]'
      ],
      victoryScore: 8,
      turnNumber: 1,
      players: [
        { playerId: "p1", points: 3, scoredBattlefieldLocationIds: ['["duel-battlefield","p1-field-0"]'] },
        { playerId: "p2", points: 0, scoredBattlefieldLocationIds: [] }
      ]
    },
    frame: {
      phase: "main",
      turnNumber: 2,
      turnPlayerId: "p1",
      priorityPlayerId: "p1",
      focusPlayerId: null,
      stateOpen: true,
      pendingPayment:
        viewer === null
          ? null
          : {
              active: true,
              paymentId: "pay-1",
              resolvedCost: { energy: 2, power: [{ allowedDomains: ["Fury"], amount: 1 }] }
            }
    }
  };
  return { projectionSchema: "riftbound-duel-v1", viewerPlayerId: viewer, match, actions };
}

function render(props: DuelMatchBoardProps): string {
  return renderToStaticMarkup(<DuelMatchBoard {...props} />);
}

/**
 * The *same* rich board seen by the second seat. Only the two wire-legal,
 * viewer-dependent fields change: the hidden hand moves to p2, and the action
 * list is empty (a source action's `uid` must exist on the viewer's own base).
 * Every board, unit, base-rune and resource value is identical, so the two
 * views prove the band placement comes from the viewer and not from the data.
 */
function richPlayingViewer2(): DuelProjection {
  const match = richPlayingProjection("p1").match as DuelWireMatchPlaying;
  const { hand: _p1HiddenHand, ...p1WithoutHand } = match.players[0];
  return {
    projectionSchema: "riftbound-duel-v1",
    viewerPlayerId: "p2",
    match: {
      ...match,
      players: [
        p1WithoutHand,
        { ...match.players[1], hand: HAND_P2.slice(0, 3), handCount: 3 }
      ]
    } as unknown as DuelWireMatch,
    actions: []
  };
}

/**
 * The same rich board rebranded to the V2 projection schema. V1 and V2 playing
 * matches differ only by `schemaVersion`, so the board must render both through
 * one path; `isDuelProjectionV2` proves the rebrand is real V2 wire, not a
 * relaxed V1 fixture.
 */
function v2PlayingProjection(source: DuelProjection): DuelProjectionV2 {
  if (source.match.stage !== "playing") throw new Error("expected a playing match");
  return {
    projectionSchema: DUEL_PROJECTION_SCHEMA_V2,
    viewerPlayerId: source.viewerPlayerId,
    match: { ...source.match, schemaVersion: 2 },
    actions: source.actions
  };
}

const baseProps: Omit<DuelMatchBoardProps, "projection"> = {
  connectionStatus: "connected",
  commandPending: false,
  onCommand: () => {},
  resolveCardTitle
};

describe("DuelMatchBoard setup stage", () => {
  it("renders the owning viewer's real hand and hides the opponent hand behind a count", () => {
    const projection = setupProjection("p1", HAND_P1);
    expect(isDuelProjection(projection)).toBe(true);
    const html = render({ ...baseProps, projection });

    // Own hand: real card titles, each once.
    for (const card of HAND_P1) {
      expect(html, card.cardId).toContain(CARD_TITLES[card.cardId]!);
    }
    expect(count(html, 'class="full-product-duel-hand-card"')).toBe(4);
    // Opponent hand never leaks a card: only the public count / back marker.
    expect(html).toContain("手牌 4（背面）");
    expect(html).not.toContain("card.1.");
    // Both selected battlefields use their real card identities.
    expect(html).toContain("迷雾峡谷");
    expect(html).toContain("焦土废墟");
    // Setup identity slots carry the public legend/champion identities.
    expect(html).toContain("旧日守望");
    expect(html).toContain("铁壁先锋");
    // The viewer owns the current mulligan. Public cards keep their read-only
    // inspect controls, while no mulligan or game action control is fabricated.
    expect(html).toContain(DUEL_MULLIGAN_OWNER_HINT);
    const buttons = buttonTags(html);
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every(button => button.includes('data-card-inspect-only="true"'))).toBe(true);
    expect(html).not.toContain('class="full-product-duel-mulligan-card"');
    expect(html).not.toContain('class="full-product-duel-mulligan-confirm"');
  });

  it("scopes the visible hand to the second viewer and still hides the other hand", () => {
    const html = render({ ...baseProps, projection: setupProjection("p2", HAND_P2) });
    for (const card of HAND_P2) {
      expect(html, card.cardId).toContain(CARD_TITLES[card.cardId]!);
    }
    expect(html).not.toContain("符文学徒");
    expect(html).toContain("手牌 4（背面）");
  });

  it("hides both hands from a spectator and never claims a seat", () => {
    const projection = setupProjection(null);
    expect(isDuelProjection(projection)).toBe(true);
    const html = render({ ...baseProps, projection });

    expect(html).toContain(DUEL_SPECTATOR_HAND_NOTICE);
    expect(html).not.toContain("符文学徒");
    expect(html).not.toContain("阴影低语");
    expect(count(html, "手牌 4（背面）")).toBe(2);
    // Spectator never owns a seat.
    expect(resolveDuelSides(projection)).toEqual({
      bottomSeatId: "p1",
      topSeatId: "p2",
      viewerSeated: false
    });
  });

  it("gates mulligan on the supplied action: at most two picks, and an empty confirm", () => {
    const mulliganAction: DuelWireAction = {
      id: "act-mulligan",
      kind: "mulligan",
      label: "调度手牌",
      enabled: true,
      selectableUIDs: HAND_P1.map(card => card.uid),
      maxSelections: 2
    };
    const projection = setupProjection("p1", HAND_P1, [mulliganAction]);
    expect(isDuelProjection(projection)).toBe(true);
    const html = render({ ...baseProps, projection });

    // Only the server-selected uids become pickable.
    expect(count(html, 'class="full-product-duel-mulligan-card"')).toBe(4);
    expect(html).toContain("确认调度（已选 0）");
    // Zero picks is a legal confirm.
    expect(buttonTag(html, "调度选择 符文学徒")).toBeTruthy();
    expect(buttonTag(html, "确认调度，已选 0 张").includes("disabled")).toBe(false);

    // The pure selector enforces the cap and toggles off.
    expect(toggleMulliganSelection([], "p1-main-1", 2)).toEqual(["p1-main-1"]);
    expect(toggleMulliganSelection(["p1-main-1"], "p1-main-1", 2)).toEqual([]);
    expect(toggleMulliganSelection(["a", "b"], "c", 2)).toEqual(["a", "b"]);

    // The wire command passes the selection through untouched.
    expect(buildDuelWireCommand(mulliganAction, [])).toEqual({ type: "mulligan", selectedUIDs: [] });
    expect(buildDuelWireCommand(mulliganAction, ["p1-main-1", "p1-main-2"])).toEqual({
      type: "mulligan",
      selectedUIDs: ["p1-main-1", "p1-main-2"]
    });
    // A fresh state version clears any stale selection key.
    expect(mulliganResetKey(projection)).not.toBe(
      mulliganResetKey({
        ...projection,
        match: { ...projection.match, stateVersion: 1 } as DuelWireMatch
      })
    );
  });
});

describe("DuelMatchBoard mulligan reset key", () => {
  it("includes schemaVersion and eventSeq so equal-clock frames still reset local state", () => {
    const v1 = richPlayingProjection("p1");
    const baseline = mulliganResetKey(v1);

    // Same match, clock and viewer but a newer event sequence: a distinct key,
    // so a selection made against the old frame is dropped.
    const bumped: DuelProjection = {
      ...v1,
      match: { ...v1.match, eventSeq: v1.match.eventSeq + 1 } as DuelWireMatch
    };
    expect(bumped.match.stateVersion).toBe(v1.match.stateVersion);
    expect(mulliganResetKey(bumped)).not.toBe(baseline);

    // Same clock and viewer but a schema promotion V1→V2: also a distinct key.
    const v2 = v2PlayingProjection(v1);
    expect(v2.match.stateVersion).toBe(v1.match.stateVersion);
    expect(v2.match.eventSeq).toBe(v1.match.eventSeq);
    expect(mulliganResetKey(v2)).not.toBe(baseline);

    // A state-version change still resets, exactly as before.
    const versioned: DuelProjection = {
      ...v1,
      match: { ...v1.match, stateVersion: v1.match.stateVersion + 1 } as DuelWireMatch
    };
    expect(mulliganResetKey(versioned)).not.toBe(baseline);
  });
});

describe("DuelMatchBoard playing stage", () => {
  it("renders a V2 playing projection through the same board path as V1", () => {
    const v1 = richPlayingProjection("p1");
    const v2 = v2PlayingProjection(v1);
    expect(isDuelProjectionV2(v2)).toBe(true);
    expect(isDuelProjectionAny(v2)).toBe(true);
    expect(isDuelProjection(v2)).toBe(false);
    // The V2 schema fixes the match's schemaVersion from the projection, not a cast.
    expect(v2.match.schemaVersion).toBe(2);
    // Behaviour is unchanged: the V2 board is byte-for-byte the V1 board.
    expect(render({ ...baseProps, projection: v2 })).toBe(render({ ...baseProps, projection: v1 }));
  });

  it("places both controllers' units on one field, shows a token by name/might and a null champion", () => {
    const projection = richPlayingProjection("p1");
    expect(isDuelProjection(projection)).toBe(true);
    const html = render({ ...baseProps, projection });

    // Base p1 holds one unit; the contested field holds both controllers' units
    // as two separate groups, so three groups render in total.
    expect(count(html, 'class="full-product-duel-unit-group"')).toBe(3);
    expect(html).toContain('aria-label="Player 1 单位"');
    expect(html).toContain('aria-label="Player 2 单位"');
    expect(html).toContain(DUEL_CONTESTED_LABEL);

    // Token rendered by name + tags + base might (never a fabricated current might).
    expect(html).toContain("幽灵傀儡");
    expect(html).toContain(`${DUEL_BASE_MIGHT_LABEL} 3`);
    expect(html).toContain("spirit");
    // Readied/damage come from the wire.
    expect(html).toContain("横置");
    expect(html).toContain("伤害 1");

    // A null champion is a stable, explicit "does not exist" — never invented.
    expect(html).toContain(DUEL_NO_CHAMPION_LABEL);
    // The viewer's own pool and its sources are shown, gold annotated as any-power.
    expect(html).toContain('data-res="energy"');
    expect(html).toContain(DUEL_GOLD_UNIVERSAL_TAG);
    expect(count(html, 'class="full-product-resource-pool-chip is-power"')).toBe(1);
  });

  it("builds only real wire commands and fails closed when the connection is not ready", () => {
    const projection = richPlayingProjection("p1");
    const actions = projection.actions;
    const byId = (id: string): DuelWireAction => actions.find(a => a.id === id)!;

    expect(buildDuelWireCommand(byId("act-rune-energy"))).toEqual({ type: "rune-energy", uid: "p1-rune-1" });
    expect(buildDuelWireCommand(byId("act-rune-power"))).toEqual({ type: "rune-power", uid: "p1-rune-2" });
    expect(buildDuelWireCommand(byId("act-gold"))).toEqual({ type: "gold-power", uid: "p1-gold-1" });
    expect(buildDuelWireCommand(byId("act-pay"))).toEqual({ type: "pay-pending", paymentId: "pay-1" });
    // Unknown provider/cost is never silently turned into a no-op command.
    const unknown = { id: "x", kind: "mystery", label: "x", enabled: true } as unknown as DuelWireAction;
    expect(buildDuelWireCommand(unknown)).toBeNull();

    // Read-only gate precedence.
    expect(duelInteractionLockedReason({ connectionStatus: "connected", commandPending: false, ended: false })).toBeNull();
    expect(
      duelInteractionLockedReason({ connectionStatus: "connected", commandPending: true, ended: false })
    ).toContain("处理中");
    expect(
      duelInteractionLockedReason({ connectionStatus: "disconnected", commandPending: false, ended: false })
    ).toContain("断开");
    expect(
      duelInteractionLockedReason({ connectionStatus: "connected", commandPending: false, ended: true })
    ).toContain("结束");

    // resourcePoolStatusFor maps the client union and never invents a status.
    expect(resourcePoolStatusFor("connected")).toBe("connected");
    expect(resourcePoolStatusFor("reconnecting")).toBe("reconnecting");
    expect(resourcePoolStatusFor("connecting")).toBe("waiting");
    expect(resourcePoolStatusFor("disconnected")).toBe("disconnected");

    // Disconnected → every control is disabled and a clear reason is shown.
    const locked = render({ ...baseProps, projection, connectionStatus: "disconnected" });
    expect(locked).toContain("连接已断开，界面只读");
    expect(buttonTag(locked, "支付符文费用").includes("disabled")).toBe(true);
    // Deterministic: no local count is mutated between renders.
    expect(render({ ...baseProps, projection })).toBe(render({ ...baseProps, projection }));

    // Source actions come only from the projection; gold carries the any tag.
    const sources = resourceSourceActions(actions);
    expect(sources.map(action => action.id)).toEqual(["act-rune-energy", "act-rune-power", "act-gold"]);
    expect(sources.find(action => action.id === "act-gold")?.detail).toBe(DUEL_GOLD_UNIVERSAL_TAG);
    // Six domains + any from the viewer's real pool.
    expect(duelPowerViews(projection.match.stage === "playing" ? projection.match.resources.players[0]!.runePool : { energy: 0, power: { Fury: 0, Calm: 0, Mind: 0, Body: 0, Chaos: 0, Order: 0, any: 0 } })).toHaveLength(7);
  });

  it("shows an honest waiting notice in awaiting-turn-start and fabricates no control", () => {
    expect(isDuelProjection(CANONICAL_PLAYING_P1)).toBe(true);
    const html = render({ ...baseProps, projection: CANONICAL_PLAYING_P1 });

    expect(html).toContain(DUEL_WAITING_TURN_START_NOTICE);
    expect(html).toContain("第 1 回合");
    expect(html).toContain("行动：Player 1");
    // Score rail: victory target on top, the real points markers, zero at the base.
    expect(html).toContain('aria-label="胜利分"');
    expect(html).toContain("Player 1 0");
    expect(html).toContain("Player 2 0");
    // Own hand from the wire; opponent hand hidden.
    expect(count(html, 'class="full-product-duel-hand-card"')).toBe(4);
    expect(html).toContain("手牌 4（背面）");
    // The four local ribbon scroll buttons and public-card inspect controls are
    // present; no game action exists.
    expect(count(html, "<button")).toBe(count(html, 'data-card-inspect-only="true"') + 4);
    expect(count(html, 'aria-label="向左查看')).toBe(2);
    expect(count(html, 'aria-label="向右查看')).toBe(2);
    expect(count(html, 'class="full-product-duel-action"')).toBe(0);
  });

  it("gives a spectator a read-only, side-neutral board with both pools", () => {
    const projection = richPlayingProjection(null);
    expect(isDuelProjection(projection)).toBe(true);
    const html = render({ ...baseProps, projection });

    expect(html).toContain(DUEL_SPECTATOR_HAND_NOTICE);
    expect(html).toContain("旁观视角：资源只读");
    expect(html).toContain('aria-label="Player 1 能量"');
    expect(html).toContain('aria-label="Player 2 能量"');
    // The component's own bands are labelled by real seat name and carry only
    // the neutral position markers; the component never claims an identity.
    expect(html).toContain('aria-label="Player 1 基地"');
    expect(html).toContain('aria-label="Player 2 基地"');
    expect(html).toContain('data-position="player"');
    expect(html).toContain('data-position="opponent"');
    expect(html).not.toContain("我方视角");
    expect(count(html, "<button")).toBe(count(html, 'data-card-inspect-only="true"') + 4);
    expect(count(html, 'aria-label="向左查看')).toBe(2);
    expect(count(html, 'aria-label="向右查看')).toBe(2);
    expect(count(html, 'class="full-product-duel-action"')).toBe(0);
    expect(resolveDuelSides(projection).viewerSeated).toBe(false);
    // A seated viewer resolves the opposite seat on top.
    expect(resolveDuelSides(richPlayingProjection("p1"))).toEqual({
      bottomSeatId: "p1",
      topSeatId: "p2",
      viewerSeated: true
    });
    expect(resolveDuelSides(setupProjection("p2", HAND_P2))).toEqual({
      bottomSeatId: "p2",
      topSeatId: "p1",
      viewerSeated: true
    });
  });
});

/*
 * A resolver shaped exactly like the production wiring (`App` maps a catalog
 * lookup to an HTTP image URL). These additional cases exercise the display
 * counts, the read-only preview and the score rail; none of them change the
 * authoritative source, pool, deck or point values.
 */
const resolveCardImage = (cardId: string): string | null =>
  cardId.length > 0 ? `https://cards.example/${cardId}.png` : null;

/** p1's hand replaced with a single, otherwise-unused identity. */
function withP1Hand(hand: readonly DuelWireCard[], handCount: number): DuelProjection {
  const base = richPlayingProjection("p1");
  const match = base.match as DuelWireMatchPlaying;
  return {
    ...base,
    match: {
      ...match,
      players: [{ ...match.players[0], hand, handCount }, match.players[1]]
    } as unknown as DuelWireMatch
  };
}

/** The rich playing frame with p1's server-reported points overridden. */
function overTargetProjection(points: number): DuelProjection {
  const base = richPlayingProjection("p1");
  const match = base.match as DuelWireMatchPlaying;
  return {
    ...base,
    match: {
      ...match,
      scoring: {
        ...match.scoring,
        players: [{ ...match.scoring.players[0], points }, match.scoring.players[1]]
      }
    } as unknown as DuelWireMatch
  };
}

/** The text content of the `<dd>` carrying a given aria-label. */
function ddText(html: string, ariaLabel: string): string {
  const index = html.indexOf(`aria-label="${ariaLabel}"`);
  expect(index, `dd ${ariaLabel} not found`).toBeGreaterThanOrEqual(0);
  const open = html.indexOf(">", index);
  const close = html.indexOf("</dd>", open);
  return html.slice(open + 1, close);
}

describe("DuelMatchBoard playing base public zones", () => {
  it("renders public base runes, gold and deck/trash counts straight from the projection", () => {
    const projection = richPlayingProjection("p1");
    expect(isDuelProjection(projection)).toBe(true);
    const playing = projection.match as DuelWireMatchPlaying;
    const html = render({ ...baseProps, projection });

    // The lookup behind the render matches on both playerId and locationId.
    expect(
      duelResourceBase(playing, "p1", '["duel-base","p1"]')?.baseRunes.map(rune => rune.cardId)
    ).toEqual(["rune.0.1", "rune.0.2"]);
    expect(duelResourceBase(playing, "p1", '["duel-base","p2"]')).toBeNull();

    // Two small base runes with their real domain + readied state.
    expect(count(html, 'class="full-product-duel-baserune"')).toBe(2);
    expect(html).toContain('data-domain="Fury" data-readied="true"');
    expect(html).toContain('data-domain="Calm" data-readied="false"');
    expect(html).toContain(`aria-label="Player 1 ${DUEL_BASE_RUNE_LABEL}"`);

    // Gold: one readied token, shown as a plain mark (no card id, no metadata).
    expect(html).toContain("1（就绪 1／横置 0）");
    expect(count(html, 'class="full-product-duel-gold"')).toBe(1);
    expect(html).toContain('class="full-product-duel-gold" data-readied="true"');

    // Public deck/trash counts for both seats, plus the hidden opponent hand.
    expect(duelDeckCounts(playing, "p1")).toEqual({ mainDeck: 3, runeDeck: 5, trash: 1 });
    expect(duelDeckCounts(playing, "p2")).toEqual({ mainDeck: 4, runeDeck: 6, trash: 0 });
    expect(ddText(html, "Player 1 主牌堆")).toBe("3");
    expect(ddText(html, "Player 1 符文库")).toBe("5");
    expect(ddText(html, "Player 1 弃牌")).toBe("1");
    expect(html).toContain(`aria-label="Player 1 ${DUEL_MAIN_DECK_LABEL}"`);
    expect(html).toContain(`aria-label="Player 1 ${DUEL_TRASH_LABEL}"`);
    expect(html).toContain("手牌 3（背面）");
    // The opponent hand never leaks a card identity.
    expect(html).not.toContain("card.1.");
    expect(html).not.toContain("阴影低语");
  });

  it("keeps a setup base honest: no fabricated base runes before any rune is placed", () => {
    const html = render({ ...baseProps, projection: setupProjection("p1", HAND_P1) });
    expect(count(html, 'class="full-product-duel-baserune"')).toBe(0);
    expect(count(html, 'class="full-product-duel-gold"')).toBe(0);
    // Setup still shows the real stage information (identity + mulligan state).
    expect(html).toContain("调度");
    expect(html).toContain("旧日守望");
  });
});

describe("DuelMatchBoard card preview privacy", () => {
  it("previews only identities the current viewer can already see", () => {
    // A unique hand identity that appears nowhere else on the board.
    const handProjection = withP1Hand([{ uid: "p1-hand-x", cardId: "card.0.5" }], 1);
    expect(isDuelProjection(handProjection)).toBe(true);
    expect(duelVisibleCardIds(handProjection)).toContain("card.0.5");
    expect(duelPreviewTarget(handProjection, "card.0.5")).toBe("card.0.5");
    // The opponent hand identity is never visible, even to the seated viewer.
    expect(duelPreviewTarget(handProjection, "card.1.1")).toBeNull();

    const spectator = richPlayingProjection(null);
    expect(isDuelProjection(spectator)).toBe(true);
    expect(duelPreviewTarget(spectator, "card.0.5")).toBeNull();
    // A viewer switch changes the reset key, so a stale pick is dropped.
    expect(mulliganResetKey(handProjection)).not.toBe(mulliganResetKey(spectator));

    // Render level: the own-hand button exists for the owner, and the whole
    // identity vanishes (no one-frame leak) for the spectator.
    const ownHtml = render({ ...baseProps, projection: handProjection, resolveCardImage });
    expect(ownHtml).toContain("查看大图：card.0.5");
    const spectatorHtml = render({ ...baseProps, projection: spectator, resolveCardImage });
    expect(spectatorHtml).not.toContain("card.0.5");
  });
});

describe("DuelMatchBoard inspect-button privacy", () => {
  const cases: readonly {
    readonly label: string;
    readonly projection: DuelProjection;
    readonly hiddenCards: readonly DuelWireCard[];
  }[] = [
    {
      label: "setup",
      projection: setupProjection("p1", HAND_P1),
      hiddenCards: HAND_P2
    },
    {
      label: "playing",
      projection: richPlayingProjection("p1"),
      hiddenCards: HAND_P2
    },
    {
      label: "spectator",
      projection: richPlayingProjection(null),
      hiddenCards: [...HAND_P1, ...HAND_P2]
    },
    {
      label: "second seat",
      projection: richPlayingViewer2(),
      hiddenCards: HAND_P1
    }
  ];

  for (const { label, projection, hiddenCards } of cases) {
    it(`exposes inspect buttons only for visible projected cards (${label})`, () => {
      const html = render({ ...baseProps, projection, resolveCardImage });
      const inspectButtons = inspectButtonTags(html);
      const visibleCardIds = new Set(duelVisibleCardIds(projection));
      const hiddenOnlyCards = hiddenCards.filter(card => !visibleCardIds.has(card.cardId));

      expect(inspectButtons.length, `${label} should have public inspect controls`).toBeGreaterThan(0);
      for (const cardId of inspectButtonCardIds(html)) {
        expect(visibleCardIds.has(cardId), `${label} inspect target ${cardId}`).toBe(true);
      }

      for (const region of hiddenHandRegions(html)) {
        expect(region, `${label} hidden hand`).not.toContain("<button");
      }
      for (const area of ["main-deck", "rune-deck", "trash"]) {
        expect(pileRegion(html, area), `${label} ${area}`).not.toContain("<button");
      }

      for (const hiddenCard of hiddenOnlyCards) {
        const hiddenTitle = CARD_TITLES[hiddenCard.cardId]!;
        const hiddenImage = `https://cards.example/${hiddenCard.cardId}.png`;
        for (const button of inspectButtons) {
          expect(button).not.toContain(hiddenCard.cardId);
          expect(button).not.toContain(hiddenTitle);
          expect(button).not.toContain(hiddenImage);
        }
      }
    });
  }
});

describe("DuelMatchBoard read-only card preview", () => {
  it("keeps inspect available while locked but never turns a card into a command", () => {
    const projection = richPlayingProjection("p1");
    const locked = render({
      ...baseProps,
      projection,
      connectionStatus: "disconnected",
      resolveCardImage
    });
    // The preview trigger is a real button and stays reachable when read-only.
    expect(buttonTag(locked, "查看大图：符文学徒").includes("disabled")).toBe(false);
    // A real command is still gated by the connection.
    expect(buttonTag(locked, "支付符文费用").includes("disabled")).toBe(true);

    // A spectator can inspect images and scroll base ribbons, with no game action.
    const spectatorHtml = render({
      ...baseProps,
      projection: richPlayingProjection(null),
      resolveCardImage
    });
    expect(count(spectatorHtml, 'class="full-product-duel-action"')).toBe(0);
    expect(count(spectatorHtml, "<button")).toBe(count(spectatorHtml, 'aria-label="查看大图：') + 4);
  });
});

/*
 * Viewer-side bands and card faces.
 *
 * The two base bands are placed from `resolveDuelSides` (the real viewer), not
 * from the roster or `board.bases` order: the opposing seat is the top band and
 * the viewer's own seat is the bottom band for *either* seated viewer, and a
 * spectator keeps the stable seat order without being assigned a side.
 */
function bandSections(html: string): readonly { position: string; owner: string; at: number }[] {
  return [
    ...html.matchAll(
      /<section class="full-product-duel-base[^"]*" data-position="([^"]+)" data-owner-player-id="([^"]+)"/g
    )
  ].map(match => ({ position: match[1]!, owner: match[2]!, at: match.index! }));
}

/** The rendered first battlefield section (both controllers' units). */
function battlefieldSection(html: string, instanceId: string): string {
  const start = html.indexOf(`data-instance-id="${instanceId}"`);
  expect(start, instanceId).toBeGreaterThanOrEqual(0);
  const next = html.indexOf('<section class="full-product-duel-battlefield"', start);
  return html.slice(start, next === -1 ? html.length : next);
}

describe("DuelMatchBoard viewer side bands", () => {
  it("puts the opposing seat on top and the viewer's own seat at the bottom for both viewers", () => {
    const viewer1 = richPlayingProjection("p1");
    const viewer2 = richPlayingViewer2();
    expect(isDuelProjection(viewer1)).toBe(true);
    expect(isDuelProjection(viewer2)).toBe(true);

    // p1 views: opponent (p2) band first, own (p1) band below it.
    const html1 = render({ ...baseProps, projection: viewer1 });
    expect(bandSections(html1).map(band => [band.position, band.owner])).toEqual([
      ["opponent", "p2"],
      ["player", "p1"]
    ]);
    // The own band (bottom) carries the viewer's real base unit; the opponent
    // band is honestly empty here.
    const own1 = html1.indexOf('data-position="player"');
    expect(html1.slice(own1)).toContain("战地医师");

    // p2 views the *same* board: the bands swap, so the roster order alone can
    // never decide which side is "ours".
    const html2 = render({ ...baseProps, projection: viewer2 });
    expect(bandSections(html2).map(band => [band.position, band.owner])).toEqual([
      ["opponent", "p1"],
      ["player", "p2"]
    ]);
    const opponent2 = html2.indexOf('data-position="opponent"');
    const own2 = html2.indexOf('data-position="player"');
    expect(opponent2).toBeLessThan(own2);
    // p1's real base unit now sits in the opponent (top) band.
    expect(html2.slice(opponent2, own2)).toContain("战地医师");
    expect(resolveDuelSides(viewer2)).toEqual({
      bottomSeatId: "p2",
      topSeatId: "p1",
      viewerSeated: true
    });
  });

  it("keeps a spectator on the stable seat order and never claims a side", () => {
    const spectator = richPlayingProjection(null);
    expect(isDuelProjection(spectator)).toBe(true);
    const html = render({ ...baseProps, projection: spectator });

    // Stable roster seat order, both bands neutral: no "ours" is invented.
    expect(bandSections(html).map(band => [band.position, band.owner])).toEqual([
      ["opponent", "p2"],
      ["player", "p1"]
    ]);
    expect(resolveDuelSides(spectator)).toEqual({
      bottomSeatId: "p1",
      topSeatId: "p2",
      viewerSeated: false
    });
    // The only "我方" left on a spectator page is the shell's fixed bottom-region
    // landmark (DuelTableLayout, not owned here). The band the component fills is
    // labelled with the real seat name and claims no side.
    expect(count(html, "我方")).toBe(1);
    expect(html).toContain('aria-label="我方基地"');
    const ownBand = html.slice(html.indexOf('data-position="player"'));
    expect(ownBand.slice(0, ownBand.indexOf("</section></section>"))).not.toContain("我方");
  });

  it("orders each field's controller groups opponent-first, grouped by controller only", () => {
    const viewer1 = richPlayingProjection("p1");
    const viewer2 = richPlayingProjection("p2");
    const spectator = richPlayingProjection(null);
    const field = viewer1.match.stage === "playing" ? viewer1.match.board.units : [];
    const fieldUnits = field.filter(unit => unit.locationId === '["duel-battlefield","p1-field-0"]');

    // Grouping stays keyed on the *current controller*; ownership is irrelevant.
    expect([...unitGroupsByController(fieldUnits).keys()]).toEqual(["p1", "p2"]);
    expect(
      orderUnitGroupsForViewer(fieldUnits, resolveDuelSides(viewer1)).map(([controller]) => controller)
    ).toEqual(["p2", "p1"]);
    expect(
      orderUnitGroupsForViewer(fieldUnits, resolveDuelSides(viewer2)).map(([controller]) => controller)
    ).toEqual(["p1", "p2"]);
    // A spectator keeps the projection order and is handed no side at all.
    expect(
      orderUnitGroupsForViewer(fieldUnits, resolveDuelSides(spectator)).map(([controller]) => controller)
    ).toEqual(["p1", "p2"]);

    const section1 = battlefieldSection(render({ ...baseProps, projection: viewer1 }), "p1-field-0");
    const atOpponent1 = section1.indexOf('aria-label="Player 2 单位"');
    const atOwn1 = section1.indexOf('aria-label="Player 1 单位"');
    expect(atOpponent1).toBeGreaterThanOrEqual(0);
    expect(atOpponent1).toBeLessThan(atOwn1);

    const section2 = battlefieldSection(render({ ...baseProps, projection: viewer2 }), "p1-field-0");
    const atOpponent2 = section2.indexOf('aria-label="Player 1 单位"');
    const atOwn2 = section2.indexOf('aria-label="Player 2 单位"');
    expect(atOpponent2).toBeGreaterThanOrEqual(0);
    expect(atOpponent2).toBeLessThan(atOwn2);
  });
});

/* The rendered card faces: the real component must tag the orientation of every
   face it draws, so the CSS can size portrait cards and landscape battlefields
   differently without ever cropping one into a cover strip. */
function imgTagsWithClass(html: string, className: string): readonly string[] {
  return [...html.matchAll(new RegExp(`<img class="${className}"[^>]*>`, "g"))].map(
    match => match[0]
  );
}

describe("DuelMatchBoard card faces", () => {
  it("tags portrait hand/unit/legend/champion/rune faces and landscape battlefields", () => {
    const projection = richPlayingProjection("p1");
    const html = render({ ...baseProps, projection, resolveCardImage });

    const handFaces = imgTagsWithClass(html, "full-product-duel-hand-thumb");
    expect(handFaces).toHaveLength(2);
    for (const tag of handFaces) expect(tag).toContain(`data-card-role="${DUEL_CARD_ROLE_PORTRAIT}"`);

    const unitFaces = imgTagsWithClass(html, "full-product-duel-unit-thumb");
    expect(unitFaces.length).toBeGreaterThan(0);
    for (const tag of unitFaces) expect(tag).toContain(`data-card-role="${DUEL_CARD_ROLE_PORTRAIT}"`);

    // p1's legend + champion and p2's legend (its champion is null) = 3 faces.
    const identityFaces = imgTagsWithClass(html, "full-product-duel-identity-thumb");
    expect(identityFaces).toHaveLength(3);
    for (const tag of identityFaces)
      expect(tag).toContain(`data-card-role="${DUEL_CARD_ROLE_PORTRAIT}"`);

    // Runes are drawn by the chip itself (not through CardArt) and are portrait.
    expect(html).toMatch(
      new RegExp(`<img class="full-product-duel-baserune-thumb"[^>]*data-card-role="${DUEL_CARD_ROLE_PORTRAIT}"`)
    );

    // Battlefield cards are landscape, and nothing else is.
    const battlefieldFaces = imgTagsWithClass(html, "full-product-duel-battlefield-thumb");
    expect(battlefieldFaces).toHaveLength(2);
    for (const tag of battlefieldFaces)
      expect(tag).toContain(`data-card-role="${DUEL_CARD_ROLE_LANDSCAPE}"`);
    // The landscape role appears exactly twice per battlefield face (the
    // inspect <button> and the <img> inside it) and nowhere else, so no
    // portrait face is ever sized as a landscape card.
    expect(count(html, `data-card-role="${DUEL_CARD_ROLE_LANDSCAPE}"`)).toBe(
      battlefieldFaces.length * 2
    );
  });

  it("sizes faces whole and budgets both playmat hands within the table", () => {
    const boardCss = readFileSync(
      fileURLToPath(new URL("../../src/full-product/DuelMatchBoard.css", import.meta.url)),
      "utf8"
    );
    const layoutCss = readFileSync(
      fileURLToPath(
        new URL("../../src/full-product/components/DuelTableLayout.css", import.meta.url)
      ),
      "utf8"
    );

    // The card gets its real asset ratio, so a face is never distorted.
    expect(boardCss).toContain("--duel-card-portrait-ratio: 744 / 1039");
    expect(boardCss).toContain("--duel-card-landscape-ratio: 1038 / 744");

    // No card face is ever cropped again (the only mentions of `contain` are the
    // doc comment plus one real rule per face family: identity, base rune,
    // battlefield/unit/hand and the big preview).
    expect(boardCss).not.toContain("object-fit: cover");
    expect(count(boardCss, "object-fit: contain")).toBeGreaterThanOrEqual(5);

    // Portrait faces keep the portrait ratio; the battlefield keeps its own.
    expect(count(boardCss, "aspect-ratio: var(--duel-card-portrait-ratio)")).toBeGreaterThanOrEqual(4);
    expect(count(boardCss, "aspect-ratio: var(--duel-card-landscape-ratio)")).toBeGreaterThanOrEqual(1);

    // The fixed, too-short face heights that produced cover strips are gone.
    expect(boardCss).not.toContain("height: 4.6rem");
    expect(boardCss).not.toContain("height: 2.4rem");
    expect(boardCss).not.toContain("height: 1.9rem");
    expect(boardCss).not.toContain("height: 4.2rem");

    // The hand contract is unchanged: 160px wide cards that scroll sideways,
    // with only the face height bounded on a short viewport.
    expect(boardCss).toMatch(/\.full-product-duel-hand-card\s*\{[^}]*flex:\s*0 0 160px/);
    expect(DUEL_HAND_CARD_WIDTH_PX).toBe(160);
    expect(boardCss).toMatch(/\.full-product-duel-hand\s*\{[^}]*overflow-x:\s*auto/);
    expect(boardCss).toMatch(/--duel-hand-face-height:\s*min\(/);

    // Layout: base bands fit their complete card ribbons, central fields scroll,
    // the compact pool shares the bottom row with the separate hand strip.
    expect(layoutCss).toMatch(
      /\.full-product-duel-table-main\s*\{[^}]*grid-template-rows:\s*34px\s*minmax\(108px, 1fr\)\s*minmax\(112px, 1\.4fr\)\s*minmax\(108px, 1fr\)\s*var\(--duel-hand-row-height\)/
    );
    expect(layoutCss).not.toMatch(/\.full-product-duel-table-opponent\s*\{[^}]*max-height:\s*\d+vh/);
    expect(layoutCss).not.toMatch(/\.full-product-duel-table-player\s*\{[^}]*max-height:\s*\d+vh/);
    expect(layoutCss).toMatch(/\.full-product-duel-table-resources\s*\{[^}]*max-height:\s*100%/);
    expect(layoutCss).toMatch(/\.full-product-duel-table-resources\s*\{[^}]*width:\s*100%/);
    expect(layoutCss).toMatch(/\.full-product-duel-table-central\s*\{[^}]*overflow:\s*auto/);
    expect(layoutCss).toMatch(/\.full-product-duel-table-main\s*\{[^}]*overflow:\s*auto/);
  });
});

describe("DuelMatchBoard score rail", () => {
  it("renders a bounded 0..8 tick scale with real server point markers", () => {
    expect(scoreTrackValues(8)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(scoreTrackValues(8)).toHaveLength(9);
    // Defensive bound: an absurd victory target still yields a finite list.
    expect(scoreTrackValues(1000)).toHaveLength(DUEL_SCORE_TRACK_MAX_TICKS);
    expect(duelScoreMarkerLabel("Player 1")).toBe("Pla");
    expect(duelScoreMarkerLabel("阿狸")).toBe("阿狸");

    expect(isDuelProjection(CANONICAL_PLAYING_P1)).toBe(true);
    const html = render({ ...baseProps, projection: CANONICAL_PLAYING_P1 });
    expect(count(html, 'class="full-product-duel-score-tick"')).toBe(9);
    expect(html).toContain('data-tick="0"');
    expect(html).toContain('data-tick="8"');
    expect(html).toContain('data-goal="true"');
    expect(html).toContain('aria-label="胜利分"');
    // Both real server markers are present.
    expect(html).toContain('data-points="0"');
  });

  it("shows the real number when a player is past the victory target", () => {
    const projection = overTargetProjection(12);
    expect(isDuelProjection(projection)).toBe(true);
    const html = render({ ...baseProps, projection });
    // Past the target: the real server value is shown, never clamped to 0.
    expect(html).toContain('data-points="12"');
    expect(html).toContain("Player 1 12");
    // The victory target itself is unchanged and still spans 9 ticks.
    expect(html).toContain('data-tick="8"');
    expect(count(html, 'class="full-product-duel-score-tick"')).toBe(9);
  });
});


/*
 * V3 public permanents. `v3PlayingProjection` rebrands a real rich V1 board to
 * the V3 wire shape — schemaVersion 3, a permanent Legend (controller +
 * readiness) and `board.gears` — and every fixture built from it is asserted
 * with the real `isDuelProjectionV3` guard, so these are true V3 projections,
 * not V1 boards with a few extra keys.
 */
const V3_BASE_P1 = '["duel-base","p1"]';
const V3_FIELD_P1 = '["duel-battlefield","p1-field-0"]';

interface V3FixtureOptions {
  readonly gears?: readonly DuelWireGearPermanent[];
  readonly readiness?: Readonly<Record<string, DuelWireLegendReadiness>>;
  readonly legendControllers?: Readonly<Record<string, string>>;
  readonly actions?: readonly DuelWireAction[];
  readonly awaitingTurnStart?: boolean;
}

function v3PlayingProjection(source: DuelProjection, options: V3FixtureOptions = {}): DuelProjectionV3 {
  if (source.match.stage !== "playing") throw new Error("expected a playing match");
  const match = source.match as DuelWireMatchPlaying;
  const readiness = options.readiness ?? { p1: "ready", p2: "ready" };
  const legendControllers = options.legendControllers ?? {};
  const players = match.players.map(player => ({
    ...player,
    legend: {
      cardId: player.legend.cardId,
      controllerPlayerId: legendControllers[player.playerId] ?? player.playerId,
      readiness: readiness[player.playerId] ?? "ready"
    }
  })) as unknown as readonly [DuelWirePlayingPlayerV3, DuelWirePlayingPlayerV3];
  const frame = options.awaitingTurnStart
    ? {
        phase: "awaiting-turn-start",
        turnNumber: 1,
        turnPlayerId: match.frame.turnPlayerId,
        priorityPlayerId: null,
        focusPlayerId: null,
        stateOpen: true,
        pendingPayment: null
      }
    : match.frame;
  const actions = options.awaitingTurnStart ? [] : (options.actions ?? source.actions);
  return {
    projectionSchema: DUEL_PROJECTION_SCHEMA_V3,
    viewerPlayerId: source.viewerPlayerId,
    match: {
      ...match,
      schemaVersion: 3,
      players,
      board: { ...match.board, gears: options.gears ?? [] },
      frame
    },
    actions
  } as unknown as DuelProjectionV3;
}

/**
 * An independent Gear, a Gear attached to a real card unit, a Gear attached to
 * another Gear (the chain), plus a Gear at a battlefield location — the exact
 * public shapes the V3 guard admits.
 */
const V3_GEARS: readonly DuelWireGearPermanent[] = [
  {
    uid: "gear.p1.unit",
    cardId: "gear.p1.unit",
    controllerPlayerId: "p1",
    locationId: V3_BASE_P1,
    readied: true,
    attachedToUID: "u-p1-base"
  },
  {
    uid: "gear.p1.chain",
    cardId: "gear.p1.chain",
    controllerPlayerId: "p1",
    locationId: V3_BASE_P1,
    readied: false,
    attachedToUID: "gear.p1.unit"
  },
  {
    uid: "gear.p1.free",
    cardId: "gear.p1.free",
    controllerPlayerId: "p1",
    locationId: V3_BASE_P1,
    readied: true,
    attachedToUID: null
  },
  {
    uid: "gear.p1.field",
    cardId: "gear.p1.field",
    controllerPlayerId: "p1",
    locationId: V3_FIELD_P1,
    readied: true,
    attachedToUID: null
  }
];

describe("DuelMatchBoard V3 permanents", () => {
  it("leaves V1/V2 boards free of permanent UI and only reads V3 fields when schemaVersion is 3", () => {
    const v1 = richPlayingProjection("p1");
    const v2 = v2PlayingProjection(v1);
    const v1Match = v1.match as DuelWireMatchPlaying;

    // The reader helpers return no permanent data for V1/V2 — not a guess.
    expect(duelBoardGears(v1Match)).toEqual([]);
    expect(duelLegendPermanent(v1Match, "p1")).toBeNull();
    expect(duelBoardGears(v2.match as DuelWireMatchPlaying)).toEqual([]);
    expect(duelLegendPermanent(v2.match as DuelWireMatchPlaying, "p1")).toBeNull();

    const v1Html = render({ ...baseProps, projection: v1 });
    const v2Html = render({ ...baseProps, projection: v2 });
    // Regression: V1 and V2 stay byte-for-byte identical, with no permanent UI.
    expect(v1Html).toBe(v2Html);
    expect(v1Html).not.toContain("full-product-duel-gears");
    expect(v1Html).not.toContain("full-product-duel-legend-state");
  });

  it("renders a V3 playing board behind its own schema and leaves no placeholder for empty gears", () => {
    const v3 = v3PlayingProjection(richPlayingProjection("p1"));
    expect(isDuelProjectionV3(v3)).toBe(true);
    expect(isDuelProjectionV2(v3)).toBe(false);
    expect(isDuelProjection(v3)).toBe(false);
    expect(isDuelProjectionAny(v3)).toBe(true);
    expect(v3.match.schemaVersion).toBe(3);

    const html = render({ ...baseProps, projection: v3 });
    // Empty gears: no Gear section and no big empty block is left behind.
    expect(html).not.toContain("full-product-duel-gears");
    expect(html).not.toContain(DUEL_GEAR_SECTION_LABEL);
    // Both seats now expose the server-projected Legend controller + readiness.
    expect(count(html, 'class="full-product-duel-legend-state"')).toBe(2);
    expect(html).toContain(`${DUEL_LEGEND_CONTROLLER_LABEL}：Player 1`);
    expect(html).toContain(DUEL_LEGEND_READINESS_LABELS.ready);
  });

  it("shows Gear face/name, controller, ready state and its wire attachment host by location", () => {
    const v3 = v3PlayingProjection(richPlayingProjection("p1"), { gears: V3_GEARS });
    expect(isDuelProjectionV3(v3)).toBe(true);
    const html = render({ ...baseProps, projection: v3 });

    // Four Gears total, grouped into two location strips (base p1 + field p1).
    expect(count(html, 'class="full-product-duel-gear"')).toBe(4);
    expect(count(html, 'class="full-product-duel-gear-list"')).toBe(2);
    const escapedLocation = (value: string): string => value.replace(/"/g, "&quot;");
    expect(html).toContain(`data-location-id="${escapedLocation(V3_BASE_P1)}"`);
    expect(html).toContain(`data-location-id="${escapedLocation(V3_FIELD_P1)}"`);
    expect(html).toContain('aria-label="' + DUEL_GEAR_SECTION_LABEL + '"');

    // Card names come from the real identities.
    expect(html).toContain("符能护符");
    expect(html).toContain("余烬徽记");
    expect(html).toContain("铁脊护盾");
    expect(html).toContain("战场圣物");
    // Every Gear names its current controller.
    expect(html).toContain(`${DUEL_LEGEND_CONTROLLER_LABEL}：Player 1`);
    // Attachment hosts are read from the wire and shown as public titles:
    // the unit host and the Gear-on-Gear host, never a raw uid.
    expect(html).toContain(`${DUEL_GEAR_ATTACH_LABEL}：战地医师`);
    expect(html).toContain(`${DUEL_GEAR_ATTACH_LABEL}：符能护符`);
    // Independent Gears say so.
    expect(html).toContain(DUEL_GEAR_UNATTACHED_LABEL);
    // Ready/exhausted is carried straight from the wire.
    expect(html).toContain('data-readied="false"');
    expect(html).toContain('data-readied="true"');
  });

  it("shows the Legend's three readiness states and its current controller", () => {
    // not-established is only wire-legal on the first awaiting-turn-start frame.
    const awaiting = v3PlayingProjection(richPlayingProjection("p1"), {
      awaitingTurnStart: true,
      readiness: { p1: "not-established", p2: "not-established" }
    });
    expect(isDuelProjectionV3(awaiting)).toBe(true);
    const awaitingHtml = render({ ...baseProps, projection: awaiting });
    expect(count(awaitingHtml, 'class="full-product-duel-legend-state" data-readiness="not-established"')).toBe(2);
    expect(awaitingHtml).toContain(DUEL_LEGEND_READINESS_LABELS["not-established"]);

    const main = v3PlayingProjection(richPlayingProjection("p1"), {
      readiness: { p1: "ready", p2: "exhausted" },
      legendControllers: { p1: "p2" }
    });
    expect(isDuelProjectionV3(main)).toBe(true);
    const html = render({ ...baseProps, projection: main });
    expect(count(html, 'class="full-product-duel-legend-state" data-readiness="ready"')).toBe(1);
    expect(count(html, 'class="full-product-duel-legend-state" data-readiness="exhausted"')).toBe(1);
    expect(html).toContain(DUEL_LEGEND_READINESS_LABELS.ready);
    expect(html).toContain(DUEL_LEGEND_READINESS_LABELS.exhausted);
    // The controller is the server projection, not the seat owner: p1's Legend
    // is currently controlled by Player 2.
    expect(html).toContain(`${DUEL_LEGEND_CONTROLLER_LABEL}：Player 2`);
    // No uid/owner leaks into the rendered text.
    expect(html).not.toContain("ownerPlayerId");
  });

  it("never turns a ready Gear or Legend into an action or command", () => {
    const reported: string[] = [];
    const v3 = v3PlayingProjection(richPlayingProjection("p1"), { gears: V3_GEARS, actions: [] });
    expect(isDuelProjectionV3(v3)).toBe(true);
    const html = render({
      ...baseProps,
      projection: v3,
      resolveCardImage,
      onCommand: command => reported.push(JSON.stringify(command))
    });

    // Real ready permanents are on screen, and the Legend readiness is shown…
    expect(count(html, 'class="full-product-duel-gear"')).toBe(4);
    expect(html).toContain(DUEL_LEGEND_READINESS_LABELS.ready);
    // …a Gear with an image still produces the shared, *read-only* preview
    // button (它的唯一动作就是展示大图)…
    expect(html).toContain(`${DUEL_INSPECT_TRIGGER_PREFIX}符能护符`);
    // Preview and local ribbon scrolling are view controls; no action control
    // is conjured from a ready Gear or Legend and nothing is dispatched.
    expect(count(html, "<button")).toBeGreaterThan(0);
    expect(count(html, "<button")).toBe(count(html, `aria-label="${DUEL_INSPECT_TRIGGER_PREFIX}`) + 4);
    expect(count(html, 'class="full-product-duel-action"')).toBe(0);
    expect(reported).toEqual([]);

    // The helpers are pure wire readers: no derived command, no graph repair.
    const board = (v3.match as DuelWireMatchPlayingV3).board;
    expect(duelBoardGears(v3.match as DuelWireMatchPlayingV3)).toEqual(V3_GEARS);
    expect(duelLegendPermanent(v3.match as DuelWireMatchPlayingV3, "p1")).toEqual({
      cardId: "legend.0",
      controllerPlayerId: "p1",
      readiness: "ready"
    });
    expect(duelGearHostLabel(V3_GEARS, board.units, "u-p1-base", resolveCardTitle)).toBe("战地医师");
    expect(duelGearHostLabel(V3_GEARS, board.units, "gear.p1.unit", resolveCardTitle)).toBe("符能护符");
    // An unresolvable host shows nothing rather than inventing a target.
    expect(duelGearHostLabel(V3_GEARS, board.units, "ghost-host", resolveCardTitle)).toBeNull();
  });
});
