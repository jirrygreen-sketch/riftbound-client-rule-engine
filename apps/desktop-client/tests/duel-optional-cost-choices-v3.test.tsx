import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import {
  DUEL_ACTIONS_CHOICE_NEED_SELECTION,
  DUEL_ACTIONS_CHOICE_UNAVAILABLE_NOTICE,
  DUEL_ACTIONS_DISCONNECTED_NOTICE,
  DUEL_ACTIONS_ENDED_NOTICE,
  DUEL_ACTIONS_PENDING_NOTICE,
  DUEL_ACTIONS_PROMPT_KIND_LABELS,
  DUEL_ACTIONS_PROMPT_TITLE_PREFIX,
  DUEL_ACTIONS_SPECTATOR_NOTICE,
  DUEL_ACTIONS_SUBMIT_LABEL_PREFIX,
  DUEL_ACTIONS_WAITING_CHOICE_NOTICE,
  DuelActionsPanelV3,
  EMPTY_DUEL_ACTIONS_SELECTION,
  duelActionsGateReason,
  duelActionsSceneSignature,
  resolveDuelActionIssue,
  selectionAfterSceneChange,
  submitDuelActionSelection
} from "../src/full-product/components/DuelActionsPanelV3";
import type {
  DuelActionsGateState,
  DuelActionsSelection
} from "../src/full-product/components/DuelActionsPanelV3";
import {
  DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
  isDuelCommandMessageV3Actions1,
  isDuelProjectionV3Actions1
} from "@riftbound/protocol";
import type {
  DuelActionV3Actions1,
  DuelPendingChoiceV3Actions1,
  DuelProjectionV3Actions1
} from "@riftbound/protocol";

/**
 * UI contract acceptance for "may pay" optional costs.
 *
 * The task is to prove that an optional ("may pay") extra cost is an explicit
 * player choice in the existing public protocol: the panel must never preselect
 * an option, never auto-send, and must submit only the opaque server token the
 * player actually picked. This is a *presentation-seam* acceptance only: it is
 * NOT an end-to-end official-card test, and the owner has no generic optional-cost
 * production path yet (see REPORT), so these fixtures model the public wire shape
 * the server would emit rather than a real card.
 *
 * Genuine interaction seam: the panel is a pure SSR component plus the exported,
 * contract-guarded submit boundary (`resolveDuelActionIssue`,
 * `submitDuelActionSelection`, `duelActionsSceneSignature`,
 * `selectionAfterSceneChange`). This environment has no jsdom / react-test-renderer
 * and the dependency lock is frozen, so no synthetic DOM harness is added; every
 * assertion below drives the real component/helpers, not a re-derived mock.
 */

const ALICE_BASE = JSON.stringify(["duel-base", "alice"]);
const BOB_BASE = JSON.stringify(["duel-base", "bob"]);
const FIELD_A = JSON.stringify(["duel-battlefield", "bf-a"]);
const FIELD_B = JSON.stringify(["duel-battlefield", "bf-b"]);

const EMPTY_POOL = { energy: 0, power: { Fury: 0, Calm: 0, Mind: 0, Body: 0, Chaos: 0, Order: 0, any: 0 } };

/** Opaque per-choice option tokens, never surfaced as player text. */
const PAY_TOKEN = "opt-pay-7f3a";
const DECLINE_TOKEN = "opt-decline-91bd";
const CHOICE_ID = "choice-optional-cost-1";
const PROMPT_ID = "prompt-optional-cost-1";

interface FixtureOptions {
  readonly viewer?: string | null;
  readonly stateVersion?: number;
  readonly phase?: string;
  readonly pendingChoice?: DuelPendingChoiceV3Actions1;
  readonly actions?: readonly DuelActionV3Actions1[];
}

/**
 * A projection that genuinely satisfies the real P4 guard
 * (`isDuelProjectionV3Actions1`). Only the viewer's own seat may carry a `hand`
 * array; everyone else must omit the key, so an opponent's information can never
 * be represented, let alone leaked.
 */
function makeProjection(options: FixtureOptions = {}): DuelProjectionV3Actions1 {
  const viewer = options.viewer === undefined ? "alice" : options.viewer;
  const stateVersion = options.stateVersion ?? 7;

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
      {
        locationId: FIELD_A,
        instanceId: "bf-a",
        cardId: "bf-card-a",
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
        cardId: "bf-card-b",
        ownerPlayerId: "bob",
        controllerPlayerId: null,
        contested: false,
        contestingPlayerId: null,
        showdown: "none",
        combat: "none",
        occupancy: []
      }
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
      matchId: "match-1",
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

const ANSWER_ACTION: DuelActionV3Actions1 = {
  id: "act-optional-cost",
  kind: "answer-pending-choice",
  label: "选择额外费用",
  enabled: true,
  choiceId: CHOICE_ID
};

/** The two-option "may pay" shape: pay the extra cost, or decline it. */
const OPTIONAL_COST_CHOICE: DuelPendingChoiceV3Actions1 = {
  active: true,
  choiceId: CHOICE_ID,
  kind: "play-choices",
  prompts: [
    {
      promptId: PROMPT_ID,
      kind: "optional-cost",
      minSelections: 1,
      maxSelections: 1,
      options: [
        { id: PAY_TOKEN, label: "支付额外费用" },
        { id: DECLINE_TOKEN, label: "不支付" }
      ]
    }
  ]
};

function openGate(): DuelActionsGateState {
  return { connectionStatus: "connected", commandPending: false, projectionValid: true, ended: false };
}

function render(props: {
  projection: DuelProjectionV3Actions1;
  connectionStatus?: "connected" | "connecting" | "reconnecting" | "disconnected";
  commandPending?: boolean;
  initialSelection?: DuelActionsSelection;
  onCommand?: (packet: unknown) => void;
}): string {
  return renderToStaticMarkup(
    <DuelActionsPanelV3
      projection={props.projection}
      connectionStatus={props.connectionStatus ?? "connected"}
      commandPending={props.commandPending ?? false}
      onCommand={props.onCommand ?? (() => {})}
      initialSelection={props.initialSelection}
      generatePacketIds={() => ({ requestId: "req-oc", commandId: "cmd-oc" })}
    />
  );
}

function buttonTag(html: string, ariaLabel: string): string {
  const index = html.indexOf(`aria-label="${ariaLabel}"`);
  expect(index, `button ${ariaLabel} not found`).toBeGreaterThanOrEqual(0);
  const open = html.lastIndexOf("<button", index);
  const close = html.indexOf(">", index);
  return html.slice(open, close + 1);
}

/** Option chips carry their label as text, not as aria-label. */
function optionButtonTag(html: string, label: string): string {
  const index = html.indexOf(`>${label}</button>`);
  expect(index, `option button ${label} not found`).toBeGreaterThanOrEqual(0);
  const open = html.lastIndexOf("<button", index);
  return html.slice(open, index + 1);
}

const SELECTED_ACTION: DuelActionsSelection = {
  ...EMPTY_DUEL_ACTIONS_SELECTION,
  actionId: "act-optional-cost"
};

describe("optional-cost fixtures pass the real P4 guard", () => {
  it("builds a play-choices optional-cost projection the guard accepts", () => {
    const projection = makeProjection({ actions: [ANSWER_ACTION], pendingChoice: OPTIONAL_COST_CHOICE });
    expect(isDuelProjectionV3Actions1(projection)).toBe(true);
  });
});

describe("optional-cost choice is explicit, never auto-paid", () => {
  it("preselects nothing and never auto-sends on first render", () => {
    const onCommand = vi.fn();
    const html = render({
      projection: makeProjection({ actions: [ANSWER_ACTION], pendingChoice: OPTIONAL_COST_CHOICE }),
      initialSelection: SELECTED_ACTION,
      onCommand
    });
    // Both server options are shown, but none is chosen for the player.
    expect(html).toContain("支付额外费用");
    expect(html).toContain("不支付");
    // Each option chip is rendered un-pressed: the panel does not choose for the player.
    expect(optionButtonTag(html, "支付额外费用")).toContain('aria-pressed="false"');
    expect(optionButtonTag(html, "不支付")).toContain('aria-pressed="false"');
    expect(optionButtonTag(html, "支付额外费用")).not.toContain('aria-pressed="true"');
    expect(optionButtonTag(html, "不支付")).not.toContain('aria-pressed="true"');
    // Nothing was submitted without an explicit click.
    expect(onCommand).not.toHaveBeenCalled();
    // The submit gate stays closed until a choice exists.
    expect(buttonTag(html, `${DUEL_ACTIONS_SUBMIT_LABEL_PREFIX}选择额外费用`)).toContain("disabled");
    expect(html).toContain(DUEL_ACTIONS_CHOICE_NEED_SELECTION);
  });

  it("submits only the decline token after an explicit decline", () => {
    const selection: DuelActionsSelection = {
      ...SELECTED_ACTION,
      choiceOptionIds: { [PROMPT_ID]: [DECLINE_TOKEN] }
    };
    expect(resolveDuelActionIssue(ANSWER_ACTION, selection, OPTIONAL_COST_CHOICE, openGate())).toBeNull();
    const packet = submitDuelActionSelection({
      action: ANSWER_ACTION,
      selection,
      pendingChoice: OPTIONAL_COST_CHOICE,
      gate: openGate(),
      expectedVersion: 7,
      ids: { requestId: "req-oc", commandId: "cmd-oc" }
    });
    expect(packet).not.toBeNull();
    expect(packet?.commandProfile).toBe(DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1);
    expect(packet?.command).toEqual({
      type: "answer-pending-choice",
      choiceId: CHOICE_ID,
      answers: [{ promptId: PROMPT_ID, optionIds: [DECLINE_TOKEN] }]
    });
    // The pay token is never smuggled into a decline.
    expect(JSON.stringify(packet)).not.toContain(PAY_TOKEN);
    expect(isDuelCommandMessageV3Actions1(packet)).toBe(true);
  });

  it("submits only the pay token after an explicit pay", () => {
    const selection: DuelActionsSelection = {
      ...SELECTED_ACTION,
      choiceOptionIds: { [PROMPT_ID]: [PAY_TOKEN] }
    };
    const packet = submitDuelActionSelection({
      action: ANSWER_ACTION,
      selection,
      pendingChoice: OPTIONAL_COST_CHOICE,
      gate: openGate(),
      expectedVersion: 7,
      ids: { requestId: "req-oc", commandId: "cmd-oc" }
    });
    expect(packet?.command).toEqual({
      type: "answer-pending-choice",
      choiceId: CHOICE_ID,
      answers: [{ promptId: PROMPT_ID, optionIds: [PAY_TOKEN] }]
    });
    expect(JSON.stringify(packet)).not.toContain(DECLINE_TOKEN);
    expect(isDuelCommandMessageV3Actions1(packet)).toBe(true);
  });

  it("refuses to submit while the player has not selected an option", () => {
    expect(resolveDuelActionIssue(ANSWER_ACTION, SELECTED_ACTION, OPTIONAL_COST_CHOICE, openGate())).toBe(
      DUEL_ACTIONS_CHOICE_NEED_SELECTION
    );
    const packet = submitDuelActionSelection({
      action: ANSWER_ACTION,
      selection: SELECTED_ACTION,
      pendingChoice: OPTIONAL_COST_CHOICE,
      gate: openGate(),
      expectedVersion: 7,
      ids: { requestId: "req-oc", commandId: "cmd-oc" }
    });
    expect(packet).toBeNull();
  });

  it("carries no resources / cost / client-effects field and never re-implements a legacy cost action", () => {
    const selection: DuelActionsSelection = {
      ...SELECTED_ACTION,
      choiceOptionIds: { [PROMPT_ID]: [PAY_TOKEN] }
    };
    const packet = submitDuelActionSelection({
      action: ANSWER_ACTION,
      selection,
      pendingChoice: OPTIONAL_COST_CHOICE,
      gate: openGate(),
      expectedVersion: 7,
      ids: { requestId: "req-oc", commandId: "cmd-oc" }
    });
    expect(packet).not.toBeNull();
    // Exact keys: the command authorizes nothing beyond the opaque answer.
    expect(Object.keys(packet!.command).sort()).toEqual(["answers", "choiceId", "type"]);
    const answers = (packet!.command as { answers: readonly object[] }).answers;
    expect(Object.keys(answers[0]!).sort()).toEqual(["optionIds", "promptId"]);
    const serialized = JSON.stringify(packet);
    for (const forbidden of ["resources", "cost", "effects", "payment", "runePool", "energy"]) {
      expect(serialized).not.toContain(`"${forbidden}"`);
    }
    // The legacy resource actions stay in the reference panel, not on the wire here.
    expect(ANSWER_ACTION.kind).toBe("answer-pending-choice");
    expect(serialized).not.toContain("rune-energy");
  });
});

describe("optional-cost choice survives scene changes safely", () => {
  it("resets a stale selection when the projection identity changes", () => {
    const before = makeProjection({ actions: [ANSWER_ACTION], pendingChoice: OPTIONAL_COST_CHOICE, stateVersion: 7 });
    const after = makeProjection({ actions: [ANSWER_ACTION], pendingChoice: OPTIONAL_COST_CHOICE, stateVersion: 8 });
    const fromScene = duelActionsSceneSignature(before, "connected");
    const toScene = duelActionsSceneSignature(after, "connected");
    expect(fromScene).not.toBe(toScene);
    const selection: DuelActionsSelection = {
      ...SELECTED_ACTION,
      choiceOptionIds: { [PROMPT_ID]: [PAY_TOKEN] }
    };
    expect(selectionAfterSceneChange(selection, fromScene, toScene)).toEqual(EMPTY_DUEL_ACTIONS_SELECTION);
    expect(selectionAfterSceneChange(selection, fromScene, fromScene)).toBe(selection);
  });

  it("changes the scene signature when the pending choice changes", () => {
    const withChoice = makeProjection({ actions: [ANSWER_ACTION], pendingChoice: OPTIONAL_COST_CHOICE });
    const withoutChoice = makeProjection({ actions: [ANSWER_ACTION], pendingChoice: { active: true } });
    expect(duelActionsSceneSignature(withChoice, "connected")).not.toBe(
      duelActionsSceneSignature(withoutChoice, "connected")
    );
  });
});

describe("optional-cost choice is read-only and leak-free off the owner's turn", () => {
  it("never leaks the options or renders a submit for a spectator", () => {
    const projection = makeProjection({ viewer: null, actions: [], pendingChoice: { active: true } });
    const html = render({ projection, initialSelection: SELECTED_ACTION });
    expect(html).toContain(DUEL_ACTIONS_SPECTATOR_NOTICE);
    expect(html).not.toContain("支付额外费用");
    expect(html).not.toContain("不支付");
    expect(html).not.toContain(PAY_TOKEN);
    expect(html).not.toContain(DECLINE_TOKEN);
  });

  it("shows a non-owner only that a choice exists, with no option tokens", () => {
    const projection = makeProjection({
      viewer: "bob",
      actions: [ANSWER_ACTION],
      pendingChoice: { active: true }
    });
    expect(isDuelProjectionV3Actions1(projection)).toBe(true);
    const html = render({ projection, initialSelection: SELECTED_ACTION });
    expect(html).toContain(DUEL_ACTIONS_WAITING_CHOICE_NOTICE);
    expect(html).toContain(DUEL_ACTIONS_CHOICE_UNAVAILABLE_NOTICE);
    expect(html).not.toContain("支付额外费用");
    expect(html).not.toContain("不支付");
    // The owner-only choice cannot be answered by a non-owner, even pessimistically.
    expect(
      submitDuelActionSelection({
        action: ANSWER_ACTION,
        selection: { ...SELECTED_ACTION, choiceOptionIds: { [PROMPT_ID]: [PAY_TOKEN] } },
        pendingChoice: { active: true },
        gate: openGate(),
        expectedVersion: 7,
        ids: { requestId: "req-oc", commandId: "cmd-oc" }
      })
    ).toBeNull();
  });

  it("keeps every option disabled and unsubmittable while offline, pending or ended", () => {
    const projection = makeProjection({ actions: [ANSWER_ACTION], pendingChoice: OPTIONAL_COST_CHOICE });
    const selection: DuelActionsSelection = {
      ...SELECTED_ACTION,
      choiceOptionIds: { [PROMPT_ID]: [PAY_TOKEN] }
    };

    const disconnected = render({ projection, connectionStatus: "disconnected", initialSelection: selection });
    expect(disconnected).toContain(DUEL_ACTIONS_DISCONNECTED_NOTICE);
    expect(optionButtonTag(disconnected, "支付额外费用")).toContain("disabled");
    expect(optionButtonTag(disconnected, "不支付")).toContain("disabled");

    const pending = render({ projection, commandPending: true, initialSelection: selection });
    expect(pending).toContain(DUEL_ACTIONS_PENDING_NOTICE);
    expect(optionButtonTag(pending, "支付额外费用")).toContain("disabled");

    // Ended is fail-closed: the gate refuses and a forged submit builds nothing.
    expect(duelActionsGateReason({ ...openGate(), ended: true })).toBe(DUEL_ACTIONS_ENDED_NOTICE);
    const endedProjection = makeProjection({
      actions: [ANSWER_ACTION],
      pendingChoice: OPTIONAL_COST_CHOICE,
      phase: "ended"
    });
    const endedHtml = render({ projection: endedProjection, initialSelection: selection });
    expect(endedHtml).not.toContain("支付额外费用");
    expect(
      submitDuelActionSelection({
        action: ANSWER_ACTION,
        selection,
        pendingChoice: OPTIONAL_COST_CHOICE,
        gate: { ...openGate(), ended: true },
        expectedVersion: 7,
        ids: { requestId: "req-oc", commandId: "cmd-oc" }
      })
    ).toBeNull();
  });
});

describe("optional-cost empty answer vs an explicit decline", () => {
  it("labels the optional-cost prompt kind for the player", () => {
    expect(DUEL_ACTIONS_PROMPT_KIND_LABELS["optional-cost"]).toBe("额外费用");
    const html = render({
      projection: makeProjection({ actions: [ANSWER_ACTION], pendingChoice: OPTIONAL_COST_CHOICE }),
      initialSelection: SELECTED_ACTION
    });
    expect(html).toContain(`${DUEL_ACTIONS_PROMPT_TITLE_PREFIX}${DUEL_ACTIONS_PROMPT_KIND_LABELS["optional-cost"]}`);
  });

  it("accepts an empty answer only where the server min is zero, and keeps it distinct from a decline token", () => {
    // min 0 == the server itself allows "choose nothing"; this test does NOT define
    // what that means on the server, only that the client must not invent an option.
    const emptyAllowed: DuelPendingChoiceV3Actions1 = {
      active: true,
      choiceId: CHOICE_ID,
      kind: "play-choices",
      prompts: [
        {
          promptId: PROMPT_ID,
          kind: "optional-cost",
          minSelections: 0,
          maxSelections: 1,
          options: [{ id: PAY_TOKEN, label: "支付额外费用" }]
        }
      ]
    };
    const emptySelection: DuelActionsSelection = { ...SELECTED_ACTION, choiceOptionIds: { [PROMPT_ID]: [] } };
    expect(resolveDuelActionIssue(ANSWER_ACTION, emptySelection, emptyAllowed, openGate())).toBeNull();
    const emptyPacket = submitDuelActionSelection({
      action: ANSWER_ACTION,
      selection: emptySelection,
      pendingChoice: emptyAllowed,
      gate: openGate(),
      expectedVersion: 7,
      ids: { requestId: "req-oc", commandId: "cmd-oc" }
    });
    expect(emptyPacket?.command).toEqual({
      type: "answer-pending-choice",
      choiceId: CHOICE_ID,
      answers: [{ promptId: PROMPT_ID, optionIds: [] }]
    });

    // A decline is a real server option, so it sends a token instead of an empty array.
    const declineSelection: DuelActionsSelection = {
      ...SELECTED_ACTION,
      choiceOptionIds: { [PROMPT_ID]: [DECLINE_TOKEN] }
    };
    const declinePacket = submitDuelActionSelection({
      action: ANSWER_ACTION,
      selection: declineSelection,
      pendingChoice: OPTIONAL_COST_CHOICE,
      gate: openGate(),
      expectedVersion: 7,
      ids: { requestId: "req-oc", commandId: "cmd-oc" }
    });
    const emptyAnswer = (emptyPacket!.command as { answers: readonly { optionIds: readonly string[] }[] }).answers[0]!;
    const declineAnswer = (declinePacket!.command as { answers: readonly { optionIds: readonly string[] }[] }).answers[0]!;
    expect(emptyAnswer.optionIds).toEqual([]);
    expect(declineAnswer.optionIds).toEqual([DECLINE_TOKEN]);
    expect(emptyAnswer.optionIds).not.toEqual(declineAnswer.optionIds);

    // Where the server demands at least one option, empty is refused.
    expect(resolveDuelActionIssue(ANSWER_ACTION, emptySelection, OPTIONAL_COST_CHOICE, openGate())).toBe(
      DUEL_ACTIONS_CHOICE_NEED_SELECTION
    );
  });
});
