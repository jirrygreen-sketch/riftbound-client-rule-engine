import { describe, expect, it } from "vitest";
import { ChainEngine } from "../../../../packages/engine-core/dist/chain/engine.js";
import { createActionPipelineHost } from "../../../../packages/engine-core/dist/events/action-adapter.js";
import { createProgramBinding } from "../../../../packages/engine-core/dist/programs/index.js";
import { EngineRuntimeHost, type RuntimeCard } from "../../src/engine-runtime/host.js";

type RuntimeHostInternals = {
  readonly objectMap: Map<string, RuntimeCard>;
};

function internals(host: EngineRuntimeHost): RuntimeHostInternals {
  return host as unknown as RuntimeHostInternals;
}

function addUnit(host: EngineRuntimeHost, id: string, zone: "board" | "hand" | "deck" = "board") {
  return host.addCard("A", {
    id, cardId: `${id}-card`, name: id, types: ["unit"], tags: ["Frozen"], energy: 0,
  }, zone);
}

function pipeline(host: EngineRuntimeHost) {
  return createActionPipelineHost({
    checkpoint: () => host.checkpoint(),
    restore: checkpoint => host.restore(checkpoint),
    objects: () => host.objects(),
    perform: action => host.perform(action),
    choose: request => host.choose(request),
    context: (source, controller, timingPoint) => host.context(source, controller, timingPoint),
  });
}

describe("RIFT-1093 host copy-on-write checkpoints", () => {
  it("shares unchanged frozen generations and materializes isolated public copies", () => {
    const host = new EngineRuntimeHost({ A: "A", B: "B" }, () => { throw new Error("unexpected choice"); });
    const firstRef = addUnit(host, "first");
    const secondRef = addUnit(host, "second");
    const checkpoint = host.checkpoint();

    expect(host.checkpoint()).not.toBe(checkpoint);
    const publicCopyA = structuredClone(host.checkpoint());
    const publicCopyB = structuredClone(host.checkpoint());
    expect(publicCopyA.objects).not.toBe(publicCopyB.objects);
    expect(publicCopyA.players).not.toBe(publicCopyB.players);
    host.perform({ type: "add-counter", object: firstRef, counter: "charge", amount: 2 }).status;
    checkpoint.objects[0]!.counters.charge = 9;
    expect(host.object(firstRef)?.counters.charge).toBe(2);

    const view = host.objects();
    expect(view).toBe(host.objects());
    expect(view[0]).not.toBe(checkpoint.objects[0]);
    expect(view[1]).not.toBe(checkpoint.objects[1]);

    expect(host.perform({ type: "stun", object: secondRef }).status).toBe("done");
    const nextCheckpoint = host.checkpoint();
    expect(nextCheckpoint.objects).not.toBe(checkpoint.objects);
    expect(nextCheckpoint.objects[0]).toEqual(host.objects()[0]);
    expect(nextCheckpoint.objects[1]).not.toEqual(checkpoint.objects[1]);
    expect(checkpoint.objects.find(object => object.ref.id === firstRef.id)?.stunned).toBe(false);
    expect(nextCheckpoint.objects.find(object => object.ref.id === firstRef.id)?.stunned).toBe(false);
    expect(nextCheckpoint.objects.find(object => object.ref.id === secondRef.id)?.stunned).toBe(true);
  });

  it("restores exact nested generations after player and zone mutations", () => {
    const host = new EngineRuntimeHost({ A: "A", B: "B" }, () => { throw new Error("unexpected choice"); });
    const ref = addUnit(host, "nested");
    const outer = host.checkpoint();
    expect(host.perform({ type: "gain-energy", player: "A", amount: 3 }).status).toBe("done");
    expect(host.perform({ type: "move-zone", object: ref, to: "hand" }).status).toBe("done");
    const inner = host.checkpoint();
    const moved = host.zoneObjects("A", "hand")[0]!.ref;
    expect(host.perform({ type: "stun", object: moved }).status).toBe("done");

    host.restore(inner);
    expect(host.player("A").energy).toBe(3);
    expect(host.zoneObjects("A", "hand").map(object => object.ref.id)).toEqual(["nested"]);
    expect(host.object(ref)).toBeNull();

    host.restore(outer);
    expect(host.player("A").energy).toBe(0);
    expect(host.zoneObjects("A", "board").map(object => object.ref.id)).toEqual(["nested"]);
    expect(host.object(ref)?.stunned).toBe(false);
    expect(host.checkpoint().objects).toEqual(outer.objects);
  });

  it("keeps public object views frozen independently of later writes", () => {
    const host = new EngineRuntimeHost({ A: "A", B: "B" }, () => { throw new Error("unexpected choice"); });
    const ref = addUnit(host, "view");
    const first = host.objects();
    expect(Object.isFrozen(first[0]!.tags)).toBe(true);
    expect(() => (first[0]!.tags as string[]).push("Mutation")).toThrow(TypeError);

    expect(host.perform({ type: "stun", object: ref }).status).toBe("done");
    const second = host.objects();
    expect(second).not.toBe(first);
    expect(second[0]!.stunned).toBe(true);
    expect(first[0]!.stunned).toBe(false);
    internals(host).objectMap.get("view")!.name = "Internally changed";
    (host as unknown as { invalidateObjectCache(): void }).invalidateObjectCache();
    expect(first[0]!.name).toBe("view");
  });

  it("preserves a production binding transaction and exact event replay", () => {
    const program = {
      canonicalCardId: "test:rift-1093-copyvalue",
      rulesetVersion: "core-1.5" as const,
      status: "executable" as const,
      sourceText: "Draw 1.",
      abilities: [{
        kind: "activated" as const,
        timing: "action" as const,
        cost: { kind: "activated" as const, energy: { kind: "constant" as const, value: 0 } },
        body: [{ id: "draw", op: "effect.draw", args: { amount: { kind: "constant" as const, value: 1 } } }],
      }],
    };
    const host = new EngineRuntimeHost({ A: "A", B: "B" }, request => {
      if (request.type === "optional") return true as never;
      if (request.type === "mode") return request.options[0] as never;
      throw new Error(`Unexpected choice ${request.id}`);
    });
    const source = host.addCard("A", {
      id: "source", cardId: program.canonicalCardId, name: "Source", types: ["gear"], energy: null, power: null,
    }, "board");
    addUnit(host, "draw-a", "deck");
    addUnit(host, "draw-b", "deck");
    const engine = new ChainEngine({
      turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host: pipeline(host), cleanup: () => false,
    });
    const binding = createProgramBinding({ cardPrograms: [program] });
    binding.attachLifecycle(engine, error => { throw error; });
    const snapshot = host.objects().find(object => object.ref.id === source.id);
    expect(snapshot).toBeDefined();
    engine.execute(binding.describeActivate(snapshot!, "A"));
    for (let guard = 0; engine.items.length && guard < 30; guard += 1) engine.pass(engine.priority!);
    expect(host.zoneObjects("A", "hand").map(object => object.ref.id)).toEqual(["draw-a"]);
    expect(engine.pipeline.events.map(event => event.eventId)).toEqual(
      engine.pipeline.events.map((_, index) => index + 1),
    );
  });
});
