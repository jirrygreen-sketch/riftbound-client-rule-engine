import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import {
  DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1,
  isDuelProjectionV3Actions1,
  type DuelProjectionV3Actions1
} from "@riftbound/protocol";
import { DuelMatchBoard } from "../../src/full-product/DuelMatchBoard";

const fixtures = JSON.parse(readFileSync(fileURLToPath(new URL(
  "../../../../packages/protocol/test/fixtures/duel-v2-projection.json", import.meta.url
)), "utf8")) as Record<string, Record<string, unknown>>;

function p4HandProjection(): DuelProjectionV3Actions1 {
  const source = structuredClone(fixtures.changed!.p1) as {
    projectionSchema: string;
    viewerPlayerId: string | null;
    match: {
      schemaVersion: number;
      players: { playerId: string; legend: { cardId: string }; hand?: { uid: string; cardId: string }[] }[];
      board: { units: unknown[]; gears?: unknown[] };
      frame: Record<string, unknown>;
    };
    actions: unknown[];
  };
  source.projectionSchema = DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1;
  source.match.schemaVersion = 3;
  for (const player of source.match.players) {
    player.legend = { cardId: player.legend.cardId, controllerPlayerId: player.playerId, readiness: "ready" } as never;
  }
  source.match.board.units = [];
  source.match.board.gears = [];
  source.match.frame.chain = { active: false };
  source.match.frame.pendingChoice = null;
  source.match.frame.execution = { status: "ready" };
  const hand = source.match.players.find(player => player.playerId === "p1")?.hand ?? [];
  source.actions = hand.length === 0 ? [] : [{
    id: "play-own-card",
    kind: "play-card",
    label: "施放",
    enabled: true,
    cardUID: hand[0]!.uid,
    windowId: "window-1"
  }];
  const projection = source as unknown as DuelProjectionV3Actions1;
  expect(isDuelProjectionV3Actions1(projection)).toBe(true);
  return projection;
}

function render(projection: DuelProjectionV3Actions1): string {
  return renderToStaticMarkup(
    <DuelMatchBoard
      projection={projection}
      connectionStatus="connected"
      commandPending={false}
      onCommand={() => {}}
      resolveCardTitle={cardId => cardId}
    />
  );
}

describe("DuelMatchBoard direct card interaction surface", () => {
  it("marks only the viewer hand with an actionable UID surface", () => {
    const projection = p4HandProjection();
    const ownHand = projection.match.stage === "playing"
      ? projection.match.players.find(player => player.playerId === "p1")?.hand ?? []
      : [];
    const ownUID = ownHand[0]?.uid;
    expect(ownUID).toBeTruthy();
    const html = render(projection);
    expect(html).toContain(`data-card-zone="hand"`);
    expect(html).toContain(`data-card-uid="${ownUID}"`);
    expect(html).toContain("更多操作");
  });

  it("keeps the opponent hand concealed and leaves global actions compact", () => {
    const html = render(p4HandProjection());
    expect(html).toContain("full-product-duel-hidden-hand");
    expect(html).toContain("full-product-duel-more-actions");
    expect(html).not.toContain('data-card-zone="opponent-hand"');
  });
});
