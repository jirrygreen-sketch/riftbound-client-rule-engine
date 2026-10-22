import { describe, expect, it } from "vitest";
import { EngineRuntimeHost } from "../../src/engine-runtime/host.js";

function host() {
  return new EngineRuntimeHost({ A: "A", B: "B" }, request => {
    throw new Error(`Unexpected choice ${request.id}`);
  });
}

const championLegend = {
  cardId: "champion-legend",
  name: "Champion Legend",
  types: ["legend"],
  tags: [],
  keywords: [],
  might: null,
  energy: null,
  power: null,
  championLegend: true as const,
};

describe("RIFT-891 runtime Legend Zone", () => {
  it("creates setup Legends in the public Legend Zone", () => {
    const state = host();
    const outcome = state.perform({ type: "create-token", player: "A", token: championLegend, to: "legend" });
    expect(outcome.status).toBe("done");
    const created = state.objects().find(object => object.cardId === championLegend.cardId)!;
    expect(created).toMatchObject({ zone: "legend", location: null, isToken: true });
    expect(state.zoneObjects("A", "legend").map(object => object.ref.id)).toEqual([created.ref.id]);
  });

  it("keeps a setup Champion Legend through every primitive departure", () => {
    const state = host();
    const created = state.perform({ type: "create-token", player: "A", token: championLegend, to: "legend" }).result as { id: string; zoneEntryId: number };
    const ref = { id: created.id, zoneEntryId: created.zoneEntryId };
    const checkpoint = state.checkpoint();
    state.restore(checkpoint);
    for (const action of [
      { type: "move-zone" as const, object: ref, to: "banishment" as const },
      { type: "banish" as const, object: ref },
      { type: "kill" as const, object: ref },
      { type: "return-to-hand" as const, object: ref },
      { type: "discard" as const, object: ref },
      { type: "recycle" as const, object: ref },
    ]) {
      expect(state.perform(action).status).toBe("prevented");
      expect(state.object(ref)).toMatchObject({ zone: "legend" });
    }
  });

  it("lets a non-Champion Legend leave only to Banishment", () => {
    const state = host();
    const removable = { ...championLegend, cardId: "removable-legend", championLegend: undefined };
    const created = state.perform({ type: "create-token", player: "A", token: removable, to: "legend" }).result as { id: string; zoneEntryId: number };
    const ref = { id: created.id, zoneEntryId: created.zoneEntryId };
    expect(state.perform({ type: "move-zone", object: ref, to: "hand" }).status).toBe("prevented");
    expect(state.perform({ type: "move-zone", object: ref, to: "banishment" }).status).toBe("done");
    expect(state.objects().find(object => object.ref.id === created.id)).toMatchObject({ zone: "banishment" });
  });
});
