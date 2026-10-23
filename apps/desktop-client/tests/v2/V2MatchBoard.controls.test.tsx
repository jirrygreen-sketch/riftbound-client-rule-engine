import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import { V2MatchBoard } from "../../src/full-product/v2/V2MatchBoard";
import { createV2ChoiceUiState, createV2ClientState, type V2ClientState } from "../../src/state/v2";
import type { V2Projection } from "../../../../../packages/protocol/src/v2/index.js";

const captured = vi.hoisted(() => ({
  handlers: [] as Array<{ readonly props: Record<string, unknown> }>
}));

vi.mock("react/jsx-dev-runtime", async importOriginal => {
  const actual = await importOriginal<typeof import("react/jsx-dev-runtime")>();
  const capture = (type: unknown, props: unknown, ...rest: unknown[]) => {
    if (props && typeof props === "object") {
      const record = props as Record<string, unknown>;
      if (typeof record.onClick === "function" || typeof record.onChange === "function") {
        captured.handlers.push({ props: record });
      }
    }
    return (actual.jsxDEV as (...args: unknown[]) => unknown)(type, props, ...rest);
  };
  return { ...actual, jsxDEV: capture };
});

function projection(): V2Projection {
  return {
    projectionContract: "riftbound.protocol.v2.projection",
    protocolVersion: "2.0.0",
    rulesetVersion: "core-1.5",
    matchId: "match-v2",
    viewerPlayerId: "player-1",
    stateVersion: 9,
    eventSeq: 4,
    phase: "main",
    turnNumber: 2,
    activePlayerId: "player-1",
    players: [
      { playerId: "player-1", name: "Alice", score: 0, energy: 3, power: {}, xp: 0, handCount: 0, deckCount: 20, runeDeckCount: 10, zoneCounts: {} },
      { playerId: "player-2", name: "Bob", score: 0, energy: 1, power: {}, xp: 0, handCount: 0, deckCount: 20, runeDeckCount: 10, zoneCounts: {} }
    ],
    zones: [],
    objects: [
      { objectId: "enemy-1", zoneEntryId: 11, zone: "board", ownerPlayerId: "player-2", cardId: "enemy-1", name: "Enemy One", faceDown: false, visibility: "public", might: 3, location: { kind: "battlefield", battlefieldId: "field-1" } },
      { objectId: "enemy-2", zoneEntryId: 12, zone: "board", ownerPlayerId: "player-2", cardId: "enemy-2", name: "Enemy Two", faceDown: false, visibility: "public", might: 2, location: { kind: "battlefield", battlefieldId: "field-1" } }
    ],
    chain: { status: "closed", phase: "open", priorityPlayerId: null, focusPlayerId: null, items: [] },
    priority: { playerId: null, focusPlayerId: null, window: "open" },
    scoring: { victoryScore: 8, battlefieldLocationIds: ["field-1"], players: [
      { playerId: "player-1", points: 0, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] },
      { playerId: "player-2", points: 0, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] }
    ] },
    battlefields: [{ battlefieldId: "field-1", controllerPlayerId: "player-2", contestedByPlayerId: "player-1", staged: "combat", occupantObjectIds: ["enemy-1", "enemy-2"] }],
    combat: { status: "active", battlefieldId: "field-1", step: "damage", combatId: "combat-1",
      attackerPlayerId: "player-1", defenderPlayerId: "player-2",
      damage: { attackerMight: 5, defenderMight: 4, attackerSubmitted: false, expectedPlayerId: "player-1" } },
    actionOptions: { canEndTurn: true, canAdvance: true, moves: [], plays: [] },
    pendingChoice: { status: "none" },
    winnerPlayerId: null,
    events: []
  };
}

function state(value = projection(), connectionStatus: V2ClientState["connectionStatus"] = "connected"): V2ClientState {
  return {
    ...createV2ClientState({ viewerPlayerId: "player-1", now: 0, choiceTimeoutMs: 10_000 }),
    projection: value,
    stateVersion: value.stateVersion,
    eventSeq: value.eventSeq,
    connectionStatus,
    choice: createV2ChoiceUiState(value.pendingChoice, { viewerPlayerId: "player-1", now: 0, timeoutMs: 10_000 })
  };
}

function render(value: V2ClientState, onCommand = vi.fn(async () => ({
  type: "command-receipt" as const, protocolVersion: "2.0.0" as const, commandId: "x", stateVersion: 9,
  eventSeq: 4, accepted: true, duplicate: false, rejection: null
})), initialCombatDamageDrafts?: Readonly<Record<string, string>>): string {
  captured.handlers.length = 0;
  return renderToStaticMarkup(<V2MatchBoard state={value} onCommand={onCommand} initialCombatDamageDrafts={initialCombatDamageDrafts} />);
}

function buttonHandler(label: string): () => void {
  const button = captured.handlers.find(entry => {
    const children = entry.props.children;
    return entry.props.type === "button" && (Array.isArray(children) ? children.includes(label) : children === label);
  });
  if (!button || typeof button.props.onClick !== "function") throw new Error(`button handler not found: ${label}`);
  return button.props.onClick as () => void;
}

beforeEach(() => { captured.handlers.length = 0; });

describe("V2 board turn and combat controls", () => {
  it("shows the projected turn controls and removes rejected declarations", () => {
    const markup = render(state());
    expect(markup).toContain(">结束回合</button>");
    expect(markup).toContain(">推进</button>");
    expect(markup).not.toContain("宣告攻击");
    expect(markup).not.toContain("宣告防守");
  });

  it("emits end-turn and advance only from enabled projected controls", () => {
    const onCommand = vi.fn(async () => ({ type: "command-receipt" as const, protocolVersion: "2.0.0" as const,
      commandId: "x", stateVersion: 9, eventSeq: 4, accepted: true, duplicate: false, rejection: null }));
    render(state(), onCommand);
    buttonHandler("结束回合")();
    buttonHandler("推进")();
    expect(onCommand.mock.calls.slice(0, 2)).toEqual([[{ type: "end-turn" }], [{ type: "advance" }]]);

    const denied = projection();
    denied.actionOptions = { ...denied.actionOptions, canEndTurn: false, canAdvance: false };
    const deniedMarkup = render(state(denied));
    expect(deniedMarkup).toMatch(/<button[^>]*disabled=""[^>]*>结束回合<\/button>/u);
    expect(deniedMarkup).toMatch(/<button[^>]*disabled=""[^>]*>推进<\/button>/u);
  });

  it("hides damage controls from the non-responsible player", () => {
    const value = projection();
    if (value.combat.status !== "active" || value.combat.damage === undefined) throw new Error("fixture");
    value.combat = { ...value.combat, damage: { ...value.combat.damage, expectedPlayerId: "player-2" } };
    const markup = render(state(value));
    expect(markup).not.toContain("战斗伤害分配");
    expect(markup).not.toContain("提交战斗伤害");
  });

  it("validates damage totals and emits the exact projected combat allocation", () => {
    const onCommand = vi.fn(async () => ({ type: "command-receipt" as const, protocolVersion: "2.0.0" as const,
      commandId: "x", stateVersion: 9, eventSeq: 4, accepted: true, duplicate: false, rejection: null }));
    const incomplete = render(state(), onCommand, { "enemy-1": "4", "enemy-2": "" });
    expect(incomplete).toMatch(/<button[^>]*disabled=""[^>]*>提交战斗伤害<\/button>/u);

    render(state(), onCommand, { "enemy-1": "3", "enemy-2": "2" });
    buttonHandler("提交战斗伤害")();
    expect(onCommand).toHaveBeenCalledWith({ type: "combat-damage", combatId: "combat-1", assignments: [
      { unitObjectId: "enemy-1", amount: 3 },
      { unitObjectId: "enemy-2", amount: 2 }
    ] });
  });
});
