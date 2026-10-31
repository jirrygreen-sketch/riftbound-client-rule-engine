import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import { V2MatchBoard, v2ChoiceInstruction } from "../../src/full-product/v2/V2MatchBoard";
import { createV2ChoiceUiState, createV2ClientState, type V2ClientState } from "../../src/state/v2";
import type { V2PendingChoice, V2Projection } from "../../../../../packages/protocol/src/v2/index.js";

// RIFT-1164: the choice panel speaks Chinese and its card names preview the
// card on hover, like cards on the playmat.
const captured = vi.hoisted(() => ({
  hovers: [] as Array<{ readonly props: Record<string, unknown> }>
}));

vi.mock("react/jsx-dev-runtime", async importOriginal => {
  const actual = await importOriginal<typeof import("react/jsx-dev-runtime")>();
  const capture = (type: unknown, props: unknown, ...rest: unknown[]) => {
    if (props && typeof props === "object" && typeof (props as Record<string, unknown>).onPointerEnter === "function") {
      captured.hovers.push({ props: props as Record<string, unknown> });
    }
    return (actual.jsxDEV as (...args: unknown[]) => unknown)(type, props, ...rest);
  };
  return { ...actual, jsxDEV: capture };
});

type Pending = Extract<V2PendingChoice, { status: "pending" }>;

// The official zh_CN [预知] reminder text plus the operation hint, as the server sends it.
const VISION_PROMPT = "预知：查看主牌堆顶部的一张牌，你可以选择将其回收。选中这张牌即回收它；不选则让它留在主牌堆顶部。";

const vision: Pending = {
  status: "pending", choiceId: "vision:top", ownerPlayerId: "alice", stateVersion: 4,
  kind: "select-objects", min: 0, max: 1, prompt: VISION_PROMPT,
  source: { objectId: "forecaster-1", name: "Forecaster" },
  options: [
    { id: "top", label: "Dangerous Duo", objectRef: { objectId: "deck-top", zoneEntryId: 7 } },
    { id: "hidden", label: "hidden", objectRef: { objectId: "hidden:1", zoneEntryId: 8 } }
  ]
};

function projection(pendingChoice: V2PendingChoice): V2Projection {
  return {
    projectionContract: "riftbound.protocol.v2.projection",
    protocolVersion: "2.0.0",
    rulesetVersion: "core-1.5",
    matchId: "rift-1164-choice-hint",
    viewerPlayerId: "alice",
    stateVersion: 4,
    eventSeq: 3,
    phase: "main",
    turnNumber: 2,
    activePlayerId: "alice",
    players: [
      { playerId: "alice", name: "Alice", score: 0, energy: 1, power: {}, xp: 0, handCount: 0, deckCount: 20, runeDeckCount: 8, zoneCounts: {} },
      { playerId: "bob", name: "Bob", score: 0, energy: 0, power: {}, xp: 0, handCount: 0, deckCount: 20, runeDeckCount: 8, zoneCounts: {} }
    ],
    zones: [],
    objects: [
      { objectId: "forecaster-1", zoneEntryId: 3, zone: "base", ownerPlayerId: "alice", cardId: "sfd-065-221", name: "Forecaster",
        faceDown: false, visibility: "public", might: 2, location: { kind: "base", playerId: "alice" } },
      { objectId: "deck-top", zoneEntryId: 7, zone: "mainDeck", ownerPlayerId: "alice", cardId: "ogn-005-298", name: "Dangerous Duo",
        faceDown: false, visibility: "private", location: { kind: "zone", zone: "mainDeck", playerId: "alice" } },
      // A candidate the viewer may not identify carries no cardId.
      { objectId: "hidden:1", zoneEntryId: 8, zone: "mainDeck", ownerPlayerId: "alice", faceDown: true, visibility: "hidden",
        location: { kind: "zone", zone: "mainDeck", playerId: "alice" } }
    ],
    chain: { status: "open", phase: "await-commit", priorityPlayerId: null, focusPlayerId: null, items: [] },
    priority: { playerId: null, focusPlayerId: null, window: "choice" },
    scoring: {
      victoryScore: 8,
      battlefieldLocationIds: [],
      players: [
        { playerId: "alice", points: 0, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] },
        { playerId: "bob", points: 0, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] }
      ]
    },
    battlefields: [],
    combat: { status: "none" },
    actionOptions: { canEndTurn: false, canAdvance: false, moves: [], plays: [] },
    pendingChoice,
    winnerPlayerId: null,
    events: []
  } as V2Projection;
}

function render(value: V2Projection): string {
  const state: V2ClientState = {
    ...createV2ClientState({ viewerPlayerId: "alice", now: 0, choiceTimeoutMs: 10_000 }),
    projection: value,
    stateVersion: value.stateVersion,
    eventSeq: value.eventSeq,
    choice: createV2ChoiceUiState(value.pendingChoice, { viewerPlayerId: "alice", now: 0, timeoutMs: 10_000 })
  };
  return renderToStaticMarkup(<V2MatchBoard state={state} onCommand={async () => ({
    type: "command-receipt", protocolVersion: "2.0.0", commandId: "test", stateVersion: 5, eventSeq: 4,
    accepted: true, duplicate: false, rejection: null
  })} />);
}

function choiceSection(html: string): string {
  const start = html.indexOf('aria-label="选择请求"');
  return html.slice(start, html.indexOf("</section>", start));
}

beforeEach(() => { captured.hovers.length = 0; });

describe("RIFT-1164 choice operation hint", () => {
  it("shows a Chinese engine prompt as sent", () => {
    expect(v2ChoiceInstruction(vision)).toBe(VISION_PROMPT);
    expect(choiceSection(render(projection(vision)))).toContain(VISION_PROMPT);
  });

  it("replaces a card-authored English prompt with a Chinese hint for each choice kind", () => {
    const english = (kind: Pending["kind"], min?: number): Pending =>
      ({ ...vision, kind, prompt: "Kill a gear?", ...(min === undefined ? { min: undefined } : { min }) });
    expect(v2ChoiceInstruction(english("optional"))).toBe("是否发动这项可选效果？效果见来源卡牌说明（鼠标移到卡名上查看）。");
    expect(v2ChoiceInstruction(english("mode"))).toBe("请选择一种模式，然后点“提交选择”。");
    expect(v2ChoiceInstruction(english("select-objects", 1))).toBe("请在下方点选对象，然后点“提交选择”。鼠标移到卡名上可查看卡牌。");
    expect(v2ChoiceInstruction(english("select-objects", 0))).toBe("请在下方点选对象，也可以不选；然后点“提交选择”。鼠标移到卡名上可查看卡牌。");
    expect(v2ChoiceInstruction(english("order"))).toBe("请按期望顺序依次点击下方各项，然后点“提交选择”。");
    expect(v2ChoiceInstruction(english("number"))).toBe("请输入数值，然后点“提交选择”。");
    const html = choiceSection(render(projection(english("select-objects", 0))));
    expect(html).not.toContain("Kill a gear?");
    expect(html).toContain("也可以不选");
  });

  it("gives a choice without any prompt a Chinese hint too", () => {
    const { prompt: _omitted, ...withoutPrompt } = vision;
    expect(v2ChoiceInstruction(withoutPrompt)).toContain("请在下方点选对象");
  });
});

describe("RIFT-1164 choice card hover preview", () => {
  it("previews a visible candidate and the source card on hover, never a hidden candidate", () => {
    render(projection(vision));
    const hoverTargets = captured.hovers.map(entry => entry.props);
    const candidate = hoverTargets.find(props => props["aria-pressed"] !== undefined);
    expect(candidate).toBeDefined();
    const source = hoverTargets.find(props => props.className === "v2-choice-card");
    expect(source).toBeDefined();
    // Two choice buttons render, but only the identified one may preview.
    expect(hoverTargets.filter(props => props["aria-pressed"] !== undefined)).toHaveLength(1);
    expect(typeof candidate!.onPointerLeave).toBe("function");
  });
});
