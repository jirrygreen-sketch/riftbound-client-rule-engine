import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogs/incinerate.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so the chain-level evidence loads the built engine through its
// workspace layout instead of the package name.
import { AwaitChoice } from "../../../../engine-core/dist/effects/contract.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";

const CANONICAL_ID = "card.hash-cda4589f51b52780272f5a9b1db1a1de9e9e57e13ffaa05ab668af2de34c1de9";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\nDeal 2 to a unit at a battlefield.";

const [speed, play] = program.abilities;
const [dealt] = play.body;

test("ogs-003-024 Incinerate: program passes validateCardProgram and is executable", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.status, "executable");
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("ogs-003-024 Incinerate: [Action] keyword plus one printed-cost play ability", () => {
  assert.equal(program.abilities.length, 2);
  // [Action] (806) is a speed keyword expanded by the keyword registry.
  assert.deepEqual(speed, { kind: "keyword", keyword: "action" });
  assert.equal(play.kind, "play");
  // Catalog printed cost: 2 energy, no printed Power.
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 }
  });
});

test("ogs-003-024 Incinerate: one targeted damage instruction restricted to battleground units", () => {
  assert.equal(play.body.length, 1);
  assert.equal(dealt.id, "incinerate.deal-2");
  assert.equal(dealt.op, "effect.damage");
  assert.deepEqual(dealt.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(dealt.args.target, { kind: "constant", value: "battlefield-unit" });
  // The spell is the damage source by default (418.6.a), so no source argument.
  assert.equal(dealt.args.source, undefined);
  assert.equal(dealt.linkedTo, undefined);

  assert.equal(dealt.targets.length, 1);
  const [spec] = dealt.targets;
  assert.equal(spec.id, "battlefield-unit");
  assert.deepEqual(spec.filter, { type: "unit", location: "battlefield" });
  assert.equal(spec.min, 1);
  assert.equal(spec.max, 1);
  assert.equal(spec.selection, "one");
});

test("ogs-003-024 Incinerate: the recorded restriction matches battlefield units only", () => {
  const base = {
    ref: { id: "x", zoneEntryId: 1 },
    cardId: "card:x",
    name: "x",
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    might: 1,
    energy: null,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  };
  assert.equal(matchesObjectFilter(dealt.targets[0].filter, { ...base, location: { type: "battlefield", id: "bf-1" } }), true);
  assert.equal(matchesObjectFilter(dealt.targets[0].filter, { ...base, location: { type: "base", player: "A" } }), false);
});

test("ogs-003-024 Incinerate golden: effect.damage deals the printed 2 to the battlefield unit", () => {
  const kernel = world()
    .unit("bf-unit", { owner: "B", might: 3, location: { type: "battlefield", id: "bf-1" } })
    .base("base-unit", { owner: "B", might: 3 })
    .build();
  const run = runInstruction(
    damage,
    { amount: dealt.args.amount, target: "battlefield-unit" },
    { world: kernel, targets: { "battlefield-unit": [kernel.ref("bf-unit")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.dealt, 2);
  assert.equal(run.linked.dealtCount, 1);
  assert.equal(kernel.getObject("bf-unit").damage, 2);
  assert.equal(kernel.getObject("base-unit").damage, 0);
  assert.deepEqual(run.events.map((event) => event.action), ["damage"]);
});

test("ogs-003-024 Incinerate golden: a target that left the board is mistargeted (359.3.e)", () => {
  const kernel = world().unit("bf-unit", { owner: "B", might: 3 }).build();
  const stale = kernel.ref("bf-unit");
  assert.equal(kernel.perform({ type: "return-to-hand", object: stale }).status, "done");
  const run = runInstruction(
    damage,
    { amount: dealt.args.amount, target: "battlefield-unit" },
    { world: kernel, targets: { "battlefield-unit": [stale] } }
  );
  // Contract 3.4 / 3.6 primitive rule 2: every target reference is gone -> ignored.
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
  assert.deepEqual(run.events, []);
  assert.equal(kernel.getObject("bf-unit").damage, 0);
});

test.todo(
  "Incinerate: enforce the printed [Action] Showdown timing permission through the keyword registry " +
    "(依赖 RIFT-89 continuous.timing 接线) and exclude Pending chain items from the target choice (RIFT-90)"
);

test("ogs-003-024 Incinerate golden: the whole body resolves through the production chain", () => {
  const kernel = world()
    .player("A", { energy: 20 })
    .player("B", { energy: 20 })
    .hand("incinerate", { name: "Incinerate", types: ["spell"], energy: 2, power: null })
    .unit("bf-unit", { owner: "B", might: 3, location: { type: "battlefield", id: "bf-1" } })
    .base("base-unit", { owner: "B", might: 3 })
    .build();
  const source = kernel.getObject("incinerate");
  const requests = [];
  const decide = (request) => {
    requests.push(request);
    if (request.type === "select-objects" && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (checkpoint) => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    choose: decide,
    context: (sourceSnapshot, controller, timingPoint) => bindResolveContext(kernel, {
      source: sourceSnapshot, controller, timingPoint, choose: decide
    }),
    testTrigger: (registration) => kernel.test(registration.spec.condition)
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });

  // The card DSL declares the printed cost as `cost.printed` (contract 3.1); the
  // chain consumes its own normalized `printed` cost spec and reads the printed
  // Energy/Power from the source snapshot. Translating between the two is the
  // production caller's job (RIFT-89 wiring, not merged), so the golden checks
  // that the declared cost is `cost.printed` and hands the chain the normalized
  // form, which then charges the real source values.
  assert.equal(play.cost.kind, "cost.printed");
  // The caller provisions the Finalize answers the target system would collect
  // (RIFT-90): the battlefield unit is the only legal candidate here.
  engine.execute({
    id: "incinerate",
    controller: "A",
    source,
    kind: "spell",
    speed: "action",
    body: play.body,
    cost: { id: "incinerate:cost", cost: { kind: "printed" } },
    targets: [{ requirement: dealt.targets[0], options: { selected: [kernel.ref("bf-unit")] } }]
  });
  while (engine.items.length) engine.pass(engine.priority);

  assert.equal(kernel.getObject("bf-unit").damage, 2);
  assert.equal(kernel.getObject("base-unit").damage, 0);
  // The printed 2 energy was charged and the resolved spell went to the trash.
  assert.equal(kernel.player("A").energy, 18);
  assert.equal(kernel.getObject("incinerate").zone, "trash");
  // The Finalize answers were provisioned, so the target system asks nothing;
  // the linked receipt is empty and no resolution-time choice is requested.
  assert.deepEqual(requests, []);
  const timings = engine.pipeline.events.map((event) => event.timingPoint);
  assert.ok(timings.includes("chain-item-finalize"));
  assert.ok(timings.includes("damage-dealt"));
  assert.ok(timings.includes("chain-item-resolve"));
});
