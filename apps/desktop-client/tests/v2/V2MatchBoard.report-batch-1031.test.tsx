import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import {
  V2MatchBoard,
  v2ChoiceInstruction,
  v2IsTriggerOrderChoice,
  v2TriggerOrderOptionLabel
} from "../../src/full-product/v2/V2MatchBoard";
import { buildCardNameIndex } from "../../src/full-product/v2/card-names";
import { officialKeywordName } from "../../src/full-product/v2/keyword-names";
import { createV2ChoiceUiState, createV2ClientState, type V2ClientState } from "../../src/state/v2";
import type { CatalogCard } from "../../src/net/CardCatalogClient";
import type { V2PendingChoice, V2Projection } from "../../../../../packages/protocol/src/v2/index.js";

// Player reports from room b0dd7361 on 2026-10-31.
type Pending = Extract<V2PendingChoice, { status: "pending" }>;

const rumble = {
  id: "sfd-089-221", name: "Rumble", localizedName: "兰博", cardType: "Unit", domains: ["Fury"],
  energy: 5, power: 1, might: 4, imageUrl: "https://example.test/rumble.png"
} as unknown as CatalogCard;
const names = buildCardNameIndex([rumble]);

const order: Pending = {
  status: "pending", choiceId: "trigger:688:A:order:0", ownerPlayerId: "alice", stateVersion: 45, kind: "mode",
  options: [
    { id: "program:token:12:3:0", label: "Rumble · Vision", value: "program:token:12:3:0" },
    { id: "program:token:14:5:0", label: "program:token:14:5:0", value: "program:token:14:5:0" }
  ]
};

function projection(pendingChoice: V2PendingChoice, objects: V2Projection["objects"] = []): V2Projection {
  return {
    projectionContract: "riftbound.protocol.v2.projection",
    protocolVersion: "2.0.0",
    rulesetVersion: "core-1.5",
    matchId: "rift-report-batch-1031",
    viewerPlayerId: "alice",
    stateVersion: 45,
    eventSeq: 3,
    phase: "main",
    turnNumber: 4,
    activePlayerId: "alice",
    players: [
      { playerId: "alice", name: "Alice", score: 0, energy: 1, power: {}, xp: 0, handCount: 0, deckCount: 20, runeDeckCount: 8, zoneCounts: {} },
      { playerId: "bob", name: "Bob", score: 0, energy: 0, power: {}, xp: 0, handCount: 0, deckCount: 20, runeDeckCount: 8, zoneCounts: {} }
    ],
    zones: [],
    objects,
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

function render(value: V2Projection, catalog: readonly CatalogCard[] = [rumble]): string {
  const state: V2ClientState = {
    ...createV2ClientState({ viewerPlayerId: "alice", now: 0, choiceTimeoutMs: 10_000 }),
    projection: value,
    stateVersion: value.stateVersion,
    eventSeq: value.eventSeq,
    choice: createV2ChoiceUiState(value.pendingChoice, { viewerPlayerId: "alice", now: 0, timeoutMs: 10_000 })
  };
  return renderToStaticMarkup(<V2MatchBoard state={state} initialCatalogCards={catalog} onCommand={async () => ({
    type: "command-receipt", protocolVersion: "2.0.0", commandId: "test", stateVersion: 46, eventSeq: 4,
    accepted: true, duplicate: false, rejection: null
  })} />);
}

describe("RIFT-1170 trigger order choice explains itself", () => {
  it("recognises only the engine's trigger-order request", () => {
    expect(v2IsTriggerOrderChoice(order)).toBe(true);
    expect(v2IsTriggerOrderChoice({ ...order, choiceId: "fiora:mode" })).toBe(false);
    expect(v2IsTriggerOrderChoice({ ...order, kind: "select-objects" })).toBe(false);
  });

  it("says which pick goes on the Chain first and that it resolves later", () => {
    expect(v2ChoiceInstruction(order)).toBe(
      "多个效果同时触发：请选出先放上连锁的那一个（连锁上越晚放上的越先结算），剩下的会继续让你选。");
  });

  it("shows the official Chinese card and keyword names on the options", () => {
    expect(v2TriggerOrderOptionLabel(names, "Rumble · Vision")).toBe("兰博 · 预知");
    expect(v2TriggerOrderOptionLabel(names, "Rumble · Vision (trigger 2)")).toBe("兰博 · 预知（第 2 个）");
    // An unattested keyword stays in English instead of being translated here.
    expect(v2TriggerOrderOptionLabel(names, "Rumble · Hunt")).toBe("兰博 · Hunt");
    // An unreadable option keeps the raw engine token.
    expect(v2TriggerOrderOptionLabel(names, "program:token:14:5:0")).toBe("program:token:14:5:0");
    const html = render(projection(order));
    expect(html).toContain(">兰博 · 预知</button>");
    expect(html).toContain("多个效果同时触发");
  });

  it("keeps the official keyword table to attested names only", () => {
    expect(officialKeywordName("Vision")).toBe("预知");
    expect(officialKeywordName("quick-draw")).toBe("灵便");
    expect(officialKeywordName("Hunt")).toBeUndefined();
  });
});

describe("RIFT-1176 board Might badge shows the change from the printed value", () => {
  const unit = (might: number): V2Projection["objects"][number] => ({
    objectId: "rumble-1", zoneEntryId: 2, zone: "board", ownerPlayerId: "alice", cardId: "sfd-089-221", name: "Rumble",
    faceDown: false, visibility: "public", might, location: { kind: "base", playerId: "alice" }
  } as V2Projection["objects"][number]);

  it("marks a raised current Might and keeps an unchanged one plain", () => {
    const raised = render(projection({ status: "none" }, [unit(5)]));
    expect(raised).toContain('class="v2m-might is-up"');
    expect(raised).toContain('title="印刷战力 4，当前 5"');
    expect(raised).toContain("<em>+1</em>");
    const plain = render(projection({ status: "none" }, [unit(4)]));
    expect(plain).toContain('class="v2m-might"');
    expect(plain).not.toContain("is-up");
  });

  it("marks a lowered current Might", () => {
    expect(render(projection({ status: "none" }, [unit(2)]))).toContain('class="v2m-might is-down"');
  });
});

describe("RIFT-1175 an effect-created Mech token reads 机器人 with a token face", () => {
  it("names the token in Chinese and draws a placeholder instead of missing art", () => {
    const token = {
      objectId: "token:31", zoneEntryId: 1, zone: "board", ownerPlayerId: "alice", name: "Mech",
      faceDown: false, visibility: "public", might: 3, location: { kind: "base", playerId: "alice" }
    } as V2Projection["objects"][number];
    const html = render(projection({ status: "none" }, [token]));
    expect(html).toContain('title="机器人（衍生物，官方图库没有卡图）"');
    expect(html).toContain("<b>机器人</b><small>衍生物</small>");
    expect(html).not.toContain(">Mech<");
  });
});
