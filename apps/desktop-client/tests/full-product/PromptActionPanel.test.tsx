import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import { PromptActionPanel } from "../../src/full-product/PromptActionPanel";
import type { ActionSelection, PlayableMatchView } from "../../src/full-product/types";
import type { GameProjection } from "@riftbound/protocol";

describe("PromptActionPanel", () => {
  it("shows authority-derived legal actions and only enables submit when selection is complete", () => {
    const view = makeView({});
    const selection: ActionSelection = {
      actionId: "play:hand-1",
      cardId: "hand-1",
      targetIds: []
    };
    const html = renderToStaticMarkup(
      <PromptActionPanel view={view} selection={selection} onSelectionChange={() => {}} onSubmit={() => {}} />
    );
    expect(html).toContain("结束行动");
    expect(html).toContain("打出 Card card-1");
    expect(html).toContain("请先选择目标");
    expect(html).toContain("disabled=\"\"");
  });

  it("renders prompt options as selection rather than immediately submitting them", () => {
    const view = makeView({ prompt: true });
    const selection: ActionSelection = {
      actionId: "prompt-1:confirm",
      cardId: null,
      targetIds: []
    };
    const html = renderToStaticMarkup(
      <PromptActionPanel view={view} selection={selection} onSelectionChange={() => {}} onSubmit={() => {}} />
    );
    expect(html).toContain("确认");
    expect(html).toContain("当前动作");
  });

  it("enables prompt submission when its authority-derived action is selected", () => {
    const view = makeView({ prompt: true });
    const selection: ActionSelection = {
      actionId: "prompt-1:confirm",
      cardId: null,
      targetIds: []
    };
    const html = renderToStaticMarkup(
      <PromptActionPanel view={view} selection={selection} onSelectionChange={() => {}} onSubmit={() => {}} />
    );
    expect(html).toContain("aria-pressed=\"true\">确认</button>");
    expect(html).toContain("<button type=\"button\">提交</button>");
  });

  it("shows a read-only action panel while disconnected", () => {
    const view = makeView({ status: "disconnected" });
    const selection: ActionSelection = { actionId: "pass", cardId: null, targetIds: [] };
    const html = renderToStaticMarkup(
      <PromptActionPanel view={view} selection={selection} onSelectionChange={() => {}} onSubmit={() => {}} />
    );
    expect(html).toContain("断线只读");
    expect(html).toContain("当前棋盘只读");
  });
});

function makeView({
  status = "connected",
  prompt = false
}: {
  status?: PlayableMatchView["connectionStatus"];
  prompt?: boolean;
}): PlayableMatchView {
  return {
    connectionStatus: status,
    commandPending: false,
    viewerPlayerId: "player-1",
    resolveCardTitle: cardId => `Card ${cardId}`,
    resolveCardImage: () => null,
    targetRequirements: { "card-1": ["target"] },
    targets: {
      "card-1": [{ id: "unit-1", label: "目标单位" }]
    },
    projection: makeProjection(prompt)
  };
}

function makeProjection(prompt: boolean): GameProjection {
  return {
    version: 1,
    eventSeq: 0,
    phase: "main",
    turnNumber: 1,
    activePlayerId: "player-1",
    priority: { playerId: "player-1" },
    winnerPlayerId: null,
    prompt: prompt
      ? {
          id: "prompt-1",
          ownerPlayerId: "player-1",
          playerId: "player-1",
          stateVersion: 1,
          status: "pending",
          taskId: "task-1",
          reason: "choose",
          optional: false,
          options: [{ id: "confirm", label: "确认" }]
        }
      : null,
    waitingForPlayerId: prompt ? "player-1" : null,
    players: [
      {
        id: "player-1",
        name: "Alice",
        handCount: 1,
        hand: [{ instanceId: "hand-1", cardId: "card-1" }],
        playableInstanceIds: ["hand-1"]
      },
      { id: "player-2", name: "Bob", handCount: 0, hand: [], playableInstanceIds: [] }
    ],
    events: []
  };
}
