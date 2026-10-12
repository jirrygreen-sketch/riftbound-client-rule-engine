import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import {
  buildProjectedGameView,
  buildProjectedPlayerView,
  PROJECTION_SCHEMA_V1,
  type BoardCardInfo
} from "../src/game/projectionContract";
import { PlayerBoard } from "../src/components/PlayerBoard";
import {
  FOUNDATION_RULESET_ID,
  type GameProjection,
  type ProjectionObject
} from "@riftbound/protocol";

const handObject: ProjectionObject = {
  objectId: "instance-1",
  cardId: "card-1",
  zone: "hand",
  controllerId: "player-1",
  ownerPlayerId: "player-1",
  faceUp: true
};

const projection: GameProjection = {
  projectionSchema: PROJECTION_SCHEMA_V1,
  rulesetId: FOUNDATION_RULESET_ID,
  priority: { playerId: "player-1" },
  objects: [handObject],
  version: 1,
  eventSeq: 0,
  phase: "main",
  turnNumber: 1,
  activePlayerId: "player-1",
  winnerPlayerId: null,
  prompt: null,
  waitingForPlayerId: null,
  players: [
    {
      id: "player-1",
      name: "Alice",
      score: 7,
      energy: 3,
      power: { nature: 2 },
      zoneCounts: { hand: 1 },
      playableInstanceIds: [],
      handCount: 1,
      hand: []
    },
    {
      id: "player-2",
      name: "Bob",
      score: 0,
      energy: 1,
      power: {},
      zoneCounts: { hand: 0 },
      playableInstanceIds: [],
      handCount: 0,
      hand: []
    }
  ],
  events: []
};

describe("PlayerBoard", () => {
  it("selects without issuing a play command and only server-listed instances can be played", () => {
    const game = buildProjectedGameView(projection);
    const player = buildProjectedPlayerView(game, "player-1")!;
    const onSelectCard = vi.fn();
    const onPlayCard = vi.fn();
    const resolveCardInfo = vi.fn(
      (cardId: string): BoardCardInfo => ({
        title: `Card ${cardId}`,
        imageUrl: null,
        typeLabel: "Unit",
        implemented: true
      })
    );

    const html = renderToStaticMarkup(
      <PlayerBoard
        player={player}
        viewerPlayerId="player-1"
        sideName="我的区域"
        selectedCardId={null}
        onSelectCard={onSelectCard}
        onPlayCard={onPlayCard}
        canSelect
        isActive
        resolveCardInfo={resolveCardInfo}
      />
    );

    expect(html).toContain("Card card-1");
    expect(html).toContain("分数");
    expect(html).toContain("能量");
    expect(html).toContain("nature:2");

    // renderToStaticMarkup deliberately renders no event handlers. This test
    // asserts the playable-list contract that the App passes to PlayerBoard:
    // server-listed instances get an onPlay handler; others do not.
    expect(player.playableInstanceIds).toEqual([]);

    const playableProjection = {
      ...projection,
      players: projection.players.map(item =>
        item.id === "player-1"
          ? { ...item, playableInstanceIds: [handObject.objectId] }
          : item
      )
    };
    const playablePlayer = buildProjectedPlayerView(
      buildProjectedGameView(playableProjection),
      "player-1"
    )!;
    expect(playablePlayer.playableInstanceIds).toEqual([handObject.objectId]);
    expect(onSelectCard).not.toHaveBeenCalled();
    expect(onPlayCard).not.toHaveBeenCalled();

    const abilityCardInfo = {
      title: "Ability Card",
      imageUrl: "http://127.0.0.1:8787/api/card-images/card-ability",
      typeLabel: "Unit",
      implemented: false
    };
    const abilityCardHtml = renderToStaticMarkup(
      <PlayerBoard
        player={playablePlayer}
        viewerPlayerId="player-1"
        sideName="我的区域"
        selectedCardId={null}
        canSelect
        isActive
        resolveCardInfo={() => abilityCardInfo}
      />
    );
    expect(abilityCardHtml).toContain("Ability Card");
    expect(abilityCardHtml).toContain("能力未实现 · 需裁判");
    expect(abilityCardHtml).not.toContain("点击选中 · 双击打出");
  });

});
