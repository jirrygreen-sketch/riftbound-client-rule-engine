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
  DuelMatchBoard
} from "../../src/full-product/DuelMatchBoard";
import type { DuelMatchBoardProps } from "../../src/full-product/DuelMatchBoard";

/*
 * Focused contested-table *unit visibility* coverage for the formal Duel
 * surface. The fix being covered is presentational only: the two central
 * battlefields stay side by side, the battlefield art is a compact header
 * thumbnail, and the two controllers' unit groups sit side by side so both
 * single units are on screen together at 1280x800.
 *
 * The projections are genuine P4 DTOs (asserted with the production
 * `isDuelProjectionV3Actions1` guard), built from a tracked wire fixture. They
 * carry both sides' public unit facts — controller, printing/token trait,
 * current damage and readied state — and the assertions pin those against the
 * rendered DOM. No rule, budget, payment or authority value is asserted; a
 * JSDOM/DOM render proves structure, never pixels.
 */

const BASE_ALICE = JSON.stringify(["duel-base", "alice"]);
const BASE_BOB = JSON.stringify(["duel-base", "bob"]);
const FIELD_A = JSON.stringify(["duel-battlefield", "bf-a"]);
const FIELD_B = JSON.stringify(["duel-battlefield", "bf-b"]);

const EMPTY_POWER = { Fury: 0, Calm: 0, Mind: 0, Body: 0, Chaos: 0, Order: 0, any: 0 };

interface UnitSpec {
  readonly objectId: string;
  readonly controllerPlayerId: "alice" | "bob";
  readonly ownerPlayerId?: "alice" | "bob";
  readonly locationId: string;
  readonly cardId?: string;
  readonly token?: { readonly name: string; readonly baseMight: number; readonly tags: readonly string[] };
  readonly readied?: boolean;
  readonly totalDamage?: number;
  readonly damageMarks?: readonly { readonly amount: number; readonly responsiblePlayerId: string }[];
}

interface BuildOptions {
  readonly viewer?: string | null;
  /** Add a real token unit (with its printed base Might) to the contested field. */
  readonly withToken?: boolean;
}

function unitWire(spec: UnitSpec): Record<string, unknown> {
  return {
    objectId: spec.objectId,
    controllerPlayerId: spec.controllerPlayerId,
    locationId: spec.locationId,
    ownerPlayerId: spec.ownerPlayerId ?? spec.controllerPlayerId,
    readied: spec.readied ?? true,
    trait: spec.cardId !== undefined
      ? { kind: "card", cardId: spec.cardId }
      : { kind: "token", name: spec.token!.name, baseMight: spec.token!.baseMight, tags: [...spec.token!.tags] },
    totalDamage: spec.totalDamage ?? 0,
    damageMarks: spec.damageMarks ?? []
  };
}

/**
 * One contested battlefield (`bf-a`) holding exactly one public unit per
 * controller — the real 06a8a0d2 turn-9 corner: A and B each with a single
 * `Vanguard Sergeant` in the same combat. Fields/rosters/legends are otherwise
 * real P4 wire shapes.
 */
function contestedProjection(options: BuildOptions = {}): DuelProjectionV3Actions1 {
  const viewer = options.viewer === undefined ? "alice" : options.viewer;
  const units: UnitSpec[] = [
    {
      objectId: "u-alice-1",
      controllerPlayerId: "alice",
      locationId: FIELD_A,
      cardId: "unit-vanguard-sergeant-a",
      readied: true,
      totalDamage: 0
    },
    {
      objectId: "u-bob-1",
      controllerPlayerId: "bob",
      locationId: FIELD_A,
      cardId: "unit-vanguard-sergeant-b",
      readied: false,
      totalDamage: 2,
      damageMarks: [{ amount: 2, responsiblePlayerId: "alice" }]
    }
  ];
  if (options.withToken) {
    units.push({
      objectId: "u-token-1",
      controllerPlayerId: "alice",
      locationId: FIELD_A,
      token: { name: "幽灵傀儡", baseMight: 3, tags: ["spirit"] },
      readied: true,
      totalDamage: 0
    });
  }
  const occupancy = (locationId: string): string[] =>
    units.filter(unit => unit.locationId === locationId).map(unit => unit.objectId);

  const alicePlayer: Record<string, unknown> = {
    playerId: "alice",
    champion: { cardId: "champ-a" },
    legend: { cardId: "legend-a", controllerPlayerId: "alice", readiness: "ready" },
    handCount: viewer === "alice" ? 1 : 0,
    mainDeckCount: 30,
    trash: []
  };
  const bobPlayer: Record<string, unknown> = {
    playerId: "bob",
    champion: null,
    legend: { cardId: "legend-b", controllerPlayerId: "bob", readiness: "ready" },
    handCount: viewer === "bob" ? 1 : 0,
    mainDeckCount: 30,
    trash: []
  };
  // Only the authenticated viewer ever receives its own real hand array.
  if (viewer === "alice") alicePlayer.hand = [{ uid: "alice-hand-1", cardId: "hand-a" }];
  if (viewer === "bob") bobPlayer.hand = [{ uid: "bob-hand-1", cardId: "hand-b" }];

  const projection = {
    projectionSchema: DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1,
    viewerPlayerId: viewer,
    match: {
      schemaVersion: 3,
      rulesetId: "riftbound-duel",
      matchId: "contested-1",
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
          { locationId: BASE_ALICE, ownerPlayerId: "alice", occupancy: occupancy(BASE_ALICE) },
          { locationId: BASE_BOB, ownerPlayerId: "bob", occupancy: occupancy(BASE_BOB) }
        ],
        battlefields: [
          {
            locationId: FIELD_A,
            instanceId: "bf-a",
            cardId: "field-card-a",
            ownerPlayerId: "alice",
            controllerPlayerId: null,
            contested: true,
            contestingPlayerId: "bob",
            showdown: "active",
            combat: "active",
            occupancy: occupancy(FIELD_A)
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
            occupancy: occupancy(FIELD_B)
          }
        ],
        units: units.map(unitWire),
        gears: []
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
            baseRunes: [
              {
                uid: "alice-rune-1",
                cardId: "rune-fury",
                domain: "Fury",
                readied: true,
                ownerPlayerId: "alice",
                controllerPlayerId: "alice",
                locationId: BASE_ALICE
              }
            ],
            goldTokens: []
          },
          { playerId: "bob", locationId: BASE_BOB, baseRunes: [], goldTokens: [] }
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
  "unit-vanguard-sergeant-a": "先锋军士",
  "unit-vanguard-sergeant-b": "先锋军士"
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
    ...props
  };
  return renderToStaticMarkup(<DuelMatchBoard {...full} />);
}

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

function countClass(html: string, className: string): number {
  return [...html.matchAll(new RegExp(`class="(?:[^"]* )?${className}(?= |")`, "g"))].length;
}

/** The rendered battlefield section for one instance id. */
function battlefieldSection(html: string, instanceId: string): string {
  const start = html.indexOf(`data-instance-id="${instanceId}"`);
  expect(start, instanceId).toBeGreaterThanOrEqual(0);
  const next = html.indexOf('data-instance-id="', start + 1);
  return html.slice(start, next === -1 ? html.length : next);
}

describe("contested battlefield unit visibility", () => {
  it("renders both controllers' single units on the same field with public facts", () => {
    const html = render({ projection: contestedProjection({ viewer: "alice" }) });
    const field = battlefieldSection(html, "bf-a");

    // Both unit chips are present in the one contested field.
    expect(countClass(field, "full-product-duel-unit")).toBe(2);
    expect(field).toContain('data-object-id="u-alice-1"');
    expect(field).toContain('data-object-id="u-bob-1"');

    // Controller grouping is real: one left/right group per controller, ordered
    // opponent (bob) first, then the viewer (alice), exactly as the base bands.
    const groupControllers = [...field.matchAll(/data-slot="unit-group"[^>]*data-controller-player-id="([^"]+)"/g)]
      .map(match => match[1]);
    expect(groupControllers).toEqual(["bob", "alice"]);
    const bobAt = field.indexOf('aria-label="Bob 单位"');
    const aliceAt = field.indexOf('aria-label="Alice 单位"');
    expect(bobAt).toBeGreaterThanOrEqual(0);
    expect(aliceAt).toBeGreaterThan(bobAt);

    // Public unit facts straight from the wire: label, readied/exhausted and the
    // current damage total (not a fabricated current Might).
    expect(field).toContain("先锋军士");
    expect(field).toContain("横置");
    expect(field).toContain("伤害 2");
    // Owner AND controller survive as data even though the visual grouping
    // follows the current controller.
    expect(field).toContain('data-owner-player-id="bob"');
    expect(field).toContain('data-controller-player-id="bob"');
  });

  it("keeps the second controller's group reachable (no hidden/clipped group)", () => {
    const html = render({ projection: contestedProjection({ viewer: "alice" }) });
    const field = battlefieldSection(html, "bf-a");
    // The field renders two groups; neither is dropped to make the frame "fit".
    expect(count(field, 'data-slot="unit-group"')).toBe(2);
    expect(count(field, 'data-slot="unit-groups"')).toBe(1);
    // Both groups live in the single unit-groups container (side-by-side row).
    const groupsStart = field.indexOf('data-slot="unit-groups"');
    const firstGroup = field.indexOf('data-slot="unit-group"', groupsStart);
    const secondGroup = field.indexOf('data-slot="unit-group"', firstGroup + 1);
    expect(groupsStart).toBeGreaterThanOrEqual(0);
    expect(firstGroup).toBeGreaterThan(groupsStart);
    expect(secondGroup).toBeGreaterThan(firstGroup);
  });

  it("shows the same both-controller grouping for the opposing seated viewer", () => {
    const html = render({ projection: contestedProjection({ viewer: "bob" }) });
    const field = battlefieldSection(html, "bf-a");
    // Mirror image: alice (opponent) reads above bob (viewer), still both present.
    const groupControllers = [...field.matchAll(/data-slot="unit-group"[^>]*data-controller-player-id="([^"]+)"/g)]
      .map(match => match[1]);
    expect(groupControllers).toEqual(["alice", "bob"]);
    expect(countClass(field, "full-product-duel-unit")).toBe(2);
  });

  it("keeps the battlefield art a compact clickable header thumbnail, not a banner", () => {
    const html = render({ projection: contestedProjection({ viewer: "alice" }) });
    const field = battlefieldSection(html, "bf-a");
    // The landscape face is still a real clickable inspect control...
    expect(field).toContain('class="full-product-duel-card-button"');
    expect(field).toContain("查看大图：迷雾峡谷");
    expect(field).toContain('class="full-product-duel-battlefield-thumb"');
    expect(count(field, 'data-card-role="landscape"')).toBe(2);
    // ...and it sits inside the (now compact) head, ahead of the unit groups.
    const head = field.indexOf("full-product-duel-battlefield-head");
    const thumb = field.indexOf("full-product-duel-battlefield-thumb");
    const unitGroups = field.indexOf('data-slot="unit-groups"');
    expect(head).toBeGreaterThanOrEqual(0);
    expect(thumb).toBeGreaterThan(head);
    expect(unitGroups).toBeGreaterThan(thumb);
  });

  it("still renders both central fields side by side and keeps the token might label", () => {
    const html = render({ projection: contestedProjection({ viewer: "alice" }) });
    expect(count(html, 'class="full-product-duel-fields"')).toBe(1);
    expect(countClass(html, "full-product-duel-battlefield")).toBe(2);
    // A real token's printed Might is shown as base Might (never a derived value).
    const tokenHtml = render({
      projection: contestedProjection({ viewer: "alice", withToken: true })
    });
    expect(tokenHtml).toContain(`${DUEL_BASE_MIGHT_LABEL} 3`);
  });
});

describe("contested battlefield unit visibility (CSS contract)", () => {
  const boardCss = readFileSync(
    fileURLToPath(new URL("../../src/full-product/DuelMatchBoard.css", import.meta.url)),
    "utf8"
  );

  it("lays the two controller groups out as a horizontal row with internal scroll", () => {
    // The unit-groups container is a row, and a crowded group scrolls sideways
    // instead of stacking into a tall clipped column.
    expect(boardCss).toMatch(/\.full-product-duel-unit-groups\s*\{[^}]*flex-direction:\s*row/);
    expect(boardCss).toMatch(/\.full-product-duel-unit-list\s*\{[^}]*flex-wrap:\s*nowrap/);
    expect(boardCss).toMatch(/\.full-product-duel-unit-list\s*\{[^}]*overflow-x:\s*auto/);
  });

  it("sizes the battlefield art as a small height-bounded header thumbnail", () => {
    expect(boardCss).toMatch(/--duel-battlefield-thumb-height:\s*min\(/);
    expect(boardCss).toMatch(
      /\.full-product-duel-battlefield-thumb,[\s\S]*?\{[^}]*height:\s*var\(--duel-battlefield-thumb-height\)/
    );
    // The compact head keeps name/tags as a text column beside the thumbnail.
    expect(boardCss).toMatch(/\.full-product-duel-battlefield-head\s*\{[^}]*flex-direction:\s*row/);
    expect(boardCss).toContain(".full-product-duel-battlefield-head-main");
  });

  it("keeps every face whole (contain, real ratio) and never crops a rune", () => {
    expect(boardCss).not.toContain("object-fit: cover");
    expect(boardCss).toMatch(/\.full-product-duel-baserune-thumb[\s\S]*?\{[^}]*height:\s*var\(--duel-baserune-face-height\)/);
    expect(boardCss).toMatch(/--duel-baserune-face-height:\s*min\(/);
  });
});
