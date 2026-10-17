import { describe, expect, it } from "vitest";
import incinerate from "../../../../../packages/card-dsl/src/cards/ogs/incinerate.ts";
import hextechRay from "../../../../../packages/card-dsl/src/cards/ogn/hextech-ray.ts";
import fallingComet from "../../../../../packages/card-dsl/src/cards/ogn/falling-comet.ts";
import finalSparkLux from "../../../../../packages/card-dsl/src/cards/ogs/final-spark-lux.ts";
import { createProgramBinding } from "../../../../../packages/engine-core/src/programs/index.ts";
import { ChainEngine } from "../../../../../packages/engine-core/src/chain/engine.ts";
import {
  bindResolveContext,
  createActionPipelineHost,
} from "../../../../../packages/engine-core/src/events/action-adapter.ts";
import {
  AwaitChoice,
  world,
} from "../../../../../packages/engine-core/src/effects/testing/index.ts";

const POINT_PROGRAMS = Object.freeze({
  "ogs-003-024": {
    program: incinerate,
    amount: 2,
    location: "battlefield",
    energy: 2,
    power: [] as const,
  },
  "ogn-009-298": {
    program: hextechRay,
    amount: 3,
    location: "battlefield",
    energy: 1,
    power: ["Fury"] as const,
  },
  "ogn-085-298": {
    program: fallingComet,
    amount: 6,
    location: "battlefield",
    energy: 5,
    power: [] as const,
  },
  "ogs-022-024": {
    program: finalSparkLux,
    amount: 8,
    location: "any",
    energy: 8,
    power: [] as const,
  },
} as const);

type PointId = keyof typeof POINT_PROGRAMS;
type Location =
  | { readonly type: "battlefield"; readonly id: string }
  | { readonly type: "base"; readonly player: string };

type Harness = {
  readonly kernel: any;
  readonly engine: any;
};

const binding = createProgramBinding({
  cardPrograms: Object.values(POINT_PROGRAMS).map((entry) => entry.program),
});

function lethalCleanup(engine: any, kernel: any): boolean {
  let changed = false;
  engine.layers.setObjects(kernel.objects);
  for (const object of engine.layers.evaluateAll()) {
    if (
      object.zone === "board" &&
      object.types.includes("unit") &&
      object.might !== null &&
      object.damage > 0 &&
      object.damage >= Math.max(0, object.might)
    ) {
      const before = kernel.ref(object.ref.id);
      engine.commit({ type: "kill", object: object.ref });
      changed ||= before.zoneEntryId !== kernel.ref(object.ref.id).zoneEntryId;
    }
  }
  return changed;
}

function harness(
  pointId: PointId,
  targetLocation: Location,
  targetMight: number,
  playerEnergy = 20,
): Harness {
  const entry = POINT_PROGRAMS[pointId];
  const builder = world()
    .player("A", {
      energy: playerEnergy,
      power: ["Fury", "Mind", "Order"],
    })
    .player("B", { energy: 20 })
    .hand("point-spell", {
      cardId: entry.program.canonicalCardId,
      types: ["spell"],
      energy: entry.energy,
      power: [...entry.power],
    })
    .unit("target", {
      owner: "B",
      types: ["unit"],
      might: targetMight,
      location: targetLocation,
    });
  const kernel = builder.build();
  const choose = (request: any) => {
    if (
      request.type === "select-objects" &&
      request.min === request.max &&
      request.options.length === request.min
    ) {
      return [...request.options];
    }
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (checkpoint: any) => {
      kernel.restore(checkpoint.state);
      kernel.copyLinkedFrom(checkpoint.links);
    },
    objects: () => kernel.objects,
    perform: (action: any) => kernel.perform(action),
    choose,
    context: (source: any, controller: string, timingPoint: any) =>
      bindResolveContext(kernel, {
        source,
        controller,
        timingPoint,
        choose,
      }),
    testTrigger: (registration: any) => kernel.test(registration.spec.condition),
  });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"],
    turnPlayer: "A",
    phase: "main",
    host,
    cleanup: (current: any) => lethalCleanup(current, kernel),
    describePlay: binding.describePlay,
  });
  return { kernel, engine };
}

function resolveExisting(h: Harness): void {
  h.engine.advance();
  let guard = 0;
  while (h.engine.items.length > 0) {
    if (++guard > 20) throw new Error("point parity chain did not converge");
    const priority = h.engine.priority;
    if (!priority) throw new Error("point parity chain has no priority holder");
    h.engine.pass(priority);
  }
}

function playAndResolve(h: Harness): void {
  expect(
    h.engine.commit({
      type: "play",
      object: h.kernel.ref("point-spell"),
      player: "A",
    }),
  ).toMatchObject({ status: "done" });
  resolveExisting(h);
}

function eventNames(h: Harness): string[] {
  return h.engine.pipeline.events.map((event: any) => event.timingPoint);
}

function expectOrdered(actual: readonly string[], expected: readonly string[]): void {
  let cursor = -1;
  for (const name of expected) {
    const next = actual.indexOf(name, cursor + 1);
    expect(next, `event ${name} follows the previous point`).toBeGreaterThan(cursor);
    cursor = next;
  }
}

function pointProgramBody(pointId: PointId): any {
  const program = POINT_PROGRAMS[pointId].program as any;
  return program.abilities.find((ability: any) => ability.kind === "play");
}

describe("RIFT-340 point production parity", () => {
  it("covers the legacy Point card roster with source-bound executable programs", () => {
    for (const [pointId, entry] of Object.entries(POINT_PROGRAMS) as [PointId, (typeof POINT_PROGRAMS)[PointId]][]) {
      const play = pointProgramBody(pointId);
      const damage = play.body.find((instruction: any) => instruction.op === "effect.damage");
      expect(entry.program.status, pointId).toBe("executable");
      expect(damage, pointId).toBeDefined();
      expect(damage.args.amount).toEqual({ kind: "constant", value: entry.amount });
      expect(damage.targets).toHaveLength(1);
      expect(damage.targets[0].filter.type).toBe("unit");
    }
  });

  it("matches the old service's nonlethal and lethal observations for executable cards", () => {
    const executable = ["ogs-003-024", "ogn-085-298", "ogs-022-024"] as const;
    for (const pointId of executable) {
      const entry = POINT_PROGRAMS[pointId];
      const nonlethal = harness(pointId, { type: "battlefield", id: "bf-1" }, entry.amount + 1);
      playAndResolve(nonlethal);
      expect(nonlethal.kernel.getObject("target")).toMatchObject({
        zone: "board",
        damage: entry.amount,
        location: { type: "battlefield", id: "bf-1" },
      });
      expect(nonlethal.kernel.getObject("point-spell")?.zone).toBe("trash");
      expectOrdered(eventNames(nonlethal), [
        "object-enters-chain",
        "chain-item-finalize",
        "damage-dealt",
        "card-played",
        "object-enters-trash",
        "chain-item-resolve",
      ]);

      const lethal = harness(pointId, { type: "battlefield", id: "bf-1" }, entry.amount);
      playAndResolve(lethal);
      expect(lethal.kernel.getObject("target")).toMatchObject({
        zone: "trash",
        damage: entry.amount,
      });
      expect(lethal.kernel.getObject("point-spell")?.zone).toBe("trash");
      const lethalEvents = eventNames(lethal);
      expectOrdered(lethalEvents, [
        "damage-dealt",
        "chain-item-resolve",
        "object-killed",
        "object-enters-trash",
      ]);
    }
  });

  it("matches the old Point target boundary: battlefield-only cards reject a base target", () => {
    for (const pointId of ["ogs-003-024", "ogn-085-298"] as const) {
      const entry = POINT_PROGRAMS[pointId];
      const h = harness(pointId, { type: "base", player: "B" }, entry.amount + 1);
      h.engine.commit({
        type: "play",
        object: h.kernel.ref("point-spell"),
        player: "A",
      });
      expect(() => h.engine.advance()).toThrow(/required target count/);
      expect(h.kernel.getObject("target")).toMatchObject({ zone: "board", damage: 0 });
      expect(h.kernel.getObject("point-spell")?.zone).toBe("chain");
      expect(h.kernel.player("A").energy).toBe(20);
    }

    const finalSpark = harness("ogs-022-024", { type: "base", player: "B" }, 99);
    playAndResolve(finalSpark);
    expect(finalSpark.kernel.getObject("target")).toMatchObject({
      zone: "board",
      damage: POINT_PROGRAMS["ogs-022-024"].amount,
      location: { type: "base", player: "B" },
    });
    expect(finalSpark.kernel.getObject("point-spell")?.zone).toBe("trash");
  });

  it("revalidates a finalized target after a zone change and still retires the spell", () => {
    const h = harness("ogs-003-024", { type: "battlefield", id: "bf-1" }, 99);
    h.engine.commit({
      type: "play",
      object: h.kernel.ref("point-spell"),
      player: "A",
    });
    h.engine.advance();
    expect(h.engine.items[0]?.status).toBe("finalized");
    const staleTarget = h.kernel.ref("target");
    expect(h.engine.commit({ type: "return-to-hand", object: staleTarget })).toMatchObject({ status: "done" });
    h.engine.advance();
    let guard = 0;
    while (h.engine.items.length > 0) {
      if (++guard > 20) throw new Error("stale-target parity chain did not converge");
      h.engine.pass(h.engine.priority);
    }
    expect(h.kernel.getObject("target")).toMatchObject({ zone: "hand", damage: 0 });
    expect(h.kernel.getObject("point-spell")?.zone).toBe("trash");
    expect(eventNames(h)).not.toContain("damage-dealt");
    expectOrdered(eventNames(h), [
      "chain-item-finalize",
      "object-enters-hand",
      "object-enters-trash",
      "chain-item-resolve",
    ]);
  });

  it("keeps the Point card in the Chain while an unpayable base cost is retried", () => {
    const h = harness("ogs-003-024", { type: "battlefield", id: "bf-1" }, 99, 1);
    h.engine.commit({
      type: "play",
      object: h.kernel.ref("point-spell"),
      player: "A",
    });
    expect(() => h.engine.advance()).toThrow(/insufficient Energy/);
    expect(h.kernel.getObject("point-spell")?.zone).toBe("chain");
    expect(h.kernel.player("A").energy).toBe(1);
    expect(h.engine.commit({ type: "gain-energy", player: "A", amount: 1 })).toMatchObject({ status: "done" });
    resolveExisting(h);
    expect(h.kernel.getObject("point-spell")?.zone).toBe("trash");
    expect(h.kernel.getObject("target")).toMatchObject({ zone: "board", damage: 2 });
    expect(h.kernel.player("A").energy).toBe(0);
  });

  it.todo(
    "Hextech Ray (ogn-009-298): the executable program's battlefield TargetSpec " +
      "uses an incomplete location shape, so the target layer cannot consume it; " +
      "the old service's 3-point battlefield case needs the shared target contract fixed",
  );

  it.todo(
    "Falling Comet (ogn-085-298): the executable card program omits the printed 5-Energy " +
      "base cost, so effect/lifecycle parity is covered above but fee parity waits for " +
      "catalog cost binding",
  );

  it.todo(
    "Point spells targeting a Deflect permanent: wire the card-program static target tax " +
      "to the Chain cost plan before comparing the old service's mandatory any-Domain Power fee",
  );

  it.todo(
    "Native Rune Pool payment commands: preserve the old service's channel/fund/pay " +
      "continuation through the new Chain cost window and compare the intermediate resource projection",
  );
});
