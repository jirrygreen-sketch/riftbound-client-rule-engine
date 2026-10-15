import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import { PromptActionPanel } from "../../src/full-product/PromptActionPanel";
import { BoardZones } from "../../src/full-product/components/BoardZones";
import {
  authoritativeActionOptions,
  buildAuthoritativeTargets,
  buildSubmissionFromSelection,
  commandTargetKey,
  deriveConcedeAction,
  deriveLegalActions,
  targetOptionsFor
} from "../../src/full-product/commands";
import { buildPlayableCommand } from "../../src/full-product/transport";
import type {
  ActionSelection,
  PlayableMatchView,
  TargetOption
} from "../../src/full-product/types";
import {
  ACTION_OPTIONS_CONTRACT,
  type CommandTarget,
  type GameProjection,
  type ProjectionAction,
  type ProjectionActionOptions,
  type ProjectionObject
} from "@riftbound/protocol";

const objectTarget = (objectId: string): CommandTarget => ({
  kind: "object",
  objectId
});
const playerTarget = (playerId: string): CommandTarget => ({
  kind: "player",
  playerId
});

function policy(
  options: readonly CommandTarget[],
  minTargets = 0,
  maxTargets = 0
) {
  return { minTargets, maxTargets, options };
}

function action(overrides: Partial<ProjectionAction> & Pick<ProjectionAction, "id" | "command">): ProjectionAction {
  return {
    targetPolicy: policy([]),
    enabled: true,
    ...overrides
  } as ProjectionAction;
}

function makeOptions(
  actions: readonly ProjectionAction[],
  overrides: Partial<ProjectionActionOptions> = {}
): ProjectionActionOptions {
  return {
    contract: ACTION_OPTIONS_CONTRACT,
    stateVersion: 7,
    viewerPlayerId: "player-1",
    actions,
    ...overrides
  };
}

function makeProjection(
  actionOptions: ProjectionActionOptions | undefined,
  overrides: Partial<GameProjection> = {}
): GameProjection {
  const objects: readonly ProjectionObject[] = [
    {
      objectId: "obj-1",
      cardId: "card-alpha",
      zone: "board",
      controllerId: "player-1",
      ownerPlayerId: "player-1",
      faceUp: true
    },
    {
      objectId: "obj-2",
      cardId: "card-beta",
      zone: "board",
      controllerId: "player-2",
      ownerPlayerId: "player-2",
      faceUp: true
    }
  ];
  return {
    version: 7,
    eventSeq: 0,
    phase: "main",
    turnNumber: 1,
    activePlayerId: "player-1",
    priority: { playerId: "player-1" },
    winnerPlayerId: null,
    prompt: null,
    waitingForPlayerId: null,
    objects,
    actionOptions,
    players: [
      {
        id: "player-1",
        name: "Alice",
        handCount: 3,
        hand: [
          { instanceId: "inst-1", cardId: "card-alpha" },
          { instanceId: "inst-2", cardId: "card-alpha" },
          { instanceId: "inst-3", cardId: "card-gamma" }
        ],
        playableInstanceIds: ["inst-1", "inst-2", "inst-3"]
      },
      {
        id: "player-2",
        name: "Bob",
        handCount: 0,
        hand: [],
        playableInstanceIds: []
      }
    ],
    events: [],
    ...overrides
  };
}

function makeView(
  actionOptions: ProjectionActionOptions | undefined,
  overrides: Partial<PlayableMatchView> = {}
): PlayableMatchView {
  return {
    connectionStatus: "connected",
    commandPending: false,
    viewerPlayerId: "player-1",
    resolveCardTitle: cardId => `Card ${cardId}`,
    resolveCardImage: () => null,
    projection: makeProjection(actionOptions),
    ...overrides
  };
}

const emptySelection: ActionSelection = {
  actionId: null,
  cardId: null,
  targetIds: []
};

describe("authoritative action options consumption", () => {
  it("uses only server-provided action ids and commands", () => {
    const options = makeOptions([
      action({
        id: "play:inst-1",
        command: { type: "play-card", instanceId: "inst-1" },
        targetPolicy: policy([objectTarget("obj-1")], 1, 1)
      }),
      action({ id: "pass", command: { type: "pass" } })
    ]);
    const view = makeView(options);
    const ids = deriveLegalActions(view).map(entry => entry.id);
    expect(ids).toEqual(["play:inst-1", "pass"]);
    // inst-3 is in hand and playableInstanceIds but the authority never offered
    // it, so no client-side construction may invent it.
    expect(ids).not.toContain("play:inst-3");
  });

  it("ignores the legacy hand/targets derivation while the contract is present", () => {
    const options = makeOptions([
      action({
        id: "play:inst-1",
        command: { type: "play-card", instanceId: "inst-1" },
        targetPolicy: policy([objectTarget("obj-1")], 1, 1)
      })
    ]);
    const view = makeView(options, {
      targets: {
        "card-alpha": [
          { id: "object:obj-1", label: "forged", objectId: "obj-forged" }
        ]
      },
      targetRequirements: { "card-alpha": ["target"] }
    });
    expect(authoritativeActionOptions(view)).not.toBeNull();
    const command = buildPlayableCommand(
      { actionId: "play:inst-1", cardId: "inst-1", targetIds: ["object:obj-1"] },
      view
    );
    expect(command).toEqual({
      type: "play-card",
      instanceId: "inst-1",
      targets: [objectTarget("obj-1")]
    });
  });

  it("keeps two instances of the same printing on independent policies", () => {
    const options = makeOptions([
      action({
        id: "play:inst-1",
        command: { type: "play-card", instanceId: "inst-1" },
        targetPolicy: policy([objectTarget("obj-1")], 1, 1)
      }),
      action({
        id: "play:inst-2",
        command: { type: "play-card", instanceId: "inst-2" },
        targetPolicy: policy([playerTarget("player-2")], 1, 1)
      })
    ]);
    const view = makeView(options);

    const first = targetOptionsFor(view, {
      actionId: "play:inst-1",
      cardId: "inst-1"
    });
    const second = targetOptionsFor(view, {
      actionId: "play:inst-2",
      cardId: "inst-2"
    });
    expect(first.map(option => option.id)).toEqual(["object:obj-1"]);
    expect(second.map(option => option.id)).toEqual(["player:player-2"]);

    // A target authorized for inst-2 must never satisfy inst-1.
    expect(
      buildSubmissionFromSelection(
        {
          actionId: "play:inst-1",
          cardId: "inst-1",
          targetIds: ["player:player-2"]
        },
        view
      )
    ).toBeNull();
    expect(
      buildSubmissionFromSelection(
        {
          actionId: "play:inst-2",
          cardId: "inst-2",
          targetIds: ["object:obj-1"]
        },
        view
      )
    ).toBeNull();
  });

  it("rejects missing, excessive, duplicated and forged target selections", () => {
    const options = makeOptions([
      action({
        id: "play:inst-1",
        command: { type: "play-card", instanceId: "inst-1" },
        targetPolicy: policy([objectTarget("obj-1")], 1, 1)
      })
    ]);
    const view = makeView(options);
    const at = (targetIds: readonly string[]) =>
      buildSubmissionFromSelection(
        { actionId: "play:inst-1", cardId: "inst-1", targetIds },
        view
      );

    expect(at([])).toBeNull();
    expect(at(["object:obj-1", "object:obj-2"])).toBeNull();
    expect(at(["object:obj-1", "object:obj-1"])).toBeNull();
    expect(at(["object:obj-forged"])).toBeNull();
    expect(at(["player:player-2"])).toBeNull();
    expect(at(["object:obj-1"])).toEqual({
      type: "play-card",
      instanceId: "inst-1",
      targets: [objectTarget("obj-1")]
    });
  });

  it("omits wire targets when the policy authorizes none", () => {
    const options = makeOptions([
      action({
        id: "play:inst-3",
        command: { type: "play-card", instanceId: "inst-3" },
        targetPolicy: policy([], 0, 0)
      })
    ]);
    const view = makeView(options);
    expect(
      buildSubmissionFromSelection(
        { actionId: "play:inst-3", cardId: "inst-3", targetIds: [] },
        view
      )
    ).toEqual({ type: "play-card", instanceId: "inst-3" });
  });

  it("sends identical authorized targets through both submit paths", () => {
    const options = makeOptions([
      action({
        id: "play:inst-1",
        command: { type: "play-card", instanceId: "inst-1" },
        targetPolicy: policy(
          [objectTarget("obj-1"), playerTarget("player-2")],
          2,
          2
        )
      })
    ]);
    const view = makeView(options);
    const selection: ActionSelection = {
      actionId: "play:inst-1",
      cardId: "inst-1",
      targetIds: ["object:obj-1", "player:player-2"]
    };
    const panelPath = buildSubmissionFromSelection(selection, view);
    const appPath = buildPlayableCommand(selection, view);
    expect(panelPath).toEqual({
      type: "play-card",
      instanceId: "inst-1",
      targets: [objectTarget("obj-1"), playerTarget("player-2")]
    });
    expect(appPath).toEqual(panelPath);
  });

  it("exposes the policy key vocabulary used by the UI", () => {
    expect(commandTargetKey(objectTarget("obj-1"))).toBe("object:obj-1");
    expect(commandTargetKey(playerTarget("player-2"))).toBe("player:player-2");
    expect(
      buildAuthoritativeTargets(
        ["object:obj-1"],
        policy([objectTarget("obj-1")], 1, 1)
      )
    ).toEqual([objectTarget("obj-1")]);
    expect(
      buildAuthoritativeTargets([], policy([objectTarget("obj-1")], 1, 1))
    ).toBeNull();
  });
});

describe("authoritative read-only states", () => {
  it("goes read-only when the action version is stale", () => {
    const options = makeOptions(
      [
        action({
          id: "play:inst-1",
          command: { type: "play-card", instanceId: "inst-1" },
          targetPolicy: policy([objectTarget("obj-1")], 1, 1)
        })
      ],
      { stateVersion: 6 }
    );
    const view = makeView(options);
    const entry = deriveLegalActions(view)[0];
    expect(entry).toMatchObject({
      disabled: true,
      ready: false,
      reason: "动作投影已过期"
    });
    expect(
      buildSubmissionFromSelection(
        { actionId: "play:inst-1", cardId: "inst-1", targetIds: ["object:obj-1"] },
        view
      )
    ).toBeNull();
    expect(deriveConcedeAction(view)).toMatchObject({
      enabled: false,
      reason: "动作投影已过期"
    });
  });

  it("goes read-only when the action options address another viewer", () => {
    const view = makeView(
      makeOptions([action({ id: "pass", command: { type: "pass" } })], {
        viewerPlayerId: "player-2"
      })
    );
    const entry = deriveLegalActions(view)[0];
    expect(entry).toMatchObject({
      disabled: true,
      reason: "动作投影不属于当前玩家"
    });
    expect(
      buildSubmissionFromSelection(
        { actionId: "pass", cardId: null, targetIds: [] },
        view
      )
    ).toBeNull();
    // The server itself would emit no actions for a spectator viewer.
    const spectator = makeView(makeOptions([], { viewerPlayerId: null }));
    expect(deriveLegalActions(spectator)).toEqual([]);
    expect(buildSubmissionFromSelection(emptySelection, spectator)).toBeNull();
    expect(deriveConcedeAction(spectator)).toMatchObject({ enabled: false });
  });
});

describe("authoritative disabled actions", () => {
  it("respects a judge-required block from the server", () => {
    const options = makeOptions([
      action({
        id: "play:inst-1",
        command: { type: "play-card", instanceId: "inst-1" },
        targetPolicy: policy([objectTarget("obj-1")], 1, 1),
        enabled: false,
        blockedReason: "judge-required"
      })
    ]);
    const view = makeView(options);
    const entry = deriveLegalActions(view)[0];
    expect(entry).toMatchObject({
      disabled: true,
      ready: false,
      reason: "该能力需要裁决，暂不支持自动结算"
    });
    expect(
      buildSubmissionFromSelection(
        { actionId: "play:inst-1", cardId: "inst-1", targetIds: ["object:obj-1"] },
        view
      )
    ).toBeNull();

    const html = renderToStaticMarkup(
      <PromptActionPanel
        view={view}
        selection={{ actionId: "play:inst-1", cardId: "inst-1", targetIds: [] }}
        onSelectionChange={() => {}}
        onSubmit={() => {}}
      />
    );
    expect(html).toContain("该能力需要裁决，暂不支持自动结算");
    expect(html).toContain('disabled=""');
  });

  it("never turns an unmodeled card into an executable play action", () => {
    // A card without a modeled primary type stays out of the server list; the
    // client must not synthesize it from playableInstanceIds.
    const options = makeOptions([
      action({
        id: "play:inst-3",
        command: { type: "play-card", instanceId: "inst-3" },
        targetPolicy: policy([], 0, 0),
        enabled: false,
        blockedReason: "unmodeled-card"
      })
    ]);
    const view = makeView(options);
    const ids = deriveLegalActions(view).map(entry => entry.id);
    expect(ids).toEqual(["play:inst-3"]);
    expect(
      buildSubmissionFromSelection(
        { actionId: "play:inst-3", cardId: "inst-3", targetIds: [] },
        view
      )
    ).toBeNull();
    expect(ids).not.toContain("play:inst-1");
    expect(ids).not.toContain("play:inst-2");
  });
});

describe("authoritative submission guards", () => {
  const options = () => makeOptions([
    action({ id: "play:inst-1", command: { type: "play-card", instanceId: "inst-1" } }),
    action({ id: "pass", command: { type: "pass" } })
  ]);
  const selection: ActionSelection = { actionId: "play:inst-1", cardId: "inst-1", targetIds: [] };

  it("blocks direct submission while disconnected, pending or ended", () => {
    for (const view of [
      makeView(options(), { connectionStatus: "disconnected" }),
      makeView(options(), { commandPending: true }),
      makeView(options(), { projection: makeProjection(options(), { phase: "ended" }) })
    ]) {
      expect(deriveLegalActions(view).every(entry => entry.disabled)).toBe(true);
      expect(buildSubmissionFromSelection(selection, view)).toBeNull();
      expect(buildPlayableCommand(selection, view)).toBeNull();
    }
  });

  it("binds a submitted play action to the selected instance", () => {
    const view = makeView(options());
    expect(buildSubmissionFromSelection({ ...selection, cardId: "inst-2" }, view)).toBeNull();
    expect(buildSubmissionFromSelection({ ...selection, cardId: null }, view)).toBeNull();
    expect(buildSubmissionFromSelection({ ...selection, actionId: "pass", targetIds: ["object:obj-1"] }, view)).toBeNull();
  });

  it("keeps an unknown action contract read-only without using legacy mappings", () => {
    const unsupported = { ...options(), contract: "unknown.actions.v9" } as unknown as ProjectionActionOptions;
    const view = makeView(unsupported);
    expect(authoritativeActionOptions(view)).toBeNull();
    expect(deriveLegalActions(view)).toEqual([]);
    expect(buildSubmissionFromSelection(selection, view)).toBeNull();
    expect(targetOptionsFor(view, selection)).toEqual([]);
    expect(deriveConcedeAction(view).enabled).toBe(false);
  });

  it("highlights only the authorized physical target and renders all public zones", () => {
    const targeted = makeOptions([
      action({
        id: "play:inst-1", command: { type: "play-card", instanceId: "inst-1" },
        targetPolicy: policy([objectTarget("obj-1")], 1, 1)
      })
    ]);
    const view = makeView(targeted);
    const html = renderToStaticMarkup(<BoardZones
      view={view} selectedActionId="play:inst-1" selectedCardId="inst-1"
      selectedTargetIds={["object:obj-1"]} onSelectCard={() => {}} onSelectTarget={() => {}}
    />);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Card card-alpha/);
    expect(html).toMatch(/disabled=""[^>]*aria-pressed="false"[^>]*>Card card-beta/);
    expect(html).toContain('aria-label="基地"');
    expect(html).toContain('aria-label="英雄"');
    expect(html).toContain('aria-label="传说"');
  });
});

describe("authoritative concede allowance", () => {
  it("concedes while the opponent holds a prompt when the server allows it", () => {
    const options = makeOptions([
      action({ id: "concede", command: { type: "concede" } })
    ]);
    const view = makeView(options, {
      projection: makeProjection(options, {
        prompt: {
          id: "prompt-9",
          ownerPlayerId: "player-2",
          playerId: "player-2",
          stateVersion: 1,
          status: "pending",
          taskId: "task-9",
          reason: "choose-target",
          optional: false,
          options: [{ id: "resolve", label: "确认" }]
        },
        waitingForPlayerId: "player-2"
      })
    });
    expect(deriveConcedeAction(view)).toEqual({ enabled: true });
    // concede is a standalone control, not a panel action.
    expect(deriveLegalActions(view).map(entry => entry.id)).toEqual([]);
  });

  it("blocks concede when the server withholds it or the socket is down", () => {
    const disabled = makeView(
      makeOptions([
        action({
          id: "concede",
          command: { type: "concede" },
          enabled: false,
          blockedReason: "spectator"
        })
      ])
    );
    expect(deriveConcedeAction(disabled)).toMatchObject({
      enabled: false,
      reason: "spectator"
    });

    const allowed = makeView(
      makeOptions([action({ id: "concede", command: { type: "concede" } })])
    );
    expect(
      deriveConcedeAction({ ...allowed, connectionStatus: "disconnected" })
    ).toMatchObject({ enabled: false, reason: "断线只读" });
    expect(
      deriveConcedeAction({ ...allowed, commandPending: true })
    ).toMatchObject({ enabled: false, reason: "上一条命令确认中" });
  });
});

describe("authoritative panel rendering", () => {
  it("renders server actions and only enables submit once the policy is satisfied", () => {
    const options = makeOptions([
      action({
        id: "play:inst-1",
        command: { type: "play-card", instanceId: "inst-1" },
        targetPolicy: policy([objectTarget("obj-1")], 1, 1)
      })
    ]);
    const view = makeView(options);
    const incomplete: ActionSelection = {
      actionId: "play:inst-1",
      cardId: "inst-1",
      targetIds: []
    };
    const incompleteHtml = renderToStaticMarkup(
      <PromptActionPanel
        view={view}
        selection={incomplete}
        onSelectionChange={() => {}}
        onSubmit={() => {}}
      />
    );
    expect(incompleteHtml).toContain("选择目标");
    expect(incompleteHtml).toContain('disabled=""');

    const complete: ActionSelection = {
      ...incomplete,
      targetIds: ["object:obj-1"]
    };
    const completeHtml = renderToStaticMarkup(
      <PromptActionPanel
        view={view}
        selection={complete}
        onSelectionChange={() => {}}
        onSubmit={() => {}}
      />
    );
    expect(completeHtml).not.toContain('disabled=""');
  });

  it("renders the target options declared by the selected action", () => {
    const options = makeOptions([
      action({
        id: "play:inst-1",
        command: { type: "play-card", instanceId: "inst-1" },
        targetPolicy: policy([objectTarget("obj-1")], 1, 1)
      })
    ]);
    const view = makeView(options);
    const selection: ActionSelection = {
      actionId: "play:inst-1",
      cardId: "inst-1",
      targetIds: []
    };
    const options_: readonly TargetOption[] = targetOptionsFor(view, selection);
    expect(options_).toEqual([
      { id: "object:obj-1", label: "Card card-alpha", objectId: "obj-1", playerId: undefined }
    ]);
    const html = renderToStaticMarkup(
      <PromptActionPanel
        view={view}
        selection={selection}
        onSelectionChange={() => {}}
        onSubmit={() => {}}
      />
    );
    expect(html).toContain("Card card-alpha");
  });
});
