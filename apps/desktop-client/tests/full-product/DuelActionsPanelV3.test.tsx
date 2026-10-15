import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import {
  DUEL_ACTIONS_ALLOCATION_BUDGET_LABEL,
  DUEL_ACTIONS_ALLOCATION_INVALID_TARGET,
  DUEL_ACTIONS_ALLOCATION_NEED_TARGET,
  DUEL_ACTIONS_ALLOCATION_OVER_BUDGET,
  DUEL_ACTIONS_CHOICE_NEED_SELECTION,
  DUEL_ACTIONS_CHOICE_UNAVAILABLE_NOTICE,
  DUEL_ACTIONS_DISCONNECTED_NOTICE,
  DUEL_ACTIONS_ENDED_NOTICE,
  DUEL_ACTIONS_LEGACY_NOTE,
  DUEL_ACTIONS_MOVE_NEED_DEST,
  DUEL_ACTIONS_MOVE_NEED_UNIT,
  DUEL_ACTIONS_MOVE_UNIT_NOT_ELIGIBLE,
  DUEL_ACTIONS_MOVE_UNIT_FALLBACK_PREFIX,
  DUEL_ACTIONS_BASE_LABEL,
  DUEL_ACTIONS_OPPONENT_BASE_LABEL,
  DUEL_ACTIONS_BATTLEFIELD_LABEL,
  DUEL_ACTIONS_PROMPT_KIND_LABELS,
  DUEL_ACTIONS_PROMPT_TITLE_PREFIX,
  DUEL_ACTIONS_NO_ACTIONS_NOTICE,
  DUEL_ACTIONS_NO_OPTIONS_NOTICE,
  DUEL_ACTIONS_PANEL_LABEL,
  DUEL_ACTIONS_PENDING_NOTICE,
  DUEL_ACTIONS_PROJECTION_INVALID_NOTICE,
  DUEL_ACTIONS_RECONNECTING_NOTICE,
  DUEL_ACTIONS_SPECTATOR_NOTICE,
  DUEL_ACTIONS_SUBMIT_LABEL_PREFIX,
  DUEL_ACTIONS_WAITING_CHOICE_NOTICE,
  DuelActionsPanelV3,
  EMPTY_DUEL_ACTIONS_SELECTION,
  actionDisabledReason,
  buildDuelCommand,
  buildDuelCommandPacket,
  duelActionsGateReason,
  duelActionsSceneSignature,
  duelLocationLabelById,
  duelPromptTitle,
  duelUnitDisplayLabel,
  duelUnitLabelById,
  isLegacyAction,
  resolveDuelActionIssue,
  selectionAfterSceneChange,
  submitDuelActionSelection
} from "../../src/full-product/components/DuelActionsPanelV3";
import type {
  DuelActionsGateState,
  DuelActionsSelection,
  DuelActionsPanelV3Props
} from "../../src/full-product/components/DuelActionsPanelV3";
import {
  DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
  isDuelCommandMessageV3Actions1,
  isDuelProjectionV3Actions1
} from "@riftbound/protocol";
import type {
  DuelActionV3Actions1,
  DuelPendingChoiceV3Actions1,
  DuelProjectionV3Actions1,
  DuelWireChoicePromptV3Actions1,
  DuelWireUnit
} from "@riftbound/protocol";

const ALICE_BASE = JSON.stringify(["duel-base", "alice"]);
const BOB_BASE = JSON.stringify(["duel-base", "bob"]);
const FIELD_A = JSON.stringify(["duel-battlefield", "bf-a"]);
const FIELD_B = JSON.stringify(["duel-battlefield", "bf-b"]);

const EMPTY_POOL = { energy: 0, power: { Fury: 0, Calm: 0, Mind: 0, Body: 0, Chaos: 0, Order: 0, any: 0 } };

interface UnitFixture {
  readonly objectId: string;
  readonly controllerPlayerId: string;
  readonly ownerPlayerId: string;
  readonly locationId: string;
  /** Token name, when the unit is a token. Defaults to the object id. */
  readonly tokenName?: string;
  /** Printing card id, which makes the unit a *card* unit instead of a token. */
  readonly cardId?: string;
}

function unitFixture(
  objectId: string,
  controllerPlayerId: string,
  locationId: string,
  ownerPlayerId = controllerPlayerId,
  extras: { readonly tokenName?: string; readonly cardId?: string } = {}
): UnitFixture {
  return { objectId, controllerPlayerId, ownerPlayerId, locationId, ...extras };
}

function unitWire(unit: UnitFixture): Record<string, unknown> {
  return {
    objectId: unit.objectId,
    controllerPlayerId: unit.controllerPlayerId,
    locationId: unit.locationId,
    ownerPlayerId: unit.ownerPlayerId,
    readied: true,
    trait: unit.cardId === undefined
      ? { kind: "token", name: unit.tokenName ?? unit.objectId, baseMight: 2, tags: [] }
      : { kind: "card", cardId: unit.cardId },
    totalDamage: 0,
    damageMarks: []
  };
}

interface FixtureOptions {
  readonly viewer?: string | null;
  readonly stateVersion?: number;
  readonly matchId?: string;
  readonly phase?: string;
  readonly turnNumber?: number;
  readonly priorityPlayerId?: string | null;
  readonly chain?: unknown;
  readonly pendingChoice?: DuelPendingChoiceV3Actions1;
  readonly actions?: readonly DuelActionV3Actions1[];
  readonly units?: readonly UnitFixture[];
  readonly baseRunes?: readonly { readonly uid: string }[];
  readonly resources?: unknown;
  readonly schemaVersionOverride?: number;
  /** Battlefield location ids to mark contested (so a foreign unit may legally sit there). */
  readonly contestedFields?: readonly string[];
}

/**
 * Build a projection that genuinely satisfies `isDuelProjectionV3Actions1`, so
 * every panel test renders against a real, guard-passing P4 projection rather
 * than a shape the panel silently rejects.
 */
function makeProjection(options: FixtureOptions = {}): DuelProjectionV3Actions1 {
  const viewer = options.viewer === undefined ? "alice" : options.viewer;
  const stateVersion = options.stateVersion ?? 7;
  const turnNumber = options.turnNumber ?? 1;
  const units = options.units ?? [];
  const occupancy = (locationId: string) =>
    units.filter(unit => unit.locationId === locationId).map(unit => unit.objectId);

  const alicePlayer: Record<string, unknown> = {
    playerId: "alice",
    champion: { cardId: "champ-a" },
    legend: { cardId: "legend-a", controllerPlayerId: "alice", readiness: "ready" },
    handCount: 0,
    mainDeckCount: 30,
    trash: []
  };
  const bobPlayer: Record<string, unknown> = {
    playerId: "bob",
    champion: null,
    legend: { cardId: "legend-b", controllerPlayerId: "bob", readiness: "ready" },
    handCount: 0,
    mainDeckCount: 30,
    trash: []
  };
  // The viewer sees their own (empty) hand as a real array; others get no `hand` key.
  if (viewer === "alice") alicePlayer.hand = [];
  if (viewer === "bob") bobPlayer.hand = [];

  const board = {
    bases: [
      { locationId: ALICE_BASE, ownerPlayerId: "alice", occupancy: occupancy(ALICE_BASE) },
      { locationId: BOB_BASE, ownerPlayerId: "bob", occupancy: occupancy(BOB_BASE) }
    ],
    battlefields: [
      {
        locationId: FIELD_A,
        instanceId: "bf-a",
        cardId: "bf-card-a",
        ownerPlayerId: "alice",
        controllerPlayerId: null,
        contested: (options.contestedFields ?? []).includes(FIELD_A),
        contestingPlayerId: (options.contestedFields ?? []).includes(FIELD_A) ? "alice" : null,
        showdown: "none",
        combat: "none",
        occupancy: occupancy(FIELD_A)
      },
      {
        locationId: FIELD_B,
        instanceId: "bf-b",
        cardId: "bf-card-b",
        ownerPlayerId: "bob",
        controllerPlayerId: null,
        contested: (options.contestedFields ?? []).includes(FIELD_B),
        contestingPlayerId: (options.contestedFields ?? []).includes(FIELD_B) ? "bob" : null,
        showdown: "none",
        combat: "none",
        occupancy: occupancy(FIELD_B)
      }
    ],
    units: units.map(unitWire),
    gears: []
  };

  const baseRunes = (options.baseRunes ?? []).map(rune => ({
    uid: rune.uid,
    cardId: "rune-card-1",
    domain: "Fury",
    readied: true,
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    locationId: ALICE_BASE
  }));

  const resources = options.resources ?? {
    players: [
      { playerId: "alice", runePool: { ...EMPTY_POOL, power: { ...EMPTY_POOL.power } }, runeDeckCount: 8 },
      { playerId: "bob", runePool: { ...EMPTY_POOL, power: { ...EMPTY_POOL.power } }, runeDeckCount: 8 }
    ],
    bases: [
      { playerId: "alice", locationId: ALICE_BASE, baseRunes, goldTokens: [] },
      { playerId: "bob", locationId: BOB_BASE, baseRunes: [], goldTokens: [] }
    ]
  };

  const frame = {
    phase: options.phase ?? "main",
    turnNumber,
    turnPlayerId: "alice",
    priorityPlayerId: options.priorityPlayerId === undefined ? "alice" : options.priorityPlayerId,
    focusPlayerId: null,
    stateOpen: true,
    pendingPayment: null,
    chain: options.chain ?? { active: false },
    pendingChoice: options.pendingChoice ?? null,
    execution: { status: "ready" }
  };

  return {
    projectionSchema: "riftbound-duel-v3-actions-1",
    viewerPlayerId: viewer,
    match: {
      schemaVersion: 3,
      rulesetId: "riftbound-duel",
      matchId: options.matchId ?? "match-1",
      dataVersion: "dv-1",
      catalogDigest: "cd-1",
      stateVersion,
      eventSeq: 3,
      roster: [
        { playerId: "alice", displayName: "Alice" },
        { playerId: "bob", displayName: "Bob" }
      ],
      turnOrder: ["alice", "bob"],
      stage: "playing",
      players: [alicePlayer, bobPlayer],
      board,
      resources,
      scoring: {
        playerIds: ["alice", "bob"],
        battlefieldLocationIds: [FIELD_A, FIELD_B],
        victoryScore: 8,
        turnNumber: 1,
        players: [
          { playerId: "alice", points: 0, scoredBattlefieldLocationIds: [] },
          { playerId: "bob", points: 0, scoredBattlefieldLocationIds: [] }
        ]
      },
      frame
    },
    actions: options.actions ?? []
  } as unknown as DuelProjectionV3Actions1;
}

const playAction: DuelActionV3Actions1 = {
  id: "act-play",
  kind: "play-card",
  label: "打出卡牌",
  enabled: true,
  cardUID: "card-1",
  windowId: "window-main"
};

function openGate(): DuelActionsGateState {
  return { connectionStatus: "connected", commandPending: false, projectionValid: true, ended: false };
}

function render(props: Partial<DuelActionsPanelV3Props> & { projection: DuelProjectionV3Actions1 }): string {
  const full: DuelActionsPanelV3Props = {
    connectionStatus: "connected",
    commandPending: false,
    onCommand: () => {},
    ...props
  };
  return renderToStaticMarkup(<DuelActionsPanelV3 {...full} />);
}

function buttonTag(html: string, ariaLabel: string): string {
  const index = html.indexOf(`aria-label="${ariaLabel}"`);
  expect(index, `button ${ariaLabel} not found`).toBeGreaterThanOrEqual(0);
  const open = html.lastIndexOf("<button", index);
  const close = html.indexOf(">", index);
  return html.slice(open, close + 1);
}

describe("DuelActionsPanelV3 fixtures", () => {
  it("builds projections that pass the real P4 guard", () => {
    expect(isDuelProjectionV3Actions1(makeProjection())).toBe(true);
    expect(
      isDuelProjectionV3Actions1(
        makeProjection({
          actions: [playAction],
          units: [unitFixture("unit-a", "alice", ALICE_BASE)]
        })
      )
    ).toBe(true);
  });
});

describe("DuelActionsPanelV3 rendering", () => {
  it("renders a server-enabled action as an enabled button and never invents extra buttons", () => {
    const html = render({ projection: makeProjection({ actions: [playAction] }) });
    expect(html).toContain(DUEL_ACTIONS_PANEL_LABEL);
    expect(html).toContain("打出卡牌");
    expect(buttonTag(html, "打出卡牌")).not.toContain("disabled");
    // Exactly one action button, no fabricated +/- or generic command box.
    expect(html.split('class="full-product-duel-actions-action"').length - 1).toBe(1);
    expect(html).not.toContain('type="number"');
  });

  it("shows a disabled action with its server reason and keeps the button disabled", () => {
    const disabled: DuelActionV3Actions1 = {
      id: "act-play",
      kind: "play-card",
      label: "打出卡牌",
      enabled: false,
      reason: "资源不足",
      cardUID: "card-1",
      windowId: "window-main"
    };
    const html = render({ projection: makeProjection({ actions: [disabled] }) });
    expect(html).toContain("资源不足");
    expect(buttonTag(html, "打出卡牌")).toContain("disabled");
  });

  it("renders the empty notice when the server supplied no actions", () => {
    const html = render({ projection: makeProjection({ actions: [] }) });
    expect(html).toContain(DUEL_ACTIONS_NO_ACTIONS_NOTICE);
    expect(html.split('class="full-product-duel-actions-action"').length - 1).toBe(0);
  });

  it("hides every action and shows a waiting notice to a spectator", () => {
    const html = render({ projection: makeProjection({ viewer: null, actions: [] }) });
    expect(html).toContain(DUEL_ACTIONS_SPECTATOR_NOTICE);
    expect(html.split('class="full-product-duel-actions-action"').length - 1).toBe(0);
  });

  it("fails closed on a malformed projection", () => {
    const malformed = { projectionSchema: "riftbound-duel-v2-actions-1", viewerPlayerId: "alice", match: {}, actions: [] };
    const html = render({ projection: malformed as unknown as DuelProjectionV3Actions1 });
    expect(html).toContain(DUEL_ACTIONS_PROJECTION_INVALID_NOTICE);
  });

  it("keeps the five legacy resource actions inert and separate", () => {
    const legacy: DuelActionV3Actions1 = {
      id: "legacy-rune",
      kind: "rune-energy",
      label: "横置符文 +1 能量",
      enabled: true,
      uid: "rune-1"
    };
    const html = render({
      projection: makeProjection({ actions: [legacy, playAction], baseRunes: [{ uid: "rune-1" }] })
    });
    expect(html).toContain(DUEL_ACTIONS_LEGACY_NOTE);
    expect(html).toContain("横置符文 +1 能量");
    // The legacy action is a chip, not a clickable action button.
    expect(html.split('class="full-product-duel-actions-action"').length - 1).toBe(1);
    expect(html).toContain("rune-energy");
  });
});

describe("DuelActionsPanelV3 gating", () => {
  const action = [playAction];

  it("disables every action while disconnected, reconnecting or pending", () => {
    const cases: Array<{ label: string; props: Partial<DuelActionsPanelV3Props>; reason: string }> = [
      { label: "disconnected", props: { connectionStatus: "disconnected" }, reason: DUEL_ACTIONS_DISCONNECTED_NOTICE },
      { label: "reconnecting", props: { connectionStatus: "reconnecting" }, reason: DUEL_ACTIONS_RECONNECTING_NOTICE },
      { label: "pending", props: { commandPending: true }, reason: DUEL_ACTIONS_PENDING_NOTICE }
    ];
    for (const testCase of cases) {
      const html = render({ projection: makeProjection({ actions: action }), ...testCase.props });
      expect(html, testCase.label).toContain(testCase.reason);
      expect(buttonTag(html, "打出卡牌"), testCase.label).toContain("disabled");
    }
  });

  it("treats an ended match as ended but fails closed if it still carries actions", () => {
    // A conforming ended projection carries no actions; the gate reports ended and
    // every entry (here: none) stays inert.
    const ended = render({ projection: makeProjection({ actions: [], phase: "ended" }) });
    expect(ended).toContain(DUEL_ACTIONS_ENDED_NOTICE);
    expect(ended.split('class="full-product-duel-actions-action"').length - 1).toBe(0);
    // If a malformed projection mixes ended + actions the real P4 guard rejects it.
    const invalid = render({ projection: makeProjection({ actions: action, phase: "ended" }) });
    expect(invalid).toContain(DUEL_ACTIONS_PROJECTION_INVALID_NOTICE);
  });

  it("disables a choiceId action when the owner choice cannot be matched", () => {
    const choiceAction: DuelActionV3Actions1 = {
      id: "act-choice",
      kind: "answer-pending-choice",
      label: "选择效果",
      enabled: true,
      choiceId: "choice-1"
    };
    const html = render({
      projection: makeProjection({ actions: [choiceAction], pendingChoice: { active: true } })
    });
    expect(html).toContain(DUEL_ACTIONS_WAITING_CHOICE_NOTICE);
    expect(html).toContain(DUEL_ACTIONS_CHOICE_UNAVAILABLE_NOTICE);
    expect(buttonTag(html, "选择效果")).toContain("disabled");
  });

  it("gates a choice action through the pure gate helper", () => {
    const choiceAction: DuelActionV3Actions1 = {
      id: "act-choice",
      kind: "answer-pending-choice",
      label: "选择效果",
      enabled: true,
      choiceId: "choice-1"
    };
    expect(actionDisabledReason(choiceAction, openGate(), null)).toBe(DUEL_ACTIONS_CHOICE_UNAVAILABLE_NOTICE);
    expect(
      actionDisabledReason(choiceAction, openGate(), { active: true })
    ).toBe(DUEL_ACTIONS_CHOICE_UNAVAILABLE_NOTICE);
  });
});

describe("DuelActionsPanelV3 move selection", () => {
  const moveAction: DuelActionV3Actions1 = {
    id: "act-move",
    kind: "standard-move",
    label: "移动单位",
    enabled: true,
    windowId: "window-move",
    selectableUnitUIDs: ["unit-a"],
    destinations: [
      { locationId: ALICE_BASE, eligibleUnitUIDs: ["unit-a"] },
      { locationId: FIELD_A, eligibleUnitUIDs: ["unit-a"] }
    ]
  };
  const projection = makeProjection({
    actions: [moveAction],
    units: [unitFixture("unit-a", "alice", ALICE_BASE)]
  });

  it("renders the server-provided unit and destination tokens once the action is selected", () => {
    const html = render({
      projection,
      initialSelection: { ...EMPTY_DUEL_ACTIONS_SELECTION, actionId: "act-move" }
    });
    expect(html).toContain("unit-a");
    expect(html).toContain("选择要移动的单位");
    expect(html).toContain("选择目的地");
  });

  it("refuses to submit without a unit or destination and reports the missing step", () => {
    const noUnit = resolveDuelActionIssue(moveAction, EMPTY_DUEL_ACTIONS_SELECTION, null, openGate());
    expect(noUnit).toBe(DUEL_ACTIONS_MOVE_NEED_UNIT);

    const unitOnly = resolveDuelActionIssue(
      moveAction,
      { ...EMPTY_DUEL_ACTIONS_SELECTION, moveUnitUIDs: ["unit-a"] },
      null,
      openGate()
    );
    expect(unitOnly).toBe(DUEL_ACTIONS_MOVE_NEED_DEST);
  });

  it("refuses a destination the server did not offer and rejects unknown units", () => {
    // BOB_BASE is a real board location but is absent from the server destination list.
    const unoffered = resolveDuelActionIssue(
      moveAction,
      { ...EMPTY_DUEL_ACTIONS_SELECTION, moveUnitUIDs: ["unit-a"], moveDestinationLocationId: BOB_BASE },
      null,
      openGate()
    );
    expect(unoffered).toBe(DUEL_ACTIONS_MOVE_NEED_DEST);
    // A destination that lists a different unit cannot accept the chosen unit.
    const restricted: DuelActionV3Actions1 = {
      ...moveAction,
      destinations: [
        { locationId: ALICE_BASE, eligibleUnitUIDs: ["unit-a"] },
        { locationId: FIELD_A, eligibleUnitUIDs: ["unit-z"] }
      ]
    };
    expect(
      resolveDuelActionIssue(
        restricted,
        { ...EMPTY_DUEL_ACTIONS_SELECTION, moveUnitUIDs: ["unit-a"], moveDestinationLocationId: FIELD_A },
        null,
        openGate()
      )
    ).toBe(DUEL_ACTIONS_MOVE_UNIT_NOT_ELIGIBLE);
    // An unknown unit is blocked by the gate (the builder only enforces the
    // opaque command shape; target legality stays a server re-verification).
    expect(
      resolveDuelActionIssue(
        moveAction,
        { ...EMPTY_DUEL_ACTIONS_SELECTION, moveUnitUIDs: ["unit-x"], moveDestinationLocationId: FIELD_A },
        null,
        openGate()
      )
    ).toBe(DUEL_ACTIONS_MOVE_UNIT_NOT_ELIGIBLE);
  });

  it("builds a contract-valid standard-move command from server IDs only", () => {
    const selection: DuelActionsSelection = {
      ...EMPTY_DUEL_ACTIONS_SELECTION,
      actionId: "act-move",
      moveUnitUIDs: ["unit-a"],
      moveDestinationLocationId: FIELD_A
    };
    const packet = buildDuelCommandPacket(moveAction, selection, null, {
      expectedVersion: 7,
      ids: { requestId: "req-1", commandId: "cmd-1" }
    });
    expect(packet).not.toBeNull();
    expect(packet?.expectedVersion).toBe(7);
    expect(packet?.commandProfile).toBe(DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1);
    expect(packet?.command).toEqual({
      type: "standard-move",
      windowId: "window-move",
      unitUIDs: ["unit-a"],
      destinationLocationId: FIELD_A
    });
    expect(isDuelCommandMessageV3Actions1(packet)).toBe(true);
  });
});

describe("DuelActionsPanelV3 typed choice prompts", () => {
  const choiceAction: DuelActionV3Actions1 = {
    id: "act-choice",
    kind: "answer-pending-choice",
    label: "选择效果",
    enabled: true,
    choiceId: "choice-1"
  };
  const pendingChoice: DuelPendingChoiceV3Actions1 = {
    active: true,
    choiceId: "choice-1",
    kind: "play-choices",
    prompts: [
      {
        promptId: "p1",
        kind: "mode",
        minSelections: 1,
        maxSelections: 1,
        options: [
          { id: "o1", label: "选项一" },
          { id: "o2", label: "选项二" }
        ]
      }
    ]
  };
  const projection = makeProjection({ actions: [choiceAction], pendingChoice });

  it("renders the server option labels and keeps submit disabled until the minimum is met", () => {
    const html = render({
      projection,
      initialSelection: { ...EMPTY_DUEL_ACTIONS_SELECTION, actionId: "act-choice" }
    });
    expect(html).toContain("选项一");
    expect(html).toContain("选项二");
    expect(html).toContain(DUEL_ACTIONS_CHOICE_NEED_SELECTION);
    expect(buttonTag(html, `${DUEL_ACTIONS_SUBMIT_LABEL_PREFIX}选择效果`)).toContain("disabled");
  });

  it("builds answers from the selected server options and clears the submit gate", () => {
    const selection: DuelActionsSelection = {
      ...EMPTY_DUEL_ACTIONS_SELECTION,
      actionId: "act-choice",
      choiceOptionIds: { p1: ["o2"] }
    };
    expect(resolveDuelActionIssue(choiceAction, selection, pendingChoice, openGate())).toBeNull();
    const packet = buildDuelCommandPacket(choiceAction, selection, pendingChoice, {
      expectedVersion: 7,
      ids: { requestId: "req-2", commandId: "cmd-2" }
    });
    expect(packet?.command).toEqual({
      type: "answer-pending-choice",
      choiceId: "choice-1",
      answers: [{ promptId: "p1", optionIds: ["o2"] }]
    });
    expect(isDuelCommandMessageV3Actions1(packet)).toBe(true);
  });

  it("requires a selection on every prompt before a multi-prompt choice may submit", () => {
    const twoPrompts: DuelPendingChoiceV3Actions1 = {
      active: true,
      choiceId: "choice-1",
      kind: "effect-choices",
      prompts: [
        { promptId: "p1", kind: "mode", minSelections: 1, maxSelections: 1, options: [{ id: "o1", label: "甲" }] },
        { promptId: "p2", kind: "target", minSelections: 1, maxSelections: 1, options: [{ id: "o2", label: "乙" }] }
      ]
    };
    // One answered, one not: still blocked.
    expect(
      resolveDuelActionIssue(
        choiceAction,
        { ...EMPTY_DUEL_ACTIONS_SELECTION, actionId: "act-choice", choiceOptionIds: { p1: ["o1"] } },
        twoPrompts,
        openGate()
      )
    ).toBe(DUEL_ACTIONS_CHOICE_NEED_SELECTION);
    // Both answered: allowed, and the answers keep the server prompt order.
    const selection: DuelActionsSelection = {
      ...EMPTY_DUEL_ACTIONS_SELECTION,
      actionId: "act-choice",
      choiceOptionIds: { p2: ["o2"], p1: ["o1"] }
    };
    expect(resolveDuelActionIssue(choiceAction, selection, twoPrompts, openGate())).toBeNull();
    expect(buildDuelCommand(choiceAction, selection, twoPrompts)).toEqual({
      type: "answer-pending-choice",
      choiceId: "choice-1",
      answers: [
        { promptId: "p1", optionIds: ["o1"] },
        { promptId: "p2", optionIds: ["o2"] }
      ]
    });
  });

  it("exposes a no-options notice for a prompt the server left empty", () => {
    expect(DUEL_ACTIONS_NO_OPTIONS_NOTICE).toContain("暂无");
  });
});

describe("DuelActionsPanelV3 combat allocation", () => {
  const combatAction: DuelActionV3Actions1 = {
    id: "act-combat",
    kind: "assign-combat-damage",
    label: "分配战斗伤害",
    enabled: true,
    choiceId: "combat-1"
  };
  const pendingChoice: DuelPendingChoiceV3Actions1 = {
    active: true,
    choiceId: "combat-1",
    kind: "combat-allocation",
    fieldLocationId: FIELD_A,
    side: "attacker",
    budget: 3,
    targets: [{ unitObjectId: "unit-b", lethalNeed: 2 }]
  };
  const projection = makeProjection({
    actions: [combatAction],
    pendingChoice,
    units: [unitFixture("unit-b", "bob", FIELD_A)],
    contestedFields: [FIELD_A]
  });

  it("renders the server budget and target tokens without computing any damage", () => {
    const html = render({
      projection,
      initialSelection: { ...EMPTY_DUEL_ACTIONS_SELECTION, actionId: "act-combat" }
    });
    expect(html).toContain(`${DUEL_ACTIONS_ALLOCATION_BUDGET_LABEL}：3`);
    expect(html).toContain("unit-b");
    expect(html).toContain("致死需求 2");
  });

  it("refuses submit while nothing is allocated, over budget, or on an unknown target", () => {
    expect(resolveDuelActionIssue(combatAction, EMPTY_DUEL_ACTIONS_SELECTION, pendingChoice, openGate())).toBe(
      DUEL_ACTIONS_ALLOCATION_NEED_TARGET
    );
    expect(
      resolveDuelActionIssue(
        combatAction,
        { ...EMPTY_DUEL_ACTIONS_SELECTION, allocationAmounts: { "unit-b": 4 } },
        pendingChoice,
        openGate()
      )
    ).toBe(DUEL_ACTIONS_ALLOCATION_OVER_BUDGET);
    expect(
      resolveDuelActionIssue(
        combatAction,
        { ...EMPTY_DUEL_ACTIONS_SELECTION, allocationAmounts: { "unit-x": 1 } },
        pendingChoice,
        openGate()
      )
    ).toBe(DUEL_ACTIONS_ALLOCATION_INVALID_TARGET);
  });

  it("builds assignments from user-entered amounts without deriving any damage", () => {
    const selection: DuelActionsSelection = {
      ...EMPTY_DUEL_ACTIONS_SELECTION,
      actionId: "act-combat",
      allocationAmounts: { "unit-b": 2 }
    };
    expect(resolveDuelActionIssue(combatAction, selection, pendingChoice, openGate())).toBeNull();
    const packet = buildDuelCommandPacket(combatAction, selection, pendingChoice, {
      expectedVersion: 7,
      ids: { requestId: "req-3", commandId: "cmd-3" }
    });
    expect(packet?.command).toEqual({
      type: "assign-combat-damage",
      choiceId: "combat-1",
      assignments: [{ unitObjectId: "unit-b", amount: 2 }]
    });
    expect(isDuelCommandMessageV3Actions1(packet)).toBe(true);
  });
});

describe("DuelActionsPanelV3 submit boundary", () => {
  const projection = makeProjection({ actions: [playAction] });

  it("returns exactly one guarded packet and forwards it once", () => {
    const received: unknown[] = [];
    const args = {
      action: playAction,
      selection: { ...EMPTY_DUEL_ACTIONS_SELECTION, actionId: "act-play" },
      pendingChoice: null as DuelPendingChoiceV3Actions1,
      gate: openGate(),
      expectedVersion: projection.match.stateVersion,
      ids: { requestId: "req-x", commandId: "cmd-x" }
    };
    const packet = submitDuelActionSelection(args);
    expect(packet).not.toBeNull();
    expect(packet?.command).toEqual({ type: "play-card", cardUID: "card-1", windowId: "window-main" });
    expect(packet?.expectedVersion).toBe(7);
    received.push(packet);
    expect(received.length).toBe(1);
  });

  it("refuses to build a packet while gated", () => {
    const blocked = submitDuelActionSelection({
      action: playAction,
      selection: { ...EMPTY_DUEL_ACTIONS_SELECTION, actionId: "act-play" },
      pendingChoice: null,
      gate: { ...openGate(), commandPending: true },
      expectedVersion: 7,
      ids: { requestId: "req-y", commandId: "cmd-y" }
    });
    expect(blocked).toBeNull();
  });

  it("never emits state/proof/authority keys and never mutates the projection", () => {
    const before = JSON.stringify(projection);
    const packet = buildDuelCommandPacket(
      playAction,
      { ...EMPTY_DUEL_ACTIONS_SELECTION, actionId: "act-play" },
      null,
      { expectedVersion: 7, ids: { requestId: "req-z", commandId: "cmd-z" } }
    );
    expect(packet).not.toBeNull();
    const keys = Object.keys(packet!.command);
    for (const forbidden of ["might", "damage", "cost", "authority", "actor", "delta", "proof", "state"]) {
      expect(keys, forbidden).not.toContain(forbidden);
    }
    expect(JSON.stringify(projection)).toBe(before);
  });

  it("the P4 command guard rejects a tampered packet", () => {
    const tampered = {
      type: "duel-command",
      commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
      requestId: "req",
      commandId: "cmd",
      expectedVersion: 7,
      command: { type: "play-card", cardUID: "card-1", windowId: "window-main", might: 5 }
    };
    expect(isDuelCommandMessageV3Actions1(tampered)).toBe(false);
  });
});

describe("DuelActionsPanelV3 scene reset", () => {
  it("changes the scene signature on match id, version, viewer, choice or connection change", () => {
    const base = duelActionsSceneSignature(makeProjection(), "connected");
    expect(duelActionsSceneSignature(makeProjection({ stateVersion: 8 }), "connected")).not.toBe(base);
    expect(duelActionsSceneSignature(makeProjection({ matchId: "match-2" }), "connected")).not.toBe(base);
    expect(duelActionsSceneSignature(makeProjection({ viewer: "bob" }), "connected")).not.toBe(base);
    expect(duelActionsSceneSignature(makeProjection(), "reconnecting")).not.toBe(base);
    expect(
      duelActionsSceneSignature(makeProjection({ pendingChoice: { active: true } }), "connected")
    ).not.toBe(base);
  });

  it("clears a stale selection on scene change but preserves it otherwise", () => {
    const selection: DuelActionsSelection = {
      ...EMPTY_DUEL_ACTIONS_SELECTION,
      actionId: "act-play",
      moveUnitUIDs: ["unit-a"]
    };
    expect(selectionAfterSceneChange(selection, "s1", "s1")).toBe(selection);
    expect(selectionAfterSceneChange(selection, "s1", "s2")).toBe(EMPTY_DUEL_ACTIONS_SELECTION);
  });
});

describe("DuelActionsPanelV3 gate authority", () => {
  it("returns null only when connected, validated, non-pending and not ended", () => {
    expect(duelActionsGateReason(openGate())).toBeNull();
    expect(duelActionsGateReason({ ...openGate(), projectionValid: false })).toBe(
      DUEL_ACTIONS_PROJECTION_INVALID_NOTICE
    );
    expect(duelActionsGateReason({ ...openGate(), ended: true })).toBe(DUEL_ACTIONS_ENDED_NOTICE);
    expect(duelActionsGateReason({ ...openGate(), commandPending: true })).toBe(DUEL_ACTIONS_PENDING_NOTICE);
  });

  it("never re-implements a legacy resource action", () => {
    const actions: readonly DuelActionV3Actions1[] = [
      playAction,
      { id: "legacy", kind: "gold-power", label: "使用金币", enabled: true, uid: "gold-1" },
      { id: "legacy2", kind: "pay-pending", label: "支付", enabled: true, paymentId: "pay-1" }
    ];
    expect(actions.filter(isLegacyAction).map(action => action.kind)).toEqual(["gold-power", "pay-pending"]);
    expect(buildDuelCommand(actions[1]!, EMPTY_DUEL_ACTIONS_SELECTION, null)).toBeNull();
  });
});

describe("DuelActionsPanelV3 readable labels", () => {
  const moveAction: DuelActionV3Actions1 = {
    id: "act-move",
    kind: "standard-move",
    label: "移动单位",
    enabled: true,
    windowId: "window-move",
    selectableUnitUIDs: ["unit-a", "unit-c"],
    destinations: [
      { locationId: ALICE_BASE, eligibleUnitUIDs: ["unit-a", "unit-c"] },
      { locationId: FIELD_A, eligibleUnitUIDs: ["unit-a", "unit-c"] }
    ]
  };
  const moveProjection = makeProjection({
    actions: [moveAction],
    units: [
      unitFixture("unit-a", "alice", ALICE_BASE, "alice", { tokenName: "铸光者" }),
      unitFixture("unit-c", "alice", ALICE_BASE, "alice", { cardId: "card-x" })
    ]
  });
  const moveSelection = { ...EMPTY_DUEL_ACTIONS_SELECTION, actionId: "act-move" };
  const catalog = (cardId: string) => (cardId === "card-x" ? "炎爆术" : cardId);

  it("shows a token name and resolves a card unit from the injected catalog", () => {
    const html = render({ projection: moveProjection, initialSelection: moveSelection, resolveCardName: catalog });
    expect(html).toContain("铸光者");
    expect(html).toContain("炎爆术"); // resolveCardName("card-x")
    // The raw unit UIDs never appear as player text.
    expect(html).not.toContain("unit-a");
    expect(html).not.toContain("unit-c");
  });

  it("shows friendly destination names instead of opaque location ids", () => {
    const html = render({ projection: moveProjection, initialSelection: moveSelection, resolveCardName: catalog });
    expect(html).toContain(DUEL_ACTIONS_BASE_LABEL);
    expect(html).toContain(`${DUEL_ACTIONS_BATTLEFIELD_LABEL}1`);
    // Neither the JSON location id nor its raw parts leak into player text.
    expect(html).not.toContain(ALICE_BASE);
    expect(html).not.toContain("duel-base");
    expect(html).not.toContain(FIELD_A);
    expect(html).not.toContain("duel-battlefield");
  });

  it("keeps the raw server tokens in the submitted payload while showing labels", () => {
    const selection: DuelActionsSelection = {
      ...EMPTY_DUEL_ACTIONS_SELECTION,
      actionId: "act-move",
      moveUnitUIDs: ["unit-a"],
      moveDestinationLocationId: FIELD_A
    };
    const packet = buildDuelCommandPacket(moveAction, selection, null, {
      expectedVersion: 7,
      ids: { requestId: "r", commandId: "c" }
    });
    expect(packet?.command).toEqual({
      type: "standard-move",
      windowId: "window-move",
      unitUIDs: ["unit-a"],
      destinationLocationId: FIELD_A
    });
  });

  it("falls back to a stable ordinal for a card unit the catalog cannot name", () => {
    // The board lists only `unit-a` (an unnameable card); `unit-c` is referenced
    // by the action but absent from the board, so it must not collide with it.
    const html = render({
      projection: makeProjection({
        actions: [moveAction],
        units: [unitFixture("unit-a", "alice", ALICE_BASE, "alice", { cardId: "card-nocat" })]
      }),
      initialSelection: moveSelection,
      resolveCardName: () => ""
    });
    expect(html).toContain(`${DUEL_ACTIONS_MOVE_UNIT_FALLBACK_PREFIX}1`);
    expect(html).toContain(`${DUEL_ACTIONS_MOVE_UNIT_FALLBACK_PREFIX}2`);
    expect(html).not.toContain("unit-a");
    expect(html).not.toContain("unit-c");
  });

  it("labels documented prompt kinds and numbers a repeated kind", () => {
    const choiceAction: DuelActionV3Actions1 = {
      id: "act-choice",
      kind: "answer-pending-choice",
      label: "选择效果",
      enabled: true,
      choiceId: "choice-1"
    };
    const pendingChoice: DuelPendingChoiceV3Actions1 = {
      active: true,
      choiceId: "choice-1",
      kind: "effect-choices",
      prompts: [
        { promptId: "p1", kind: "mode", minSelections: 1, maxSelections: 1, options: [{ id: "o1", label: "突袭" }] },
        { promptId: "p2", kind: "target", minSelections: 1, maxSelections: 1, options: [{ id: "o2", label: "甲" }] },
        { promptId: "p3", kind: "target", minSelections: 1, maxSelections: 1, options: [{ id: "o3", label: "乙" }] }
      ]
    };
    const html = render({
      projection: makeProjection({ actions: [choiceAction], pendingChoice }),
      initialSelection: { ...EMPTY_DUEL_ACTIONS_SELECTION, actionId: "act-choice" }
    });
    expect(html).toContain(`${DUEL_ACTIONS_PROMPT_TITLE_PREFIX}${DUEL_ACTIONS_PROMPT_KIND_LABELS.mode}`);
    expect(html).toContain(`${DUEL_ACTIONS_PROMPT_TITLE_PREFIX}${DUEL_ACTIONS_PROMPT_KIND_LABELS.target}（1）`);
    expect(html).toContain(`${DUEL_ACTIONS_PROMPT_TITLE_PREFIX}${DUEL_ACTIONS_PROMPT_KIND_LABELS.target}（2）`);
    // Option labels remain visible; the real prompt ids never become player text.
    expect(html).toContain("突袭");
    expect(html).not.toContain("p1");
    expect(html).not.toContain("p2");
    expect(html).not.toContain("p3");
  });

  it("keeps the real promptId and option tokens in the answer payload", () => {
    const choiceAction: DuelActionV3Actions1 = {
      id: "act-choice",
      kind: "answer-pending-choice",
      label: "选择效果",
      enabled: true,
      choiceId: "choice-1"
    };
    const pendingChoice: DuelPendingChoiceV3Actions1 = {
      active: true,
      choiceId: "choice-1",
      kind: "play-choices",
      prompts: [
        { promptId: "p1", kind: "target", minSelections: 1, maxSelections: 1, options: [{ id: "o1", label: "甲" }] }
      ]
    };
    const selection: DuelActionsSelection = {
      ...EMPTY_DUEL_ACTIONS_SELECTION,
      actionId: "act-choice",
      choiceOptionIds: { p1: ["o1"] }
    };
    expect(buildDuelCommand(choiceAction, selection, pendingChoice)).toEqual({
      type: "answer-pending-choice",
      choiceId: "choice-1",
      answers: [{ promptId: "p1", optionIds: ["o1"] }]
    });
  });

  it("labels combat targets and keeps the raw object id in the assignment payload", () => {
    const combatAction: DuelActionV3Actions1 = {
      id: "act-combat",
      kind: "assign-combat-damage",
      label: "分配战斗伤害",
      enabled: true,
      choiceId: "combat-1"
    };
    const pendingChoice: DuelPendingChoiceV3Actions1 = {
      active: true,
      choiceId: "combat-1",
      kind: "combat-allocation",
      fieldLocationId: FIELD_A,
      side: "attacker",
      budget: 3,
      targets: [{ unitObjectId: "unit-b", lethalNeed: 2 }]
    };
    const html = render({
      projection: makeProjection({
        actions: [combatAction],
        pendingChoice,
        units: [unitFixture("unit-b", "bob", FIELD_A, "bob", { tokenName: "碎星兽" })],
        contestedFields: [FIELD_A]
      }),
      initialSelection: { ...EMPTY_DUEL_ACTIONS_SELECTION, actionId: "act-combat" }
    });
    expect(html).toContain("碎星兽");
    expect(html).toContain("分配给 碎星兽 的数量");
    expect(html).not.toContain("unit-b");

    const selection: DuelActionsSelection = {
      ...EMPTY_DUEL_ACTIONS_SELECTION,
      actionId: "act-combat",
      allocationAmounts: { "unit-b": 2 }
    };
    expect(buildDuelCommand(combatAction, selection, pendingChoice)).toEqual({
      type: "assign-combat-damage",
      choiceId: "combat-1",
      assignments: [{ unitObjectId: "unit-b", amount: 2 }]
    });
  });

  it("keeps the legacy note wording clear of a single sub-panel name", () => {
    expect(DUEL_ACTIONS_LEGACY_NOTE).toContain("对局面板");
    expect(DUEL_ACTIONS_LEGACY_NOTE).not.toContain("资源面板");
    const legacy: DuelActionV3Actions1 = {
      id: "legacy-rune",
      kind: "rune-energy",
      label: "横置符文 +1 能量",
      enabled: true,
      uid: "rune-1"
    };
    const html = render({
      projection: makeProjection({ actions: [legacy], baseRunes: [{ uid: "rune-1" }] })
    });
    expect(html).toContain(DUEL_ACTIONS_LEGACY_NOTE);
  });
});

describe("DuelActionsPanelV3 display adapters", () => {
  it("distinguishes identical card units by visible location and ordinal while keeping their UID keys", () => {
    const projection = makeProjection({ viewer: 'alice', units: [
      unitFixture('same-at-base', 'alice', ALICE_BASE, 'alice', { cardId: 'same-card' }),
      unitFixture('same-at-field', 'alice', FIELD_A, 'alice', { cardId: 'same-card' }),
      unitFixture('second-at-base', 'alice', ALICE_BASE, 'alice', { cardId: 'same-card' }),
    ] });
    const labels = duelUnitLabelById(projection, () => '超能机甲');
    expect(labels.get('same-at-base')).toContain(DUEL_ACTIONS_BASE_LABEL);
    expect(labels.get('same-at-field')).toContain(`${DUEL_ACTIONS_BATTLEFIELD_LABEL}1`);
    expect(new Set(labels.values()).size).toBe(3);
    for (const label of labels.values()) expect(label).not.toContain('same-at');
    expect([...labels.keys()]).toEqual(['same-at-base', 'same-at-field', 'second-at-base']);
  });

  it("resolves a unit label from token name, catalog title, or ordinal", () => {
    const token = unitWire(unitFixture("t1", "alice", ALICE_BASE, "alice", { tokenName: "灵狐" })) as unknown as DuelWireUnit;
    expect(duelUnitDisplayLabel(token, 1)).toBe("灵狐");
    const card = unitWire(unitFixture("u1", "alice", ALICE_BASE, "alice", { cardId: "card-9" })) as unknown as DuelWireUnit;
    expect(duelUnitDisplayLabel(card, 2, cardId => `标题:${cardId}`)).toBe("标题:card-9");
    // No catalog resolver / blank title -> stable ordinal, never the raw UID.
    expect(duelUnitDisplayLabel(card, 2)).toBe(`${DUEL_ACTIONS_MOVE_UNIT_FALLBACK_PREFIX}2`);
    expect(duelUnitDisplayLabel(card, 2, () => "   ")).toBe(`${DUEL_ACTIONS_MOVE_UNIT_FALLBACK_PREFIX}2`);
    expect(duelUnitDisplayLabel(undefined, 3)).toBe(`${DUEL_ACTIONS_MOVE_UNIT_FALLBACK_PREFIX}3`);
  });

  it("maps units and locations from the viewer's own perspective", () => {
    const projection = makeProjection({
      viewer: "alice",
      units: [unitFixture("unit-a", "alice", ALICE_BASE, "alice", { tokenName: "灵狐" })]
    });
    const unitMap = duelUnitLabelById(projection);
    expect(unitMap.get("unit-a")).toBe("灵狐");

    const aliceView = duelLocationLabelById(projection);
    expect(aliceView.get(ALICE_BASE)).toBe(DUEL_ACTIONS_BASE_LABEL);
    expect(aliceView.get(BOB_BASE)).toBe(DUEL_ACTIONS_OPPONENT_BASE_LABEL);
    expect(aliceView.get(FIELD_A)).toBe(`${DUEL_ACTIONS_BATTLEFIELD_LABEL}1`);
    expect(aliceView.get(FIELD_B)).toBe(`${DUEL_ACTIONS_BATTLEFIELD_LABEL}2`);

    // The opponent's perspective flips which base is "my base".
    const bobView = duelLocationLabelById(makeProjection({ viewer: "bob" }));
    expect(bobView.get(BOB_BASE)).toBe(DUEL_ACTIONS_BASE_LABEL);
    expect(bobView.get(ALICE_BASE)).toBe(DUEL_ACTIONS_OPPONENT_BASE_LABEL);
  });

  it("never labels a base from a spectator's perspective", () => {
    const spectator = makeProjection({ viewer: null });
    const labels = duelLocationLabelById(spectator);
    // Only the two public battlefields are nameable to a spectator.
    expect(labels.size).toBe(2);
    expect([...labels.values()]).toEqual([
      `${DUEL_ACTIONS_BATTLEFIELD_LABEL}1`,
      `${DUEL_ACTIONS_BATTLEFIELD_LABEL}2`
    ]);
    expect(labels.has(ALICE_BASE)).toBe(false);
    expect(labels.has(BOB_BASE)).toBe(false);
  });

  it("numbers a repeated prompt kind by server order and leaves unique kinds bare", () => {
    const unique: DuelWireChoicePromptV3Actions1 = {
      promptId: "p1",
      kind: "destination",
      minSelections: 1,
      maxSelections: 1,
      options: [{ id: "o1", label: "甲" }]
    };
    expect(duelPromptTitle(unique, [unique])).toBe(
      `${DUEL_ACTIONS_PROMPT_TITLE_PREFIX}${DUEL_ACTIONS_PROMPT_KIND_LABELS.destination}`
    );
    const first: DuelWireChoicePromptV3Actions1 = { ...unique, promptId: "p1", kind: "optional-cost" };
    const second: DuelWireChoicePromptV3Actions1 = { ...unique, promptId: "p2", kind: "optional-cost" };
    expect(duelPromptTitle(first, [first, second])).toBe(
      `${DUEL_ACTIONS_PROMPT_TITLE_PREFIX}${DUEL_ACTIONS_PROMPT_KIND_LABELS["optional-cost"]}（1）`
    );
    expect(duelPromptTitle(second, [first, second])).toBe(
      `${DUEL_ACTIONS_PROMPT_TITLE_PREFIX}${DUEL_ACTIONS_PROMPT_KIND_LABELS["optional-cost"]}（2）`
    );
  });

  it("does not leak internal ids to a spectator who sees no owner choice", () => {
    const secretUnit = JSON.stringify(["unit-secret", "opaque-uid"]);
    const spectator = makeProjection({ viewer: null, units: [unitFixture(secretUnit, "alice", ALICE_BASE)] });
    const html = render({ projection: spectator });
    expect(html).toContain(DUEL_ACTIONS_SPECTATOR_NOTICE);
    expect(html).not.toContain(secretUnit);
    expect(html).not.toContain("opaque-uid");
    // No owner-facing action/board text is rendered to a spectator.
    expect(html).not.toContain(DUEL_ACTIONS_BASE_LABEL);
    expect(html).not.toContain(DUEL_ACTIONS_BATTLEFIELD_LABEL);
  });
});

describe("DuelActionsPanelV3.css scoping", () => {
  it("prefixes every rule so it cannot leak into other styles", () => {
    const css = readFileSync(
      new URL("../../src/full-product/components/DuelActionsPanelV3.css", import.meta.url),
      "utf8"
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    const selectors = css
      .split("}")
      .map(rule => rule.split("{")[0]?.trim() ?? "")
      .filter(selector => selector.length > 0);
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      for (const part of selector.split(",")) {
        expect(part.trim().startsWith(".full-product-duel-actions"), part).toBe(true);
      }
    }
  });
});
