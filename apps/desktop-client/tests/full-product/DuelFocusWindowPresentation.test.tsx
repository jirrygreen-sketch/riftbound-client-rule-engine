import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import {
  DUEL_WINDOW_STATUS_CHAIN,
  DUEL_WINDOW_STATUS_CHOICE,
  DUEL_WINDOW_STATUS_COMBAT_ALLOCATION,
  DUEL_WINDOW_STATUS_COMBAT_WAIT,
  DUEL_WINDOW_STATUS_DETAIL_COMBAT_ALLOCATION,
  DUEL_WINDOW_STATUS_DETAIL_COMBAT_WAIT,
  DUEL_WINDOW_STATUS_DETAIL_FOCUS,
  DUEL_WINDOW_STATUS_DETAIL_SHOWDOWN_WAIT,
  DUEL_WINDOW_STATUS_FOCUS,
  DUEL_WINDOW_STATUS_MAIN,
  DUEL_WINDOW_STATUS_PAYMENT,
  DUEL_WINDOW_STATUS_SHOWDOWN_WAIT,
  DUEL_WINDOW_STATUS_WAITING,
  DuelWindowStatus,
  describeDuelWindowStatus
} from "../../src/full-product/components/DuelWindowStatus";
import {
  DUEL_ACTIONS_GENERIC_WAITING_REASONS,
  DUEL_ACTIONS_WAITING_OPPONENT_REASON,
  DuelActionsPanelV3,
  actionDisabledReason,
  duelActionDisabledReasonDisplay,
  submitDuelActionSelection
} from "../../src/full-product/components/DuelActionsPanelV3";
import type { DuelActionsGateState } from "../../src/full-product/components/DuelActionsPanelV3";
import { isDuelProjectionV3Actions1 } from "@riftbound/protocol";
import type {
  DuelActionV3Actions1,
  DuelPendingChoiceV3Actions1,
  DuelProjectionV3Actions1
} from "@riftbound/protocol";

/**
 * Focus-timing presentation contract. Everything here runs against genuine,
 * guard-passing `DuelProjectionV3Actions1` fixtures and asserts the *pure*
 * display seams:
 *  - `describeDuelWindowStatus` reads only the viewer's own server-enabled
 *    `pass-focus`, the public `board.battlefields` showdown/combat status and an
 *    owner-visible pending choice;
 *  - the action panel never invents or hides an action, and only rewords the two
 *    generic server "waiting for the rules" placeholders in a normal ready Main
 *    Phase for a non-owner.
 * Rendering is static SSR only; it never claims native/DOM behaviour.
 */

const ALICE_BASE = JSON.stringify(["duel-base", "alice"]);
const BOB_BASE = JSON.stringify(["duel-base", "bob"]);
const FIELD_A = JSON.stringify(["duel-battlefield", "bf-a"]);
const FIELD_B = JSON.stringify(["duel-battlefield", "bf-b"]);
const EMPTY_POOL = { energy: 0, power: { Fury: 0, Calm: 0, Mind: 0, Body: 0, Chaos: 0, Order: 0, any: 0 } };
const WINDOW = "window-focus";

interface Engagement {
  readonly showdown: "none" | "staged" | "active";
  readonly combat: "none" | "staged" | "active";
}

interface FixtureOptions {
  readonly viewer?: string | null;
  readonly phase?: string;
  readonly turnPlayerId?: string;
  readonly priorityPlayerId?: string | null;
  readonly focusPlayerId?: string | null;
  readonly stateOpen?: boolean;
  readonly chain?: unknown;
  readonly pendingChoice?: DuelPendingChoiceV3Actions1;
  readonly pendingPayment?: unknown;
  readonly execution?: unknown;
  readonly actions?: readonly DuelActionV3Actions1[];
  /** Marks battlefield A's public `showdown`/`combat` status. */
  readonly engagement?: Engagement;
}

/** A real, guard-passing projection. Defaults to an open Main Phase. */
function makeProjection(options: FixtureOptions = {}): DuelProjectionV3Actions1 {
  const viewer = options.viewer === undefined ? "alice" : options.viewer;
  const chain = options.chain ?? { active: false };
  const chainActive = (chain as { active?: boolean }).active === true;
  const engagement = options.engagement ?? { showdown: "none" as const, combat: "none" as const };
  const engaged = engagement.showdown !== "none" || engagement.combat !== "none";

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
  if (viewer === "alice") alicePlayer.hand = [];
  if (viewer === "bob") bobPlayer.hand = [];

  const board = {
    bases: [
      { locationId: ALICE_BASE, ownerPlayerId: "alice", occupancy: [] },
      { locationId: BOB_BASE, ownerPlayerId: "bob", occupancy: [] }
    ],
    battlefields: [
      { locationId: FIELD_A, instanceId: "bf-a", cardId: "bf-card-a", ownerPlayerId: "alice",
        controllerPlayerId: null, contested: engaged, contestingPlayerId: engaged ? "alice" : null,
        showdown: engagement.showdown, combat: engagement.combat, occupancy: [] },
      { locationId: FIELD_B, instanceId: "bf-b", cardId: "bf-card-b", ownerPlayerId: "bob",
        controllerPlayerId: null, contested: false, contestingPlayerId: null, showdown: "none",
        combat: "none", occupancy: [] }
    ],
    units: [],
    gears: []
  };

  const resources = {
    players: [
      { playerId: "alice", runePool: { ...EMPTY_POOL, power: { ...EMPTY_POOL.power } }, runeDeckCount: 8 },
      { playerId: "bob", runePool: { ...EMPTY_POOL, power: { ...EMPTY_POOL.power } }, runeDeckCount: 8 }
    ],
    bases: [
      { playerId: "alice", locationId: ALICE_BASE, baseRunes: [], goldTokens: [] },
      { playerId: "bob", locationId: BOB_BASE, baseRunes: [], goldTokens: [] }
    ]
  };

  const frame = {
    phase: options.phase ?? "main",
    turnNumber: 1,
    turnPlayerId: options.turnPlayerId ?? "alice",
    priorityPlayerId: options.priorityPlayerId === undefined ? "alice" : options.priorityPlayerId,
    focusPlayerId: options.focusPlayerId ?? null,
    // A live Chain forces a Closed State; the guard rejects chain.active + stateOpen.
    stateOpen: options.stateOpen === undefined ? (!chainActive && !engaged) : options.stateOpen,
    pendingPayment: options.pendingPayment ?? null,
    chain,
    pendingChoice: options.pendingChoice ?? null,
    execution: options.execution ?? { status: "ready" }
  };

  return {
    projectionSchema: "riftbound-duel-v3-actions-1",
    viewerPlayerId: viewer,
    match: {
      schemaVersion: 3,
      rulesetId: "riftbound-duel",
      matchId: "match-1",
      dataVersion: "dv-1",
      catalogDigest: "cd-1",
      stateVersion: 7,
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

function passFocus(enabled: boolean): DuelActionV3Actions1 {
  return { id: "act-pass-focus", kind: "pass-focus", label: "让过焦点", enabled, windowId: WINDOW };
}

function passPriority(enabled: boolean): DuelActionV3Actions1 {
  return { id: "act-pass-priority", kind: "pass-priority", label: "让过优先权", enabled, windowId: WINDOW };
}

function endTurn(enabled: boolean, reason: string): DuelActionV3Actions1 {
  return { id: "act-end-turn", kind: "end-turn", label: "结束回合", enabled, reason, windowId: WINDOW };
}

const combatChoiceFixture: DuelPendingChoiceV3Actions1 = {
  active: true,
  choiceId: "choice-combat",
  kind: "combat-allocation",
  fieldLocationId: FIELD_A,
  side: "attacker",
  budget: 4,
  targets: [{ unitObjectId: "unit-a", lethalNeed: 2 }]
};

const effectChoiceFixture: DuelPendingChoiceV3Actions1 = {
  active: true,
  choiceId: "choice-effect",
  kind: "effect-choices",
  prompts: [{
    promptId: "prompt-1",
    kind: "target",
    minSelections: 1,
    maxSelections: 1,
    options: [{ id: "option-1", label: "选项一" }]
  }]
};

const ACTIVE_SHOWDOWN: Engagement = { showdown: "active", combat: "none" };
const ACTIVE_COMBAT: Engagement = { showdown: "active", combat: "active" };

function windowStatus(projection: DuelProjectionV3Actions1) {
  return describeDuelWindowStatus(projection);
}

function renderWindow(projection: DuelProjectionV3Actions1): string {
  return renderToStaticMarkup(<DuelWindowStatus projection={projection} />);
}

function openGate(): DuelActionsGateState {
  return { connectionStatus: "connected", commandPending: false, projectionValid: true, ended: false };
}

describe("DuelFocusWindowPresentation fixtures", () => {
  it("builds genuine P4 projections for every focus/combat scene", () => {
    expect(isDuelProjectionV3Actions1(makeProjection())).toBe(true);
    expect(isDuelProjectionV3Actions1(
      makeProjection({ engagement: ACTIVE_COMBAT, actions: [passFocus(true)] })
    )).toBe(true);
    expect(isDuelProjectionV3Actions1(
      makeProjection({ viewer: "bob", engagement: ACTIVE_SHOWDOWN, actions: [] })
    )).toBe(true);
    expect(isDuelProjectionV3Actions1(
      makeProjection({ pendingChoice: combatChoiceFixture, stateOpen: false, actions: [] })
    )).toBe(true);
    expect(isDuelProjectionV3Actions1(
      makeProjection({ chain: { active: true, itemCount: 1, pendingCount: 0 }, actions: [passPriority(true)] })
    )).toBe(true);
  });
});

describe("describeDuelWindowStatus focus/combat presentation", () => {
  it("prompts the viewer's own focus only from a server-enabled pass-focus action", () => {
    const status = windowStatus(makeProjection({
      viewer: "alice",
      turnPlayerId: "alice",
      priorityPlayerId: "alice",
      focusPlayerId: "alice",
      engagement: ACTIVE_SHOWDOWN,
      actions: [passFocus(true)]
    }));
    expect(status.label).toBe(DUEL_WINDOW_STATUS_FOCUS);
    expect(status.detail).toBe(DUEL_WINDOW_STATUS_DETAIL_FOCUS);
    expect(status.responseAvailable).toBe(true);
    // A focus window is not a play window: no playable card UID is invented.
    expect(status.playableCardUIDs).toEqual([]);
  });

  it("does not treat a disabled pass-focus (or turnPlayerId) as the viewer's focus", () => {
    const disabled = windowStatus(makeProjection({
      viewer: "alice",
      turnPlayerId: "alice",
      engagement: ACTIVE_SHOWDOWN,
      actions: [passFocus(false)]
    }));
    expect(disabled.responseAvailable).toBe(false);
    expect(disabled.label).toBe(DUEL_WINDOW_STATUS_SHOWDOWN_WAIT);

    // turnPlayerId is the viewer but no pass-focus is enabled: never inferred.
    const noAction = windowStatus(makeProjection({
      viewer: "alice",
      turnPlayerId: "alice",
      engagement: ACTIVE_SHOWDOWN,
      actions: []
    }));
    expect(noAction.label).toBe(DUEL_WINDOW_STATUS_SHOWDOWN_WAIT);
    expect(noAction.responseAvailable).toBe(false);
  });

  it("shows the public showdown as under way to a non-owner without naming the actor", () => {
    const status = windowStatus(makeProjection({
      viewer: "bob",
      turnPlayerId: "alice",
      priorityPlayerId: "alice",
      engagement: ACTIVE_SHOWDOWN,
      actions: []
    }));
    expect(status.label).toBe(DUEL_WINDOW_STATUS_SHOWDOWN_WAIT);
    expect(status.detail).toBe(DUEL_WINDOW_STATUS_DETAIL_SHOWDOWN_WAIT);
    expect(status.responseAvailable).toBe(false);
    expect(status.playableCardUIDs).toEqual([]);
  });

  it("shows public combat as ongoing without guessing the hidden focus or allocation step", () => {
    const status = windowStatus(makeProjection({
      viewer: "bob",
      turnPlayerId: "alice",
      priorityPlayerId: "alice",
      engagement: ACTIVE_COMBAT,
      actions: []
    }));
    expect(status.label).toBe(DUEL_WINDOW_STATUS_COMBAT_WAIT);
    expect(status.detail).toBe(DUEL_WINDOW_STATUS_DETAIL_COMBAT_WAIT);
    expect(status.label).toBe("战斗进行中");
    expect(status.detail).not.toContain("伤害分配");
    expect(status.responseAvailable).toBe(false);
    expect(status.playableCardUIDs).toEqual([]);
  });

  it("labels an owner-visible combat allocation choice without inventing hidden choices", () => {
    const owner = windowStatus(makeProjection({ viewer: "alice", pendingChoice: combatChoiceFixture }));
    expect(owner.label).toBe(DUEL_WINDOW_STATUS_COMBAT_ALLOCATION);
    expect(owner.detail).toBe(DUEL_WINDOW_STATUS_DETAIL_COMBAT_ALLOCATION);
    expect(owner.responseAvailable).toBe(false);

    // A hidden/non-matching choice stays the generic waiting-for-choice label.
    const hidden = windowStatus(makeProjection({ viewer: "bob", pendingChoice: { active: true } }));
    expect(hidden.label).toBe(DUEL_WINDOW_STATUS_CHOICE);
    const effect = windowStatus(makeProjection({ viewer: "alice", pendingChoice: effectChoiceFixture }));
    expect(effect.label).toBe(DUEL_WINDOW_STATUS_CHOICE);
  });

  it("keeps the ended -> payment -> choice -> chain precedence over any focus/combat field", () => {
    const chain = { active: true, itemCount: 1, pendingCount: 0 };
    const cases: Array<{ label: string; projection: DuelProjectionV3Actions1; expected: string }> = [
      {
        label: "ended wins",
        projection: makeProjection({ phase: "ended", priorityPlayerId: null, engagement: ACTIVE_COMBAT }),
        expected: "对局结束"
      },
      {
        label: "a zero-cost payment still wins",
        projection: makeProjection({
          pendingPayment: { active: true, paymentId: "pay-0", resolvedCost: { energy: 0, power: [] } },
          engagement: ACTIVE_COMBAT,
          actions: [passFocus(true)]
        }),
        expected: DUEL_WINDOW_STATUS_PAYMENT
      },
      {
        label: "choice wins over an active chain and engagement",
        projection: makeProjection({
          pendingChoice: combatChoiceFixture,
          chain,
          stateOpen: false,
          engagement: ACTIVE_COMBAT
        }),
        expected: DUEL_WINDOW_STATUS_COMBAT_ALLOCATION
      },
      {
        label: "chain wins over an engagement",
        projection: makeProjection({
          chain,
          priorityPlayerId: "alice",
          engagement: ACTIVE_COMBAT,
          actions: [passPriority(true)]
        }),
        expected: DUEL_WINDOW_STATUS_CHAIN
      }
    ];
    for (const testCase of cases) {
      expect(isDuelProjectionV3Actions1(testCase.projection), testCase.label).toBe(true);
      expect(windowStatus(testCase.projection).label, testCase.label).toBe(testCase.expected);
    }
  });

  it("keeps a genuine pending execution as rule processing, never an active field", () => {
    const projection = makeProjection({
      viewer: "alice",
      engagement: ACTIVE_COMBAT,
      execution: { status: "pending" },
      actions: [passFocus(true)]
    });
    expect(isDuelProjectionV3Actions1(projection)).toBe(true);
    const status = windowStatus(projection);
    expect(status.label).toBe(DUEL_WINDOW_STATUS_WAITING);
    expect(status.responseAvailable).toBe(false);
    expect(status.playableCardUIDs).toEqual([]);
  });

  it("keeps a normal open Main Phase distinct from a closed state", () => {
    expect(windowStatus(makeProjection({ stateOpen: true })).label).toBe(DUEL_WINDOW_STATUS_MAIN);
    expect(windowStatus(makeProjection({ stateOpen: false })).label).toBe(DUEL_WINDOW_STATUS_WAITING);
  });
});

describe("DuelWindowStatus focus rendering", () => {
  it("renders the focus strip inertly, with no button or click surface", () => {
    const html = renderWindow(makeProjection({
      viewer: "alice",
      turnPlayerId: "alice",
      engagement: ACTIVE_SHOWDOWN,
      actions: [passFocus(true)]
    }));
    expect(html).toContain(DUEL_WINDOW_STATUS_FOCUS);
    expect(html).toContain('data-response-available="true"');
    expect(html).not.toContain("<button");
    expect(html).not.toContain("onClick");
  });

  it("renders the non-owner waiting strip with no click surface either", () => {
    const html = renderWindow(makeProjection({
      viewer: "bob",
      turnPlayerId: "alice",
      engagement: ACTIVE_COMBAT,
      actions: []
    }));
    expect(html).toContain(DUEL_WINDOW_STATUS_COMBAT_WAIT);
    expect(html).toContain('data-response-available="false"');
    expect(html).not.toContain("<button");
    expect(html).not.toContain("onClick");
  });
});

describe("DuelActionsPanelV3 disabled-row presentation", () => {
  const generic = DUEL_ACTIONS_GENERIC_WAITING_REASONS[1];

  it("rewords the generic server reason to waiting-for-opponent in a normal non-owner Main", () => {
    const projection = makeProjection({
      viewer: "bob",
      turnPlayerId: "alice",
      priorityPlayerId: "alice",
      actions: [endTurn(false, generic)]
    });
    expect(isDuelProjectionV3Actions1(projection)).toBe(true);
    const action = projection.actions[0]!;
    expect(actionDisabledReason(action, openGate(), null)).toBe(generic);
    expect(duelActionDisabledReasonDisplay(generic, action, projection)).toBe(DUEL_ACTIONS_WAITING_OPPONENT_REASON);
    const html = renderToStaticMarkup(
      <DuelActionsPanelV3 projection={projection} connectionStatus="connected" commandPending={false} onCommand={() => {}} />
    );
    expect(html).toContain(DUEL_ACTIONS_WAITING_OPPONENT_REASON);
    expect(html).not.toContain(generic);
  });

  it("rewords the other generic placeholder too", () => {
    const projection = makeProjection({
      viewer: "bob",
      turnPlayerId: "alice",
      priorityPlayerId: "alice",
      actions: [endTurn(false, DUEL_ACTIONS_GENERIC_WAITING_REASONS[0])]
    });
    const action = projection.actions[0]!;
    expect(duelActionDisabledReasonDisplay(DUEL_ACTIONS_GENERIC_WAITING_REASONS[0], action, projection))
      .toBe(DUEL_ACTIONS_WAITING_OPPONENT_REASON);
  });

  it("preserves every non-generic reason verbatim", () => {
    const reasons = ["资源不足", "当前没有可移动的单位", "未知规则待裁定", "该动作当前不可用"];
    for (const reason of reasons) {
      const projection = makeProjection({ viewer: "bob", actions: [endTurn(false, reason)] });
      const action = projection.actions[0]!;
      expect(duelActionDisabledReasonDisplay(reason, action, projection), reason).toBe(reason);
    }
  });

  it("keeps the generic reason when the viewer is the turn/priority owner", () => {
    const projection = makeProjection({
      viewer: "alice",
      turnPlayerId: "alice",
      priorityPlayerId: "alice",
      actions: [endTurn(false, generic)]
    });
    expect(duelActionDisabledReasonDisplay(generic, projection.actions[0]!, projection)).toBe(generic);
  });

  it("keeps the generic reason when the scene is genuinely rules-pending or non-Main", () => {
    const pending = makeProjection({
      viewer: "bob",
      turnPlayerId: "alice",
      execution: { status: "pending" },
      actions: [endTurn(false, generic)]
    });
    expect(isDuelProjectionV3Actions1(pending)).toBe(true);
    expect(duelActionDisabledReasonDisplay(generic, pending.actions[0]!, pending)).toBe(generic);

    const offPhase = makeProjection({
      viewer: "bob",
      turnPlayerId: "alice",
      phase: "channel",
      actions: [endTurn(false, generic)]
    });
    expect(isDuelProjectionV3Actions1(offPhase)).toBe(true);
    expect(duelActionDisabledReasonDisplay(generic, offPhase.actions[0]!, offPhase)).toBe(generic);
  });

  it("never touches an enabled action's reason and never changes enabled state", () => {
    const projection = makeProjection({
      viewer: "bob",
      turnPlayerId: "alice",
      priorityPlayerId: "alice",
      actions: [endTurn(true, generic)]
    });
    const action = projection.actions[0]!;
    expect(action.enabled).toBe(true);
    expect(duelActionDisabledReasonDisplay(generic, action, projection)).toBe(generic);
  });
});

describe("focus command boundary", () => {
  it("emits only an opaque pass-focus packet for an own enabled focus action", () => {
    const projection = makeProjection({
      viewer: "alice",
      turnPlayerId: "alice",
      engagement: ACTIVE_SHOWDOWN,
      actions: [passFocus(true)]
    });
    const packet = submitDuelActionSelection({
      action: projection.actions[0]!,
      selection: { actionId: "act-pass-focus", moveUnitUIDs: [], moveDestinationLocationId: null, choiceOptionIds: {}, allocationAmounts: {} },
      pendingChoice: null,
      gate: openGate(),
      expectedVersion: projection.match.stateVersion,
      ids: { requestId: "req-focus", commandId: "cmd-focus" }
    });
    expect(packet).not.toBeNull();
    expect(packet!.command).toEqual({ type: "pass-focus", windowId: WINDOW });
  });

  it("never emits for a non-owner focus option (no enabled own pass-focus)", () => {
    // A spectator/non-owner projection carries no focus action at all.
    const projection = makeProjection({
      viewer: "bob",
      turnPlayerId: "alice",
      engagement: ACTIVE_SHOWDOWN,
      actions: []
    });
    expect(projection.actions.filter(action => action.kind === "pass-focus")).toEqual([]);
    const html = renderToStaticMarkup(
      <DuelActionsPanelV3 projection={projection} connectionStatus="connected" commandPending={false} onCommand={() => {}} />
    );
    // No action button and no focus label leak into a non-owner panel.
    expect(html.split('class="full-product-duel-actions-action"').length - 1).toBe(0);
    expect(html).not.toContain("让过焦点");
  });

  it("refuses to emit for a disabled focus action", () => {
    const projection = makeProjection({
      viewer: "alice",
      turnPlayerId: "alice",
      engagement: ACTIVE_SHOWDOWN,
      actions: [passFocus(false)]
    });
    const packet = submitDuelActionSelection({
      action: projection.actions[0]!,
      selection: { actionId: "act-pass-focus", moveUnitUIDs: [], moveDestinationLocationId: null, choiceOptionIds: {}, allocationAmounts: {} },
      pendingChoice: null,
      gate: openGate(),
      expectedVersion: projection.match.stateVersion,
      ids: { requestId: "req-focus", commandId: "cmd-focus" }
    });
    expect(packet).toBeNull();
  });
});
