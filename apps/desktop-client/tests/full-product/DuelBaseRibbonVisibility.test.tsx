import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import {
  DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1,
  isDuelProjectionV3Actions1,
  type DuelProjectionV3Actions1
} from "@riftbound/protocol";
import {
  DUEL_BASE_MIGHT_LABEL,
  DUEL_BASE_RUNE_LABEL,
  DUEL_DOMAIN_LABELS,
  DUEL_GOLD_LABEL,
  DUEL_GEAR_SECTION_LABEL,
  DUEL_LEGEND_CONTROLLER_LABEL,
  DUEL_MAIN_DECK_LABEL,
  DUEL_READY_LABEL,
  DUEL_RUNE_DECK_LABEL,
  DUEL_TAPPED_LABEL,
  DUEL_TRASH_LABEL,
  DuelMatchBoard
} from "../../src/full-product/DuelMatchBoard";
import type { DuelMatchBoardProps } from "../../src/full-product/DuelMatchBoard";

/*
 * Focused *base-ribbon* coverage for the formal Duel surface.
 *
 * The real 2026-10-15 gap: the base band wraps its groups under a fixed height
 * cap, so a crowded base (8-12 runes beside the identity row, or a base unit /
 * Gear in a narrow main column) pushed its rune group onto a second line that
 * the cap then clipped. The fix is presentational only: the base keeps its
 * title + hand count on the first line and everything else on ONE non-wrapping,
 * sideways-scrolling body ribbon, with compact image-left / text-right mini
 * cards for base units and Gears.
 *
 * Every projection here is a genuine P4 DTO (asserted with the production
 * `isDuelProjectionV3Actions1` guard) built from wire shapes only. A JSDOM
 * `renderToStaticMarkup` pass proves structure, never pixels and never a real
 * match — the parent performs the native pixel acceptance.
 */

const BASE_ALICE = JSON.stringify(["duel-base", "alice"]);
const BASE_BOB = JSON.stringify(["duel-base", "bob"]);
const FIELD_A = JSON.stringify(["duel-battlefield", "bf-a"]);
const FIELD_B = JSON.stringify(["duel-battlefield", "bf-b"]);

const EMPTY_POWER = { Fury: 0, Calm: 0, Mind: 0, Body: 0, Chaos: 0, Order: 0, any: 0 } as const;
const DOMAINS = ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"] as const;

interface BaseRibbonOptions {
  readonly viewer?: string | null;
  /** Base runes on alice's base. The real gap shows at 2, 8 and 12. */
  readonly runeCount?: number;
  /** Gold tokens on alice's base. */
  readonly goldCount?: number;
  /** Put one public unit on alice's base (compact mini card contract). */
  readonly withBaseUnit?: boolean;
  /** Put one public Gear on alice's base (compact mini card contract). */
  readonly withBaseGear?: boolean;
  /** Leave bob's base empty (no runes / gold / unit / gear). */
  readonly emptyOpponentBase?: boolean;
}

function baseRuneWire(index: number, domain: string): Record<string, unknown> {
  return {
    uid: `alice-rune-${index}`,
    cardId: `rune-${index}`,
    domain,
    readied: index % 2 === 0,
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    locationId: BASE_ALICE
  };
}

function baseGoldWire(index: number): Record<string, unknown> {
  return {
    uid: `alice-gold-${index}`,
    readied: index % 2 === 0,
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    locationId: BASE_ALICE
  };
}

/**
 * A real playing P4 board whose alice base can carry 2/8/12 runes, gold, one
 * unit and one Gear, while bob's base stays empty. Both central battlefields
 * are empty and non-contested so the base-ribbon assertions are isolated.
 */
function baseRibbonProjection(options: BaseRibbonOptions = {}): DuelProjectionV3Actions1 {
  const viewer = options.viewer === undefined ? "alice" : options.viewer;
  const runeCount = options.runeCount ?? 2;
  const goldCount = options.goldCount ?? 1;

  const units: Record<string, unknown>[] = [];
  if (options.withBaseUnit) {
    units.push({
      objectId: "u-alice-base",
      controllerPlayerId: "alice",
      ownerPlayerId: "alice",
      locationId: BASE_ALICE,
      readied: false,
      trait: { kind: "card", cardId: "unit-base-a" },
      totalDamage: 3,
      damageMarks: [{ amount: 3, responsiblePlayerId: "bob" }]
    });
  }

  const gears: Record<string, unknown>[] = [];
  if (options.withBaseGear) {
    gears.push({
      uid: "gear-alice-base",
      cardId: "gear-base-a",
      controllerPlayerId: "alice",
      locationId: BASE_ALICE,
      readied: true,
      attachedToUID: options.withBaseUnit ? "u-alice-base" : null
    });
  }

  const aliceOccupancy = units.filter(unit => unit.locationId === BASE_ALICE).map(unit => unit.objectId as string);
  const bobEmpty = options.emptyOpponentBase ?? true;
  const bobRunes = bobEmpty ? [] : [baseRuneWire(99, "Chaos")];

  // A real public hand count stays honest: the seated viewer also gets that many
  // real cards (the guard requires `hand.length === handCount`); everyone else
  // gets the public count with no hand array at all.
  const HAND_COUNT = 2;
  const alicePlayer: Record<string, unknown> = {
    playerId: "alice",
    champion: { cardId: "champ-a" },
    legend: { cardId: "legend-a", controllerPlayerId: "alice", readiness: "ready" },
    handCount: HAND_COUNT,
    mainDeckCount: 30,
    trash: []
  };
  const bobPlayer: Record<string, unknown> = {
    playerId: "bob",
    champion: null,
    legend: { cardId: "legend-b", controllerPlayerId: "bob", readiness: "ready" },
    handCount: HAND_COUNT,
    mainDeckCount: 30,
    trash: []
  };
  if (viewer === "alice") {
    alicePlayer.hand = [
      { uid: "alice-hand-1", cardId: "hand-a" },
      { uid: "alice-hand-2", cardId: "hand-a2" }
    ];
  }
  if (viewer === "bob") {
    bobPlayer.hand = [
      { uid: "bob-hand-1", cardId: "hand-b" },
      { uid: "bob-hand-2", cardId: "hand-b2" }
    ];
  }

  const projection = {
    projectionSchema: DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1,
    viewerPlayerId: viewer,
    match: {
      schemaVersion: 3,
      rulesetId: "riftbound-duel",
      matchId: "base-ribbon-1",
      dataVersion: "dv-1",
      catalogDigest: "cd-1",
      stateVersion: 6,
      eventSeq: 12,
      roster: [
        { playerId: "alice", displayName: "Alice" },
        { playerId: "bob", displayName: "Bob" }
      ],
      turnOrder: ["alice", "bob"],
      stage: "playing",
      players: [alicePlayer, bobPlayer],
      board: {
        bases: [
          { locationId: BASE_ALICE, ownerPlayerId: "alice", occupancy: aliceOccupancy },
          { locationId: BASE_BOB, ownerPlayerId: "bob", occupancy: [] }
        ],
        battlefields: [
          {
            locationId: FIELD_A,
            instanceId: "bf-a",
            cardId: "field-card-a",
            ownerPlayerId: "alice",
            controllerPlayerId: null,
            contested: false,
            contestingPlayerId: null,
            showdown: "none",
            combat: "none",
            occupancy: []
          },
          {
            locationId: FIELD_B,
            instanceId: "bf-b",
            cardId: "field-card-b",
            ownerPlayerId: "bob",
            controllerPlayerId: null,
            contested: false,
            contestingPlayerId: null,
            showdown: "none",
            combat: "none",
            occupancy: []
          }
        ],
        units,
        gears
      },
      resources: {
        players: [
          { playerId: "alice", runePool: { energy: 3, power: { ...EMPTY_POWER } }, runeDeckCount: 8 },
          { playerId: "bob", runePool: { energy: 2, power: { ...EMPTY_POWER } }, runeDeckCount: 8 }
        ],
        bases: [
          {
            playerId: "alice",
            locationId: BASE_ALICE,
            baseRunes: Array.from({ length: runeCount }, (_, index) =>
              baseRuneWire(index, DOMAINS[index % DOMAINS.length]!)),
            goldTokens: Array.from({ length: goldCount }, (_, index) => baseGoldWire(index))
          },
          { playerId: "bob", locationId: BASE_BOB, baseRunes: bobRunes, goldTokens: [] }
        ]
      },
      scoring: {
        playerIds: ["alice", "bob"],
        battlefieldLocationIds: [FIELD_A, FIELD_B],
        victoryScore: 8,
        turnNumber: 9,
        players: [
          { playerId: "alice", points: 0, scoredBattlefieldLocationIds: [] },
          { playerId: "bob", points: 0, scoredBattlefieldLocationIds: [] }
        ]
      },
      frame: {
        phase: "main",
        turnNumber: 9,
        turnPlayerId: "alice",
        priorityPlayerId: "alice",
        focusPlayerId: null,
        stateOpen: true,
        pendingPayment: null,
        chain: { active: false },
        pendingChoice: null,
        execution: { status: "ready" }
      }
    },
    actions: []
  } as unknown as DuelProjectionV3Actions1;
  expect(isDuelProjectionV3Actions1(projection)).toBe(true);
  return projection;
}

const CARD_TITLES: Readonly<Record<string, string>> = {
  "field-card-a": "迷雾峡谷",
  "field-card-b": "焦土废墟",
  "unit-base-a": "战地医师",
  "gear-base-a": "符能护符"
};
const resolveCardTitle = (cardId: string): string => CARD_TITLES[cardId] ?? cardId;
const resolveCardImage = (cardId: string): string | null =>
  cardId.length > 0 ? `https://cards.example/${cardId}.png` : null;

function render(props: Partial<DuelMatchBoardProps> & { projection: DuelProjectionV3Actions1 }): string {
  const full: DuelMatchBoardProps = {
    connectionStatus: "connected",
    commandPending: false,
    onCommand: () => {},
    resolveCardTitle,
    resolveCardImage,
    resolveCardDomains: id => id === "legend-a" ? ["Fury", "Mind"] : id === "legend-b" ? ["Body", "Chaos"] : [],
    ...props
  };
  return renderToStaticMarkup(<DuelMatchBoard {...full} />);
}

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

function countClass(html: string, className: string): number {
  return [...html.matchAll(new RegExp(`class="(?:[^"]* )?${className}(?= |")`, "g"))].length;
}

/** The rendered base `<section>` for one seat position (`opponent` / `player`). */
function baseBandSection(html: string, position: string): string {
  const start = html.indexOf(`data-position="${position}"`);
  expect(start, position).toBeGreaterThanOrEqual(0);
  const next = html.indexOf('<section class="full-product-duel-base', start);
  return html.slice(start, next === -1 ? html.length : next);
}

/** The body ribbon of one base band (everything below the title row). */
function baseBody(html: string, position: string): string {
  const section = baseBandSection(html, position);
  const start = section.indexOf('class="full-product-duel-base-body"');
  expect(start, `${position} base body`).toBeGreaterThanOrEqual(0);
  return section.slice(start);
}

describe("base ribbon · rune preservation (2 / 8 / 12)", () => {
  for (const runeCount of [2, 8, 12] as const) {
    it(`keeps all ${runeCount} base runes with their inline domain + ready state`, () => {
      const html = render({ projection: baseRibbonProjection({ viewer: "alice", runeCount }) });
      const ownBand = baseBandSection(html, "player");
      // Every rune chip survives; none is dropped to make the band fit.
      expect(countClass(ownBand, "full-product-duel-baserune")).toBe(runeCount);
      // Each chip keeps its domain and ready/exhaust caption in the same chip.
      expect(count(ownBand, 'class="full-product-duel-baserune-caption"')).toBe(runeCount);
      expect(count(ownBand, 'class="full-product-duel-baserune-domain"')).toBe(runeCount);
      expect(count(ownBand, 'class="full-product-duel-baserune-state"')).toBe(runeCount);
      // The rune group's own label is present, alongside its mini cards.
      expect(ownBand).toContain(`aria-label="Alice ${DUEL_BASE_RUNE_LABEL}"`);
    });
  }

  it("alternates real ready / exhausted runes instead of flattening them to one state", () => {
    const html = render({ projection: baseRibbonProjection({ viewer: "alice", runeCount: 8 }) });
    const ownBand = baseBandSection(html, "player");
    expect(count(ownBand, 'data-readied="true"')).toBeGreaterThan(0);
    expect(count(ownBand, 'data-readied="false"')).toBeGreaterThan(0);
    expect(ownBand).toContain(DUEL_READY_LABEL);
    expect(ownBand).toContain(DUEL_TAPPED_LABEL);
    // The real per-rune domain labels (Chinese short labels) are on the chips.
    expect(ownBand).toContain(DUEL_DOMAIN_LABELS.Fury);
    expect(ownBand).toContain(DUEL_DOMAIN_LABELS.Calm);
  });
});

describe("base ribbon · title, metadata and footer survive", () => {
  it("keeps the base title + hand count on the first line for both seats", () => {
    const html = render({ projection: baseRibbonProjection({ viewer: "alice" }) });
    // Base titles stay inside their zones; hand counts belong to the two hand regions.
    expect(count(html, 'class="full-product-duel-base-head"')).toBe(2);
    expect(count(html, 'class="full-product-duel-base-title"')).toBe(2);
    expect(html).toContain("Alice 基地");
    expect(html).toContain("Bob 基地");
    expect(html).toContain("手牌 2");
    // The opponent hand stays a hidden count, never a leaked card identity.
    expect(html).toContain("手牌 2（背面）");
    expect(html).not.toContain("bob-hand-1");
  });

  it("drops no footer/metadata group from either base body", () => {
    const html = render({
      projection: baseRibbonProjection({ viewer: "alice", runeCount: 8, withBaseUnit: true, withBaseGear: true })
    });
    const ownBody = baseBandSection(html, "player");
    // Every public group survives in its own playmat zone.
    expect(ownBody).toContain("full-product-duel-setup-identity");
    expect(ownBody).toContain("full-product-duel-legend-state");
    expect(ownBody).toContain("full-product-duel-baserunes");
    expect(ownBody).toContain("full-product-duel-gold-line");
    expect(ownBody).toContain("full-product-duel-mat-main-deck");
    expect(ownBody).toContain("full-product-duel-mat-rune-deck");
    expect(ownBody).toContain("full-product-duel-mat-trash");
    expect(ownBody).toContain("full-product-duel-gears");
    expect(ownBody).toContain("full-product-duel-unit-groups");
    // The real public metadata labels + values are still rendered.
    expect(ownBody).toContain(DUEL_MAIN_DECK_LABEL);
    expect(ownBody).toContain(DUEL_RUNE_DECK_LABEL);
    expect(ownBody).toContain(DUEL_TRASH_LABEL);
    expect(ownBody).toContain(DUEL_GOLD_LABEL);
    expect(ownBody).toContain(DUEL_GEAR_SECTION_LABEL);
    expect(ownBody).toContain(`${DUEL_LEGEND_CONTROLLER_LABEL}：Alice`);
  });
});

describe("base ribbon · compact base unit and Gear mini cards", () => {
  it("shows a base unit's name, ownership, control, ready state and damage", () => {
    const html = render({ projection: baseRibbonProjection({ viewer: "alice", withBaseUnit: true }) });
    const ownBody = baseBody(html, "player");
    expect(ownBody).toContain("战地医师");
    // Owner + controller are both carried as data even though they are equal here.
    expect(ownBody).toContain('data-owner-player-id="alice"');
    expect(ownBody).toContain('data-controller-player-id="alice"');
    // Readied/exhausted and damage come straight from the wire.
    expect(ownBody).toContain("横置");
    expect(ownBody).toContain("伤害 3");
    // A real token's printed Might is base Might, never a fabricated current one.
    expect(DUEL_BASE_MIGHT_LABEL).toBe("基础战力");
  });

  it("shows a base Gear's name, controller, ready state and attachment host", () => {
    const html = render({
      projection: baseRibbonProjection({ viewer: "alice", withBaseUnit: true, withBaseGear: true })
    });
    const ownBody = baseBody(html, "player");
    expect(ownBody).toContain("符能护符");
    expect(ownBody).toContain(`${DUEL_LEGEND_CONTROLLER_LABEL}：Alice`);
    expect(ownBody).toContain(DUEL_READY_LABEL);
    // The wire attachment host resolves to the public unit title, never a uid.
    expect(ownBody).toContain("附着于：战地医师");
  });

  it("does not turn a ready base Gear or unit into an action", () => {
    const reported: string[] = [];
    const html = render({
      projection: baseRibbonProjection({ viewer: "alice", withBaseUnit: true, withBaseGear: true }),
      onCommand: command => reported.push(JSON.stringify(command))
    });
    // Image inspection and ribbon scrolling are local view controls; neither
    // creates a legal game action or dispatches a command.
    expect(count(html, "<button")).toBeGreaterThan(0);
    expect(count(html, "<button")).toBe(count(html, 'aria-label="查看大图：') + 4);
    expect(html).toContain('aria-label="向右查看Alice基地卡片"');
    expect(html).toContain('aria-label="向左查看Bob基地卡片"');
    expect(count(html, 'class="full-product-duel-action"')).toBe(0);
    expect(reported).toEqual([]);
  });
});

describe("base ribbon · empty base and observer", () => {
  it("keeps an empty base honest: notice, no fabricated runes / units / gears", () => {
    const html = render({
      projection: baseRibbonProjection({ viewer: "alice", runeCount: 8, emptyOpponentBase: true })
    });
    const opponentBand = baseBandSection(html, "opponent");
    // Bob's base projects nothing: no rune chips, no unit, no gear at all.
    expect(countClass(opponentBand, "full-product-duel-baserune")).toBe(0);
    expect(countClass(opponentBand, "full-product-duel-unit")).toBe(0);
    expect(countClass(opponentBand, "full-product-duel-gear")).toBe(0);
    // The honest empty notice renders instead of an invented rune.
    expect(opponentBand).toContain("full-product-duel-empty");
    // Below the title the empty notice is still inside the body ribbon.
    expect(baseBody(html, "opponent")).toContain("full-product-duel-empty");
  });

  it("shows both bases to an unseated observer without leaking a hand", () => {
    const html = render({
      projection: baseRibbonProjection({ viewer: null, runeCount: 8, withBaseUnit: true, withBaseGear: true })
    });
    expect(count(html, 'class="full-product-duel-base-head"')).toBe(2);
    // Both base bodies carry their rune groups.
    expect(count(html, 'class="full-product-duel-baserunes"')).toBe(2);
    // No real hand card identity leaks; the observer only sees back counts.
    expect(html).not.toContain("alice-hand-1");
    expect(html).not.toContain("alice-hand-2");
    expect(html).not.toContain("bob-hand-1");
    expect(html).not.toContain("bob-hand-2");
    expect(count(html, "手牌 2（背面）")).toBe(2);
    expect(html).not.toContain("full-product-duel-hand-card");
  });
});

describe("base ribbon · CSS contract (non-wrapping body, compact mini cards)", () => {
  const boardCss = readFileSync(
    fileURLToPath(new URL("../../src/full-product/DuelMatchBoard.css", import.meta.url)),
    "utf8"
  );

  it("makes the base a two-row band whose body never wraps", () => {
    expect(boardCss).toMatch(/\.full-product-duel-base\s*\{[^}]*flex-direction:\s*column/);
    expect(boardCss).toMatch(/\.full-product-duel-base\s*\{[^}]*flex-wrap:\s*nowrap/);
    // The body is one horizontal, sideways-scrolling ribbon.
    const body = boardCss.match(/\.full-product-duel-base-body\s*\{[^}]*\}/)?.[0] ?? "";
    expect(body).toContain("flex-direction: row");
    expect(body).toContain("flex-wrap: nowrap");
    expect(body).toContain("overflow-x: auto");
  });

  it("bounds base unit / Gear faces to a compact mini-card height", () => {
    expect(boardCss).toMatch(/--duel-basecard-face-height:\s*min\(/);
    expect(boardCss).toMatch(
      /\.full-product-duel-base-body \.full-product-duel-gear-thumb[\s\S]*?\{[^}]*height:\s*var\(--duel-basecard-face-height\)/
    );
    expect(boardCss).toMatch(
      /\.full-product-duel-base-body \.full-product-duel-unit-thumb[\s\S]*?\{[^}]*height:\s*var\(--duel-basecard-face-height\)/
    );
    // The base mini cards lay the face and its text side by side.
    expect(boardCss).toMatch(/\.full-product-duel-base-body \.full-product-duel-unit[^{]*\{[^}]*flex-direction:\s*row/);
    expect(boardCss).toMatch(/\.full-product-duel-base-body \.full-product-duel-gear[^{]*\{[^}]*flex-direction:\s*row/);
  });

  it("never crops a base face and keeps the central 150px unit style out of the base scope", () => {
    expect(boardCss).not.toContain("object-fit: cover");
    // The compact override is scoped to the base ribbon; the central field's
    // taller unit face style is untouched (still uses --duel-unit-face-height).
    expect(boardCss).toMatch(/\.full-product-duel-unit-thumb[\s\S]*?max-height:\s*var\(--duel-unit-face-height\)/);
  });
});

describe("playmat · per-Legend resource counters", () => {
  const poolFor = (html: string, player: string): string => {
    const escaped = html.split(`aria-label="${player} 当前资源池">`)[1];
    expect(escaped).toBeDefined();
    return escaped!.split("</dl>")[0]!;
  };

  it("shows each Legend's two powers, energy and universal power, including zeros", () => {
    const projection = baseRibbonProjection({ runeCount: 12 });
    if (projection.match.stage !== "playing") throw Error("playing required");
    Object.assign(projection.match.resources.players[0]!.runePool.power, { Fury: 4, Mind: 0, Body: 9, any: 2 });
    Object.assign(projection.match.resources.players[1]!.runePool.power, { Body: 1, Chaos: 0, Fury: 8, any: 0 });
    expect(isDuelProjectionV3Actions1(projection)).toBe(true);
    const html = render({ projection });
    const own = poolFor(html, "Alice"), opponent = poolFor(html, "Bob");
    expect(own).toContain("能量：</dt><dd>3");
    expect(own).toContain("炽烈符能：</dt><dd>4");
    expect(own).toContain("灵光符能：</dt><dd>0");
    expect(own).toContain("通用符能：</dt><dd>2");
    expect(own).not.toContain("摧破符能");
    expect(own).not.toContain("翠意符能");
    expect(own).not.toContain("混沌符能");
    expect(own).not.toContain("序理符能");
    expect(opponent).toContain("摧破符能：</dt><dd>1");
    expect(opponent).toContain("混沌符能：</dt><dd>0");
    expect(opponent).not.toContain("炽烈符能");
    expect(count(own, "<dd>")).toBe(4);
    expect(count(opponent, "<dd>")).toBe(4);
  });

  it("keeps public counters accurate for the other seat, spectator and read-only replay", () => {
    for (const viewer of ["alice", "bob", null]) {
      const html = render({ projection: baseRibbonProjection({ viewer }), readOnly: true });
      expect(poolFor(html, "Alice")).toContain("能量：</dt><dd>3");
      expect(poolFor(html, "Bob")).toContain("能量：</dt><dd>2");
      expect(html).not.toContain('class="full-product-duel-action"');
      if (viewer !== "alice") expect(html).not.toContain("alice-hand-1");
      if (viewer !== "bob") expect(html).not.toContain("bob-hand-1");
    }
  });

  it("never guesses Legend domains from the runes or a nonzero pool", () => {
    const html = render({ projection: baseRibbonProjection({ runeCount: 12 }), resolveCardDomains: () => [] });
    const own = poolFor(html, "Alice");
    expect(count(own, "<dd>")).toBe(2);
    expect(own).toContain("通用符能");
    expect(own).not.toContain("炽烈符能");
    expect(html).not.toContain("bob-hand-1");
  });
});
