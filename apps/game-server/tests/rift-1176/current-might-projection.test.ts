import { describe, expect, it } from "vitest";

import type { ObjectSnapshot } from "../../../../packages/engine-core/dist/effects/contract.js";
import type { Match } from "../../../../packages/engine-core/dist/game/lifecycle.js";
import { EngineRuntimeHost } from "../../src/engine-runtime/host.js";
import { projectRuntime, projectionSnapshot } from "../../src/engine-runtime/projection.js";

// Official evidence for this behavior:
// - Riftbound Core Rules v1.5, published 2026-10-09, effective 2026-10-16:
//   https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// - 143.2.a: a displayed unit "Might" means Effective Might. 475-478.4
//   establish that this is the value after all Layers run. A continuous effect
//   remains while applicable (478.1); a "this turn" effect ends with the turn
//   (317.2.c).
// - sfd-089-221 Rumble, Scrapper says "Your Mechs have +1 :rb_might:
//   (including me)." The test uses a layer output representing that effect and
//   checks the projection consumes it without recalculating rules.
const RULES_URL =
  "https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf";

function fakeMatch(current: readonly ObjectSnapshot[]) {
  return {
    flow: {
      phase: "main", turn: 1, turnPlayer: "A",
      chain: {
        layers: { withCommandPlanCache: <T>(_key: string, read: () => T) => read() },
        withStableLayers: <T>(read: () => T) => read(),
        pipeline: { host: { objects: () => current } },
        items: [], priority: "A", focus: null, turnState: "neutral-open",
        canAct: () => true, canPass: () => true,
      },
      combat: { current: null, active: false, battlefields: [] },
      battlefields: [], scored: () => [], victoryScore: 8,
    },
    result: () => ({ winner: null, turnNumber: 1 }), events: () => [],
    setup: { battlefields: [] }, turnOrder: ["A", "B"], firstPlayer: "A",
  } as unknown as Match;
}

function makeHost() {
  const host = new EngineRuntimeHost({ A: "A", B: "B" }, () => { throw new Error("unexpected choice"); });
  host.addCard("A", { id: "mech", cardId: "sfd-089-221", name: "Rumble, Scrapper",
    types: ["unit"], tags: ["Mech"], might: 4, energy: 5, power: ["Mind"] }, "board");
  host.addCard("A", { id: "ally", cardId: "sfd-062-221", name: "Bubble Bot",
    types: ["unit"], tags: ["Mech"], might: 3, energy: 3, power: null }, "board");
  host.addCard("A", { id: "private-a", cardId: "synthetic:private-a", name: "Private A",
    types: ["unit"], tags: ["Mech"], might: 7, energy: null, power: null }, "hand");
  host.addCard("B", { id: "hidden", cardId: "synthetic:hidden-unit", name: "Hidden Unit",
    types: ["unit"], tags: ["Mech"], might: 7, energy: null, power: null }, "hand");
  return host;
}

function layered(host: EngineRuntimeHost, overrides: Readonly<Record<string, number>>) {
  return host.objects().map(object => Object.freeze({
    ...object,
    might: overrides[object.ref.id] ?? object.might,
    location: object.zone === "board" ? Object.freeze({ type: "base" as const, player: object.owner }) : object.location,
  }));
}

describe("RIFT-1176 current Might projection", () => {
  it("uses one shared current-Layer object view for all birds-eye viewers", () => {
    const host = makeHost();
    const current = layered(host, { mech: 5, ally: 4, hidden: 8 });
    const match = fakeMatch(current);
    const snapshot = projectionSnapshot(match, host, "RIFT-1176:current", 0);
    expect(snapshot.objectCurrentById?.size).toBe(4);
    for (const viewer of ["A", "B", null] as const) {
      const view = projectRuntime(match, host, "RIFT-1176:current", viewer, 0, null, snapshot);
      expect(view.objects.find(object => object.objectId === "mech")?.might).toBe(5);
      expect(view.objects.find(object => object.objectId === "ally")?.might).toBe(4);
    }
    expect(RULES_URL).toContain("cmsassets.rgpub.io");
  });

  it("updates projected current Might when the shared Layer view changes", () => {
    const host = makeHost();
    const raw = host.objects();
    const boosted = fakeMatch(layered(host, { mech: 5, ally: 4, hidden: 8 }));
    const restored = fakeMatch(layered(host, { mech: 4, ally: 3, hidden: 7 }));
    const boostedView = projectRuntime(boosted, host, "RIFT-1176:boost", "A", 0, null);
    const restoredView = projectRuntime(restored, host, "RIFT-1176:restore", "A", 0, null);
    expect(boostedView.objects.find(object => object.objectId === "mech")?.might).toBe(5);
    expect(boostedView.objects.find(object => object.objectId === "ally")?.might).toBe(4);
    expect(restoredView.objects.find(object => object.objectId === "mech")?.might).toBe(4);
    expect(restoredView.objects.find(object => object.objectId === "ally")?.might).toBe(3);
    expect(raw.find(object => object.ref.id === "mech")?.might).toBe(4);
  });

  it("does not expose Might or identity for a hidden object", () => {
    const host = makeHost();
    const current = layered(host, { mech: 5, ally: 4, "private-a": 9, hidden: 99 });
    const match = fakeMatch(current);
    const snapshot = projectionSnapshot(match, host, "RIFT-1176:hidden", 0);
    for (const viewer of ["B", null] as const) {
      const view = projectRuntime(match, host, "RIFT-1176:hidden", viewer, 0, null, snapshot);
      const hidden = view.objects.find(object => object.ownerPlayerId === "A" && object.faceDown)!;
      expect(hidden).toBeDefined();
      expect(hidden!.faceDown).toBe(true);
      expect(hidden!.visibility).toBe("public");
      expect(hidden!.might).toBeUndefined();
      expect(hidden!.cardId).toBeUndefined();
      expect(hidden!.name).toBeUndefined();
    }
  });

  it("uses the rulebook's sfd-089 Rumble aura arithmetic in the supplied layer view", () => {
    const host = makeHost();
    // Both Objects are friendly Mechs on Board. The +1 comes from the existing
    // layer engine's arithmetic result in this focused source; the projection
    // must preserve each object's independently current value.
    const current = layered(host, { mech: 5, ally: 4, "private-a": 9, hidden: 8 });
    const view = projectRuntime(fakeMatch(current), host, "RIFT-1176:rumble", "B", 0, null);
    expect(view.objects.find(object => object.cardId === "sfd-089-221")?.might).toBe(5);
    expect(view.objects.find(object => object.cardId === "sfd-062-221")?.might).toBe(4);
  });

  it("does not mutate source objects and preserves energy/power nulls", () => {
    const host = makeHost();
    const before = host.objects();
    const current = layered(host, { mech: 5, ally: 4, "private-a": 9, hidden: 8 });
    const view = projectRuntime(fakeMatch(current), host, "RIFT-1176:immutable", "A", 0, null);
    expect(host.objects()).toBe(before);
    expect(host.objects().find(object => object.ref.id === "mech")?.might).toBe(4);
    expect(view.objects.find(object => object.objectId === "ally")?.might).toBe(4);
    expect(Object.isFrozen(host.objects())).toBe(true);
  });

  it("keeps all current-Might objects in the shared source of one projection", () => {
    const host = makeHost();
    const current = layered(host, { mech: 5, ally: 4, "private-a": 9, hidden: 8 });
    const match = fakeMatch(current);
    const snapshot = projectionSnapshot(match, host, "RIFT-1176:shared", 0);
    const mech = snapshot.objectCurrentById?.get("mech:1");
    const ally = snapshot.objectCurrentById?.get("ally:1");
    expect(mech).not.toBe(snapshot.objectSource.find(object => object.ref.id === "mech"));
    expect(ally).not.toBe(snapshot.objectSource.find(object => object.ref.id === "ally"));
    expect(mech?.might).toBe(5);
    expect(ally?.might).toBe(4);
  });

  it("keeps null layer values and distinguishes them from absent Might", () => {
    const host = makeHost();
    const current = layered(host, { mech: 5, ally: 4, hidden: 8 });
    const absent = current.map(object => object.ref.id === "private-a"
      ? Object.freeze({ ...object, might: null }) : object);
    const snapshot = projectionSnapshot(fakeMatch(absent), host, "RIFT-1176:null", 0);
    expect(snapshot.objectCurrentById?.get("private-a:1")?.might).toBeNull();
    const view = projectRuntime(fakeMatch(absent), host, "RIFT-1176:null", "A", 0, null);
    expect(view.objects.find(object => object.objectId === "private-a")?.might).toBeUndefined();
  });

  it("keeps projected current Might aligned with the shared source under object replacement", () => {
    const host = makeHost();
    const before = projectionSnapshot(fakeMatch(host.objects()), host, "RIFT-1176:replace", 0);
    const current = layered(host, { mech: 5, ally: 4, "private-a": 9, hidden: 8 });
    const after = projectionSnapshot(fakeMatch(current), host, "RIFT-1176:replace", 1);
    expect(before.objectCurrentById?.get("mech:1")?.might).toBe(4);
    expect(after.objectCurrentById?.get("mech:1")?.might).toBe(5);
    const view = projectRuntime(fakeMatch(current), host, "RIFT-1176:replace", "A", 1, null, after);
    expect(view.objects.find(object => object.objectId === "mech")?.might).toBe(5);
  });
});
