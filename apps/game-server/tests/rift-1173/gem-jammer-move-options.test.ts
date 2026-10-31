import { describe, expect, it } from "vitest";
import type { CardProgram } from "../../../../packages/card-dsl/dist/ir/index.js";
import type { V2Command, V2Projection }
  from "../../../../packages/protocol/dist/v2/index.js";
import { createEngineRuntime, type EngineRuntimeDeck }
  from "../../src/engine-runtime/index.js";

// Core Rules v1.5 (published 2026-10-09, effective 2026-10-16):
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// 144.4.c.1 and 810.1-810.3 make Ganking a Unit characteristic that adds a
// Battlefield-to-Battlefield Standard Move. The engine regression imports the
// official Gem Jammer program and proves its play-trigger grant, self-target,
// expiry, and Standard Move legality. This server regression uses the exact
// production runtime/layer path to prove the public actionOptions view.

function card(id: string, name: string, types: readonly string[],
  extra: Record<string, unknown> = {}) {
  return { id, cardId: id, name, types, tags: [], ...extra };
}

function engineDeck(seat: "A" | "B"): EngineRuntimeDeck {
  return {
    mainDeck: Array.from({ length: 12 }, (_, index) => card(
      `${seat}:unit:${index}`, "Ready Unit", ["unit"],
      { cardId: `${seat}:unit-card`, energy: 0, power: null, might: 3, domains: ["Fury"] },
    )),
    runeDeck: Array.from({ length: 12 }, (_, index) => card(
      `${seat}:rune:${index}`, "Fury Rune", ["rune"],
      { cardId: `${seat}:rune-card`, tags: ["Basic"], energy: null, power: null, domains: ["Fury"] },
    )),
    championLegend: card(`${seat}:legend`, "Legend", ["legend"],
      { cardId: `${seat}:legend-card`, energy: null, power: null }),
    chosenChampion: card(`${seat}:champion`, "Champion", ["champion"],
      { cardId: `${seat}:champion-card`, energy: null, power: null }),
    battlefields: [0, 1, 2].map(index => card(
      `${seat}:field:${index}`, `Field ${index}`, ["battlefield"],
      { cardId: `${seat}:field-card:${index}`, energy: null, power: null },
    )) as unknown as EngineRuntimeDeck["battlefields"],
  };
}

function programs(): readonly CardProgram[] {
  return (["A", "B"] as const).flatMap(seat => [
    {
      canonicalCardId: `${seat}:unit-card`, rulesetVersion: "core-1.5" as const,
      status: "executable" as const, sourceText: "RIFT-1173 ready Unit",
      abilities: [{
        kind: "play" as const,
        cost: { energy: { kind: "constant" as const, value: 0 } },
        body: [],
      }],
    },
    ...[`${seat}:rune-card`, `${seat}:legend-card`, `${seat}:champion-card`,
      ...[0, 1, 2].map(index => `${seat}:field-card:${index}`)].map(canonicalCardId => ({
      canonicalCardId, rulesetVersion: "core-1.5" as const,
      status: "no-ability" as const, sourceText: "RIFT-1173 fixture",
      abilities: [],
    })),
  ]);
}

function command<T extends V2Command["type"]>(type: T, commandId: string,
  stateVersion: number,
  fields: Omit<Extract<V2Command, { readonly type: T }>, "type" | "commandId" | "stateVersion">): V2Command {
  return { type, commandId, stateVersion, ...fields } as V2Command;
}

function ownedHand(view: V2Projection) {
  return view.zones.find(zone => zone.zone === "hand" &&
    zone.ownerPlayerId === view.viewerPlayerId)?.objects ?? [];
}

function readyRunes(view: V2Projection) {
  return (view.zones.find(zone => zone.zone === "rune-zone" &&
    zone.ownerPlayerId === view.viewerPlayerId)?.objects ?? [])
    .filter(rune => rune.exhausted === false && rune.zoneEntryId !== undefined);
}

describe("RIFT-1173 effective Ganking action options", () => {
  it("projects and accepts the granted Battlefield-to-Battlefield move", () => {
    const runtime = createEngineRuntime({
      matchId: "RIFT-1173-effective-ganking",
      roomId: "RIFT-1173-effective-ganking",
      decks: [engineDeck("A"), engineDeck("B")],
      seed: "RIFT-1173-effective-ganking",
      firstPlayer: "A",
      battlefieldChoice: [0, 0],
      programs: programs(),
    }).start();

    let view = runtime.projectFor("A");
    const rune = readyRunes(view)[0]!;
    const charged = runtime.submit("A", command("rune-energy", "charge", view.stateVersion, {
      runeObjectId: rune.objectId,
      zoneEntryId: rune.zoneEntryId!,
    }));
    expect(charged.receipt.status, JSON.stringify(charged.receipt)).toBe("accepted");
    view = charged.projection;
    const unit = ownedHand(view)[0]!;
    const played = runtime.submit("A", command("play", "play-unit", view.stateVersion, {
      cardObjectId: unit.objectId,
      destination: { kind: "base", playerId: "A" },
    }));
    expect(played.receipt.status, JSON.stringify(played.receipt)).toBe("accepted");
    for (let index = 0; index < 8 && runtime.projectFor(null).chain.items.length; index += 1) {
      const current = runtime.projectFor(null);
      const actor = current.chain.priorityPlayerId ?? current.priority.playerId;
      expect(actor).not.toBeNull();
      runtime.submit(actor!, command("pass", `settle-${index}`, current.stateVersion, {}));
    }
    // A Unit normally enters exhausted. Complete both turns so the actual
    // Awaken step readies the same incarnation before its Standard Move.
    for (let index = 0; index < 2; index += 1) {
      const current = runtime.projectFor(null);
      const ended = runtime.submit(current.activePlayerId,
        command("end-turn", `ready-turn-${index}`, current.stateVersion, {}));
      expect(ended.receipt.status, JSON.stringify(ended.receipt)).toBe("accepted");
    }

    view = runtime.projectFor("A");
    const boardUnit = view.objects.find(object => object.objectId === unit.objectId)!;
    const field = view.battlefields.find(candidate => candidate.controllerPlayerId === null)!;
    const entered = runtime.submit("A", command("move", "move-unit-to-field",
      view.stateVersion, {
        objectId: boardUnit.objectId,
        to: { zone: "battlefield", locationId: field.battlefieldId },
      }));
    expect(entered.receipt.status, JSON.stringify(entered.receipt)).toBe("accepted");
    for (let index = 0; runtime.projectFor(null).combat.status !== "none" ||
      runtime.projectFor(null).chain.items.length > 0; index += 1) {
      expect(index).toBeLessThan(24);
      const current = runtime.projectFor(null);
      if (current.actionOptions.canAdvance) {
        runtime.submit(current.activePlayerId,
          command("advance", `field-combat-${index}`, current.stateVersion, {}));
      } else {
        const actor = current.chain.priorityPlayerId ?? current.priority.playerId;
        expect(actor).not.toBeNull();
        const passed = runtime.submit(actor!,
          command("pass", `field-combat-pass-${index}`, current.stateVersion, {}));
        expect(passed.receipt.status, JSON.stringify(passed.receipt)).toBe("accepted");
      }
    }
    for (let index = 0; index < 2; index += 1) {
      const current = runtime.projectFor(null);
      if (current.phase !== "main" || current.chain.items.length > 0) continue;
      const ended = runtime.submit(current.activePlayerId,
        command("end-turn", `post-field-ready-${index}`, current.stateVersion, {}));
      expect(ended.receipt.status, JSON.stringify(ended.receipt)).toBe("accepted");
    }
    for (let index = 0; index < 8 && runtime.projectFor(null).chain.items.length; index += 1) {
      const current = runtime.projectFor(null);
      const actor = current.chain.priorityPlayerId ?? current.priority.playerId;
      if (actor !== null) runtime.submit(actor,
        command("pass", `post-ready-pass-${index}`, current.stateVersion, {}));
    }
    view = runtime.projectFor("A");
    const atField = view.objects.find(object =>
      object.objectId === unit.objectId && object.exhausted === false)!;
    expect(atField).toBeDefined();

    // Gem Jammer's production triggered body registers this exact keyword grant.
    // Applying it to the same live registry exercises dynamic reexpansion.
    const grant = {
      id: "RIFT-1173-gem-jammer-ganking-grant",
      layer: "ability" as const,
      source: { id: atField.objectId, zoneEntryId: atField.zoneEntryId! },
      filter: { objectId: atField.objectId, zoneEntryId: atField.zoneEntryId },
      effect: {
        kind: "continuous.grant-keyword",
        keyword: "Ganking",
        condition: () => true,
      },
    };
    const chain = (runtime as unknown as {
      match: { flow: { chain: { layers: { addContinuous: (...args: unknown[]) => unknown } } } };
    }).match.flow.chain;
    chain.layers.addContinuous(grant, { type: "permanent" });
    const effective = runtime.projectFor("A");
    const otherField = effective.battlefields.find(candidate =>
      candidate.battlefieldId !== field.battlefieldId)!;
    const offered = effective.actionOptions.moves.find(option =>
      option.objectId === unit.objectId && option.destination.kind === "battlefield" &&
      option.destination.battlefieldId === otherField.battlefieldId);
    expect(offered, JSON.stringify(effective.actionOptions.moves)).toBeDefined();

    const moved = runtime.submit("A", command("move", "ganking-battlefield-move",
      effective.stateVersion, {
        objectId: unit.objectId,
        to: { zone: "battlefield", locationId: otherField.battlefieldId },
      }));
    expect(moved.receipt.status, JSON.stringify(moved.receipt)).toBe("accepted");
    expect(moved.projection.objects.find(object => object.objectId === unit.objectId))
      .toMatchObject({
        zone: "board", exhausted: true,
        location: { kind: "battlefield", battlefieldId: otherField.battlefieldId },
      });
  }, 120_000);
});
