import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import {
  DUEL_ACTIONS_CHOICE_NEED_SELECTION,
  DUEL_ACTIONS_CHOICE_UNAVAILABLE_NOTICE,
  DUEL_ACTIONS_DISCONNECTED_NOTICE,
  DUEL_ACTIONS_NO_ACTIONS_NOTICE,
  DUEL_ACTIONS_PENDING_NOTICE,
  DUEL_ACTIONS_SPECTATOR_NOTICE,
  DUEL_ACTIONS_SUBMIT_LABEL_PREFIX,
  DuelActionsPanelV3,
  EMPTY_DUEL_ACTIONS_SELECTION,
  buildDuelCommandPacket,
  duelActionsSceneSignature,
  duelCardActionForm,
  duelCardOptionSelection,
  resolveDuelActionIssue,
  selectionAfterSceneChange,
  submitDuelActionSelection
} from "../../src/full-product/components/DuelActionsPanelV3";
import type {
  DuelActionsGateState,
  DuelActionsPanelV3Props,
  DuelActionsSelection
} from "../../src/full-product/components/DuelActionsPanelV3";
import { isDuelProjectionV3Actions1 } from "@riftbound/protocol";
import type {
  DuelActionV3Actions1,
  DuelPendingChoiceV3Actions1,
  DuelProjectionV3Actions1
} from "@riftbound/protocol";

const ALICE_BASE = JSON.stringify(["duel-base", "alice"]);
const BOB_BASE = JSON.stringify(["duel-base", "bob"]);
const FIELD_A = JSON.stringify(["duel-battlefield", "bf-a"]);
const FIELD_B = JSON.stringify(["duel-battlefield", "bf-b"]);

const EMPTY_POOL = { energy: 0, power: { Fury: 0, Calm: 0, Mind: 0, Body: 0, Chaos: 0, Order: 0, any: 0 } };

interface FixtureOptions {
  readonly viewer?: string | null;
  readonly stateVersion?: number;
  readonly phase?: string;
  readonly pendingChoice?: DuelPendingChoiceV3Actions1;
  readonly actions?: readonly DuelActionV3Actions1[];
  readonly units?: readonly { readonly objectId: string; readonly locationId: string }[];
  readonly contestedFields?: readonly string[];
}

/**
 * Fixture that genuinely satisfies `isDuelProjectionV3Actions1`, so card-mode
 * tests render against a real, guard-passing P4 projection. Local copy so this
 * card-mode file stays inside its assigned write scope.
 */
function makeProjection(options: FixtureOptions = {}): DuelProjectionV3Actions1 {
  const viewer = options.viewer === undefined ? "alice" : options.viewer;
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
  if (viewer === "alice") alicePlayer.hand = [];
  if (viewer === "bob") bobPlayer.hand = [];

  const contested = options.contestedFields ?? [];
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
        contested: contested.includes(FIELD_A),
        contestingPlayerId: contested.includes(FIELD_A) ? "alice" : null,
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
        contested: contested.includes(FIELD_B),
        contestingPlayerId: contested.includes(FIELD_B) ? "bob" : null,
        showdown: "none",
        combat: "none",
        occupancy: occupancy(FIELD_B)
      }
    ],
    units: units.map(unit => ({
      objectId: unit.objectId,
      controllerPlayerId: "alice",
      locationId: unit.locationId,
      ownerPlayerId: "alice",
      readied: true,
      trait: { kind: "token", name: unit.objectId, baseMight: 2, tags: [] },
      totalDamage: 0,
      damageMarks: []
    })),
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
    turnPlayerId: "alice",
    priorityPlayerId: "alice",
    focusPlayerId: null,
    stateOpen: true,
    pendingPayment: null,
    chain: { active: false },
    pendingChoice: options.pendingChoice ?? null,
    execution: { status: "ready" }
  };

  return {
    projectionSchema: "riftbound-duel-v3-actions-1",
    viewerPlayerId: viewer,
    match: {
      schemaVersion: 3,
      rulesetId: "riftbound-duel",
      matchId: "match-card",
      dataVersion: "dv-1",
      catalogDigest: "cd-1",
      stateVersion: options.stateVersion ?? 7,
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

const choiceAction: DuelActionV3Actions1 = {
  id: "act-choice",
  kind: "answer-pending-choice",
  label: "选择效果",
  enabled: true,
  choiceId: "choice-1"
};

function openGate(): DuelActionsGateState {
  return { connectionStatus: "connected", commandPending: false, projectionValid: true, ended: false };
}

function renderCard(props: Partial<DuelActionsPanelV3Props> & { projection: DuelProjectionV3Actions1 }): string {
  const full: DuelActionsPanelV3Props = {
    connectionStatus: "connected",
    commandPending: false,
    presentation: "card",
    onCommand: () => {},
    ...props
  };
  return renderToStaticMarkup(<DuelActionsPanelV3 {...full} />);
}

function renderPanel(props: Partial<DuelActionsPanelV3Props> & { projection: DuelProjectionV3Actions1 }): string {
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

describe("DuelActionsPanelV3 card fixtures", () => {
  it("builds guard-passing projections", () => {
    expect(isDuelProjectionV3Actions1(makeProjection({ actions: [playAction] }))).toBe(true);
    expect(isDuelProjectionV3Actions1(makeProjection({ viewer: null, actions: [] }))).toBe(true);
  });
});

describe("DuelActionsPanelV3 card action form classification", () => {
  it("treats parameterless actions as immediate and parameter actions as params", () => {
    for (const kind of ["pass-priority", "pass-focus", "end-turn"] as const) {
      const action = { id: `act-${kind}`, kind, label: kind, enabled: true, windowId: "w" } as DuelActionV3Actions1;
      expect(duelCardActionForm(action, null)).toBe("immediate");
    }
    expect(duelCardActionForm(playAction, null)).toBe("immediate");
    expect(duelCardActionForm(moveAction, null)).toBe("params");
  });

  it("treats a single owner prompt bounded min=max=1 as direct option buttons", () => {
    const pendingChoice: DuelPendingChoiceV3Actions1 = {
      active: true,
      choiceId: "choice-1",
      kind: "play-choices",
      prompts: [
        {
          promptId: "p1",
          kind: "optional-cost",
          minSelections: 1,
          maxSelections: 1,
          options: [
            { id: "o-pay", label: "支付额外费" },
            { id: "o-skip", label: "不支付" }
          ]
        }
      ]
    };
    expect(duelCardActionForm(choiceAction, pendingChoice)).toBe("choice-options");
  });

  it("keeps multi-prompt, multi-select, empty and unavailable choices on full collection", () => {
    const twoPrompts: DuelPendingChoiceV3Actions1 = {
      active: true,
      choiceId: "choice-1",
      kind: "effect-choices",
      prompts: [
        { promptId: "p1", kind: "mode", minSelections: 1, maxSelections: 1, options: [{ id: "o1", label: "甲" }] },
        { promptId: "p2", kind: "target", minSelections: 1, maxSelections: 1, options: [{ id: "o2", label: "乙" }] }
      ]
    };
    const multiSelect: DuelPendingChoiceV3Actions1 = {
      active: true,
      choiceId: "choice-1",
      kind: "play-choices",
      prompts: [
        { promptId: "p1", kind: "effect-choice", minSelections: 1, maxSelections: 2, options: [{ id: "o1", label: "甲" }, { id: "o2", label: "乙" }] }
      ]
    };
    // Optional (min 0) prompt: the extra-cost semantics stay user-collected.
    const optional: DuelPendingChoiceV3Actions1 = {
      active: true,
      choiceId: "choice-1",
      kind: "play-choices",
      prompts: [
        { promptId: "p1", kind: "optional-cost", minSelections: 0, maxSelections: 1, options: [{ id: "o1", label: "支付额外费" }] }
      ]
    };
    expect(duelCardActionForm(choiceAction, twoPrompts)).toBe("params");
    expect(duelCardActionForm(choiceAction, multiSelect)).toBe("params");
    expect(duelCardActionForm(choiceAction, optional)).toBe("params");
    // A choice whose owner cannot be matched never becomes a shortcut.
    expect(duelCardActionForm(choiceAction, { active: true })).toBe("params");
    expect(duelCardActionForm(choiceAction, null)).toBe("params");
  });

  it("builds a one-option selection that still answers the full prompt list", () => {
    const selection = duelCardOptionSelection(choiceAction, {
      promptId: "p1",
      kind: "optional-cost",
      minSelections: 1,
      maxSelections: 1,
      options: [{ id: "o-pay", label: "支付额外费" }]
    }, "o-pay", EMPTY_DUEL_ACTIONS_SELECTION);
    expect(selection.actionId).toBe("act-choice");
    expect(selection.choiceOptionIds).toEqual({ p1: ["o-pay"] });
  });
});

describe("DuelActionsPanelV3 card presentation", () => {
  it("drops the duplicated big title and status block but keeps the action list label", () => {
    const html = renderCard({ projection: makeProjection({ actions: [playAction] }) });
    expect(html).toContain("is-card-mode");
    expect(html).not.toContain("full-product-duel-actions-title");
    expect(html).not.toContain("full-product-duel-actions-status");
    expect(html).toContain("可用动作");
  });

  it("never exposes an action/card UID as card text", () => {
    const html = renderCard({ projection: makeProjection({ actions: [playAction] }) });
    expect(html).not.toContain("card-1");
    expect(html).not.toContain("act-play");
  });

  it("renders a parameterless action as one direct submit button, with no separate confirm", () => {
    const html = renderCard({ projection: makeProjection({ actions: [playAction] }) });
    const tag = buttonTag(html, "打出卡牌");
    expect(tag).toContain("is-direct");
    expect(tag).not.toContain("disabled");
    // No select-then-confirm double step in card mode.
    expect(html).not.toContain(DUEL_ACTIONS_SUBMIT_LABEL_PREFIX);
    // The click path is exactly the guarded submit boundary used by the panel.
    const packet = submitDuelActionSelection({
      action: playAction,
      selection: { ...EMPTY_DUEL_ACTIONS_SELECTION, actionId: "act-play" },
      pendingChoice: null,
      gate: openGate(),
      expectedVersion: 7,
      ids: { requestId: "req-card", commandId: "cmd-card" }
    });
    expect(packet?.command).toEqual({ type: "play-card", cardUID: "card-1", windowId: "window-main" });
  });

  it("filters the original action list by actionIds and shows none for an empty list", () => {
    const projection = makeProjection({ actions: [playAction, moveAction] });
    const onlyMove = renderCard({ projection, actionIds: ["act-move"] });
    expect(onlyMove).not.toContain("打出卡牌");
    expect(onlyMove).toContain("移动单位");
    const none = renderCard({ projection, actionIds: [] });
    expect(none).toContain(DUEL_ACTIONS_NO_ACTIONS_NOTICE);
    expect(none.split('class="full-product-duel-actions-action').length - 1).toBe(0);
    const unknown = renderCard({ projection, actionIds: ["act-not-real"] });
    expect(unknown).toContain(DUEL_ACTIONS_NO_ACTIONS_NOTICE);
  });

  it("auto-expands the unique filtered parameter action so the clicked card shows its form", () => {
    const html = renderCard({
      projection: makeProjection({ actions: [moveAction], units: [{ objectId: "unit-a", locationId: ALICE_BASE }] }),
      actionIds: ["act-move"]
    });
    expect(html).toContain("选择要移动的单位");
    expect(html).toContain("选择目的地");
    expect(html).toContain(`${DUEL_ACTIONS_SUBMIT_LABEL_PREFIX}移动单位`);
  });

  it("keeps a real drag prefill through initialSelection", () => {
    const html = renderCard({
      projection: makeProjection({ actions: [moveAction], units: [{ objectId: "unit-a", locationId: ALICE_BASE }] }),
      actionIds: ["act-move"],
      initialSelection: {
        ...EMPTY_DUEL_ACTIONS_SELECTION,
        actionId: "act-move",
        moveUnitUIDs: ["unit-a"],
        moveDestinationLocationId: FIELD_A
      }
    });
    // The prefilled destination chip is the pressed one, and submit is allowed.
    expect(html).toContain('aria-label="选择目的地"');
    expect(buttonTag(html, `${DUEL_ACTIONS_SUBMIT_LABEL_PREFIX}移动单位`)).not.toContain("disabled");
  });

  it("renders one direct button per real option for a single min=max=1 prompt", () => {
    const pendingChoice: DuelPendingChoiceV3Actions1 = {
      active: true,
      choiceId: "choice-1",
      kind: "play-choices",
      prompts: [
        {
          promptId: "p1",
          kind: "optional-cost",
          minSelections: 1,
          maxSelections: 1,
          options: [
            { id: "o-pay", label: "支付额外费" },
            { id: "o-skip", label: "不支付" }
          ]
        }
      ]
    };
    const projection = makeProjection({ actions: [choiceAction], pendingChoice });
    const html = renderCard({ projection, actionIds: ["act-choice"] });
    expect(buttonTag(html, "选择效果：支付额外费")).not.toContain("disabled");
    expect(buttonTag(html, "选择效果：不支付")).not.toContain("disabled");
    expect(html).not.toContain(DUEL_ACTIONS_SUBMIT_LABEL_PREFIX);
    // Each option still ships the complete guarded answer packet.
    const optionSelection = duelCardOptionSelection(choiceAction, pendingChoice.prompts[0]!, "o-pay", EMPTY_DUEL_ACTIONS_SELECTION);
    expect(resolveDuelActionIssue(choiceAction, optionSelection, pendingChoice, openGate())).toBeNull();
    const packet = buildDuelCommandPacket(choiceAction, optionSelection, pendingChoice, {
      expectedVersion: 7,
      ids: { requestId: "req-choice", commandId: "cmd-choice" }
    });
    expect(packet?.command).toEqual({
      type: "answer-pending-choice",
      choiceId: "choice-1",
      answers: [{ promptId: "p1", optionIds: ["o-pay"] }]
    });
  });

  it("keeps multi-prompt choices on full collection with a single confirm", () => {
    const pendingChoice: DuelPendingChoiceV3Actions1 = {
      active: true,
      choiceId: "choice-1",
      kind: "effect-choices",
      prompts: [
        { promptId: "p1", kind: "mode", minSelections: 1, maxSelections: 1, options: [{ id: "o1", label: "甲" }] },
        { promptId: "p2", kind: "target", minSelections: 1, maxSelections: 1, options: [{ id: "o2", label: "乙" }] }
      ]
    };
    const projection = makeProjection({ actions: [choiceAction], pendingChoice });
    const html = renderCard({ projection, actionIds: ["act-choice"] });
    expect(html).toContain("甲");
    expect(html).toContain("乙");
    expect(html).toContain(`${DUEL_ACTIONS_SUBMIT_LABEL_PREFIX}选择效果`);
    expect(buttonTag(html, `${DUEL_ACTIONS_SUBMIT_LABEL_PREFIX}选择效果`)).toContain("disabled");
    // One answer is still not enough: the issue is the same as the panel's.
    expect(
      resolveDuelActionIssue(
        choiceAction,
        { ...EMPTY_DUEL_ACTIONS_SELECTION, actionId: "act-choice", choiceOptionIds: { p1: ["o1"] } },
        pendingChoice,
        openGate()
      )
    ).toBe(DUEL_ACTIONS_CHOICE_NEED_SELECTION);
  });
});

describe("DuelActionsPanelV3 card fail-closed behavior", () => {
  it("renders no action for a spectator and keeps the spectator notice", () => {
    const html = renderCard({ projection: makeProjection({ viewer: null, actions: [] }) });
    expect(html).toContain(DUEL_ACTIONS_SPECTATOR_NOTICE);
    expect(html.split('class="full-product-duel-actions-action').length - 1).toBe(0);
  });

  it("disables every card action while disconnected or processing", () => {
    const disconnected = renderCard({
      projection: makeProjection({ actions: [playAction] }),
      connectionStatus: "disconnected"
    });
    expect(disconnected).toContain(DUEL_ACTIONS_DISCONNECTED_NOTICE);
    expect(buttonTag(disconnected, "打出卡牌")).toContain("disabled");

    const pending = renderCard({ projection: makeProjection({ actions: [playAction] }), commandPending: true });
    expect(pending).toContain(DUEL_ACTIONS_PENDING_NOTICE);
    expect(buttonTag(pending, "打出卡牌")).toContain("disabled");
  });

  it("blocks a wrong-owner choice and never invents options", () => {
    // The action's choiceId does not match the pending choice: fail closed.
    const pendingChoice: DuelPendingChoiceV3Actions1 = {
      active: true,
      choiceId: "choice-other",
      kind: "play-choices",
      prompts: [
        { promptId: "p1", kind: "mode", minSelections: 1, maxSelections: 1, options: [{ id: "o1", label: "甲" }] }
      ]
    };
    const html = renderCard({
      projection: makeProjection({ actions: [choiceAction], pendingChoice }),
      actionIds: ["act-choice"]
    });
    expect(html).toContain(DUEL_ACTIONS_CHOICE_UNAVAILABLE_NOTICE);
    expect(buttonTag(html, "选择效果")).toContain("disabled");
  });

  it("submits nothing while the gate is closed", () => {
    for (const gate of [
      { ...openGate(), commandPending: true },
      { ...openGate(), connectionStatus: "disconnected" as const },
      { ...openGate(), ended: true }
    ]) {
      expect(
        submitDuelActionSelection({
          action: playAction,
          selection: { ...EMPTY_DUEL_ACTIONS_SELECTION, actionId: "act-play" },
          pendingChoice: null,
          gate,
          expectedVersion: 7,
          ids: { requestId: "r", commandId: "c" }
        })
      ).toBeNull();
    }
  });

  it("clears a stale selection on a version/scene change and never auto-expands a stale id", () => {
    const stale: DuelActionsSelection = {
      ...EMPTY_DUEL_ACTIONS_SELECTION,
      actionId: "act-move",
      moveUnitUIDs: ["unit-a"],
      moveDestinationLocationId: FIELD_A
    };
    const before = duelActionsSceneSignature(makeProjection({ stateVersion: 7 }), "connected");
    const after = duelActionsSceneSignature(makeProjection({ stateVersion: 8 }), "connected");
    expect(before).not.toBe(after);
    expect(selectionAfterSceneChange(stale, before, after)).toEqual(EMPTY_DUEL_ACTIONS_SELECTION);
    expect(selectionAfterSceneChange(stale, before, before)).toBe(stale);

    // A stale actionId from a previous scene must not auto-expand or prefill a
    // new projection action with the same-looking id.
    const html = renderCard({
      projection: makeProjection({ actions: [moveAction], units: [{ objectId: "unit-a", locationId: ALICE_BASE }] }),
      actionIds: ["act-move"],
      initialSelection: { ...EMPTY_DUEL_ACTIONS_SELECTION, actionId: "act-gone", moveUnitUIDs: ["unit-a"] }
    });
    expect(html).not.toContain("选择要移动的单位");
    expect(buttonTag(html, "移动单位")).not.toContain("disabled");
  });
});

describe("DuelActionsPanelV3 panel compatibility", () => {
  it("keeps the default panel behavior: title, status and select-then-confirm", () => {
    const html = renderPanel({ projection: makeProjection({ actions: [moveAction] }) });
    expect(html).toContain("full-product-duel-actions-title");
    expect(html).toContain("已连接");
    expect(html).not.toContain("is-card-mode");
    // Panel mode still requires selecting the action before the confirm row shows.
    expect(html).not.toContain(`${DUEL_ACTIONS_SUBMIT_LABEL_PREFIX}移动单位`);
    expect(html.split('class="full-product-duel-actions-action"').length - 1).toBe(1);
  });

  it("keeps the panel's implicit all-actions default when actionIds is omitted", () => {
    const projection = makeProjection({ actions: [playAction, moveAction] });
    const html = renderPanel({ projection });
    expect(html).toContain("打出卡牌");
    expect(html).toContain("移动单位");
  });
});
