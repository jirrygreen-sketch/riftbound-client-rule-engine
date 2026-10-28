import { describe, expect, it } from "vitest";

import { createEngineRuntime, type EngineRuntimeDeck } from "../../src/engine-runtime/index.js";
import { EngineRuntimeHost } from "../../src/engine-runtime/host.js";

function deck(seat: "A" | "B"): EngineRuntimeDeck {
  return {
    mainDeck: Array.from({ length: 32 }, (_, index) => ({
      id: `${seat}:unit:${index}`, cardId: `${seat}:unit-card`, name: `${seat} Unit ${index}`,
      types: ["unit"], energy: 0, power: null, might: 2,
    })),
    runeDeck: Array.from({ length: 12 }, (_, index) => ({
      id: `${seat}:rune:${index}`, cardId: `${seat}:rune-card`, name: "Mind Rune",
      types: ["rune"], tags: ["Basic"], energy: null, power: null, domains: ["Mind"],
    })),
    championLegend: { id: `${seat}:legend`, cardId: `${seat}:legend-card`, name: "Legend", types: ["legend"] },
    chosenChampion: { id: `${seat}:champion`, cardId: `${seat}:champion-card`, name: "Champion", types: ["champion"] },
    battlefields: [0, 1, 2].map(index => ({
      id: `${seat}:field:${index}`, cardId: `${seat}:field-card:${index}`,
      name: `Field ${index}`, types: ["battlefield"],
    })) as unknown as EngineRuntimeDeck["battlefields"],
  };
}

describe("RIFT-1103 mulligan setup path", () => {
  it("normalizes the acted Unit without recapturing the complete opening authority", () => {
    const runtime = createEngineRuntime({
      matchId: "RIFT-1103-single-snapshot", roomId: "RIFT-1103-single-snapshot",
      decks: [deck("A"), deck("B")], seed: "RIFT-1103-single-snapshot",
      firstPlayer: "A", battlefieldChoice: [1, 1], mulligans: [[], []],
    }).start();
    const host = (runtime as unknown as { readonly host: EngineRuntimeHost }).host;
    const unit = host.objects().find(object => object.owner === "A" && object.zone === "hand");
    expect(unit).toBeDefined();

    const originalObjects = EngineRuntimeHost.prototype.objects;
    let objectReads = 0;
    EngineRuntimeHost.prototype.objects = function objects() {
      objectReads += 1;
      return originalObjects.call(this);
    };
    try {
      expect(host.perform({
        type: "move-zone", object: unit!.ref, to: "base", location: { type: "base", player: "A" },
      }).status).toBe("done");
    } finally {
      EngineRuntimeHost.prototype.objects = originalObjects;
    }

    expect(objectReads).toBe(0);
    const moved = host.objects().find(object => object.ref.id === unit!.ref.id);
    expect(moved).toMatchObject({
      zone: "board", location: { type: "base", player: "A" },
    });

    const failed = host.perform({
      type: "move-zone", object: unit!.ref, to: "trash",
    });
    expect(failed.status).toBe("impossible");
    expect(host.objects().find(object => object.ref.id === unit!.ref.id)).toMatchObject({
      zone: "board", location: { type: "base", player: "A" },
    });

    const battlefield = host.objects().find(object => object.owner === "A" && object.zone === "hand");
    expect(battlefield).toBeDefined();
    let battlefieldReads = 0;
    EngineRuntimeHost.prototype.objects = function objects() {
      battlefieldReads += 1;
      return originalObjects.call(this);
    };
    try {
      expect(host.perform({
        type: "move-zone", object: battlefield!.ref, to: "battlefield",
        location: { type: "battlefield", id: "A:field:1" },
      }).status).toBe("done");
    } finally {
      EngineRuntimeHost.prototype.objects = originalObjects;
    }
    expect(battlefieldReads).toBe(0);
    expect(host.objects().find(object => object.ref.id === battlefield!.ref.id)).toMatchObject({
      zone: "board", location: { type: "battlefield", id: "A:field:1" },
    });
  });
});
