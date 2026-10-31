import { describe, expect, it } from "vitest";

import type { ChainEngine } from "../../../../packages/engine-core/dist/chain/engine.js";
import { staticCostSources } from "../../../../packages/engine-core/dist/programs/static-adapters/capabilities.js";
import type { EngineRuntimeHost } from "../../src/engine-runtime/host.js";
import {
  PLAYER_1,
  PLAYER_2,
  accepted,
  commandId,
  fundEnergy,
  nextOwnMain,
  openMain,
  ownedHand,
  projection,
  settle,
  settlePlay,
  startRoom,
} from "../rift-1177/helpers.js";

// Official evidence:
// - Core Rules v1.5, published 2026-10-09 and effective 2026-10-16:
//   https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
//   185.3.a tokens have no printed cost; 186.1 tokens can exist only on the
//   Board or Chain; 190.6 controls a Battlefield's abilities; 356.4 applies
//   discounts from any card; 420.4.b checks card-play conditions after Finalize.
// - Ornn's Forge (sfd-213-221), zh_CN gallery read 2026-10-31:
//   https://content.publishing.riotgames.com/publishing-content/v2.0/public/channel/riftbound_website/list/riftbound_gallery_cards?locale=zh_CN
//   The first friendly non-token Gear played each turn costs 1 Energy less.
describe("RIFT-1181 Ornn's Forge real-room cost collection", () => {
  it("feeds the setup Battlefield capability into Finalize for one discounted Gear", async () => {
    const started = await startRoom("RIFT-1177-seed-27", "fiora-sfd", "rumble-sfd", 0);
    const opening = openMain(started, PLAYER_1);
    fundEnergy(started, PLAYER_1, 2, "forge-gear");
    const rookie = ownedHand(projection(started, PLAYER_1), PLAYER_1).find(object => object.name === "Pit Rookie");
    expect(rookie).toBeDefined();
    accepted(started, PLAYER_1, {
      type: "play", commandId: commandId("forge-rookie-play"),
      stateVersion: projection(started, PLAYER_1).stateVersion,
      cardObjectId: rookie!.objectId,
      destination: { kind: "base", playerId: PLAYER_1 },
    });
    settlePlay(started, PLAYER_1, "forge-rookie");
    const conquestTurn = nextOwnMain(started, PLAYER_1, opening.turnNumber);
    const forge = conquestTurn.objects.find(object => object.name === "Ornn's Forge" && object.zone === "board");
    expect(forge).toBeDefined();
    if (forge?.location?.kind !== "battlefield") throw new Error("Ornn's Forge has no battlefield location");
    accepted(started, PLAYER_1, {
      type: "move", commandId: commandId("forge-conquer"), stateVersion: conquestTurn.stateVersion,
      objectId: rookie!.objectId,
      to: { zone: "battlefield", locationId: forge.location.battlefieldId },
    });
    for (let index = 0; index < 12; index += 1) {
      const view = projection(started, PLAYER_1);
      if (view.pendingChoice.status === "pending" ||
          view.chain.focusPlayerId === null && view.chain.items.length === 0) break;
      const actor = [PLAYER_1, PLAYER_2].find(playerId =>
        projection(started, playerId).actionOptions.canPass === true) ??
        view.chain.focusPlayerId ?? view.chain.priorityPlayerId;
      if (actor === null) throw new Error("Missing Showdown actor");
      accepted(started, actor, {
        type: "pass", commandId: commandId(`forge-conquer-pass-${index}`), stateVersion: view.stateVersion,
      });
    }
    settle(started, PLAYER_1, "forge-conquer");
    expect(projection(started, PLAYER_1).pendingChoice).toEqual({ status: "none" });
    expect(projection(started, PLAYER_1).battlefields.find(field =>
      field.battlefieldId === forge.location.battlefieldId)?.controllerPlayerId).toBe(PLAYER_1);

    const runtime = (started.room as unknown as {
      readonly engineRuntime: {
        readonly match: { readonly flow: { readonly chain: ChainEngine } };
        readonly host: EngineRuntimeHost;
      };
    }).engineRuntime;
    const chain = runtime.match.flow.chain;
    chain.layers.setObjects(runtime.host.objects());
    const sources = staticCostSources(chain);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.source).toEqual({ id: forge.objectId, zoneEntryId: forge.zoneEntryId });
    expect(sources[0]?.ability.effect).toMatchObject({
      kind: "cost.modify",
      value: { kind: "constant", value: { energy: -1 } },
      duration: "per-turn-first-play",
      filter: { type: "gear", controller: "controller", isToken: false },
    });

    const finalizedPlans: { readonly source: string; readonly cardId: string | undefined; readonly isToken: boolean | undefined;
      readonly energy: number; readonly discounts: number }[] = [];
    const watchedSources = new Set<string>();
    const finalize = chain.finalize.bind(chain);
    chain.finalize = item => {
      finalize(item);
      if (item.costPlan === undefined || !watchedSources.has(item.source.ref.id)) return;
      finalizedPlans.push({
        source: item.source.ref.id,
        cardId: item.source.cardId ?? undefined,
        isToken: item.source.isToken,
        energy: item.costPlan.total.energy,
        discounts: item.costPlan.discounts.length,
      });
    };
    try {
      fundEnergy(started, PLAYER_1, 4, "forge-play-gears");
      const hand = ownedHand(projection(started, PLAYER_1), PLAYER_1);
      const armor = hand.find(object => object.name === "Warmog's Armor");
      const blade = hand.find(object => object.name === "Doran's Blade");
      expect(armor).toBeDefined();
      expect(blade).toBeDefined();
      watchedSources.add(armor!.objectId);
      watchedSources.add(blade!.objectId);
      accepted(started, PLAYER_1, {
        type: "play", commandId: commandId("forge-first-gear"),
        stateVersion: projection(started, PLAYER_1).stateVersion,
        cardObjectId: armor!.objectId,
        destination: { kind: "base", playerId: PLAYER_1 },
      });
      settlePlay(started, PLAYER_1, "forge-first-gear");
      expect(projection(started, PLAYER_1).players.find(player =>
        player.playerId === PLAYER_1)?.energy).toBe(4);
      accepted(started, PLAYER_1, {
        type: "play", commandId: commandId("forge-second-gear"),
        stateVersion: projection(started, PLAYER_1).stateVersion,
        cardObjectId: blade!.objectId,
        destination: { kind: "base", playerId: PLAYER_1 },
      });
      settlePlay(started, PLAYER_1, "forge-second-gear");
      expect(projection(started, PLAYER_1).players.find(player =>
        player.playerId === PLAYER_1)?.energy).toBe(2);
      expect(finalizedPlans).toEqual([
        { source: armor!.objectId, cardId: armor!.cardId, isToken: true, energy: 0, discounts: 1 },
        { source: blade!.objectId, cardId: blade!.cardId, isToken: true, energy: 2, discounts: 0 },
      ]);
    } finally {
      chain.finalize = finalize;
    }
  }, 180_000);
});
