import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogs/final-spark-lux.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
// card-dsl has no dependency edge on engine-core, so the chain-level evidence
// loads the built engine through its workspace layout instead of the package name.
import { AwaitChoice } from "../../../../engine-core/dist/effects/contract.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID = "card.hash-eef2050754d1ea5e66dbbe4a0abc9faf47327acb4551170226ebde3e02eccd83";
const SOURCE_TEXT = "[Action] (Play on your turn or in showdowns.)\nDeal 8 to a unit.";

const [speed, play] = program.abilities;
const [dealt] = play.body;

test("ogs-022-024 Final Spark, Lux: program passes validateCardProgram and is executable", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.status, "executable");
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("ogs-022-024 Final Spark, Lux: [Action] keyword plus the printed 8 energy cost", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(speed, { kind: "keyword", keyword: "action" });
  assert.equal(play.kind, "play");
  // Catalog printed cost: 8 energy, no printed Power (power stays absent rather
  // than being written as 0).
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 8 }
  });
});

test("ogs-022-024 Final Spark, Lux: one targeted damage instruction over any one unit", () => {
  assert.equal(play.body.length, 1);
  assert.equal(dealt.id, "final-spark-lux.deal-8");
  assert.equal(dealt.op, "effect.damage");
  assert.deepEqual(dealt.args.amount, { kind: "constant", value: 8 });
  assert.deepEqual(dealt.args.target, { kind: "constant", value: "unit" });
  // The spell is the damage source by default (418.6.a).
  assert.equal(dealt.args.source, undefined);
  assert.equal(dealt.linkedTo, undefined);

  // "a unit" means an object on the Board (355.9.a.1) with no location or
  // controller restriction at all.
  assert.equal(dealt.targets.length, 1);
  const [spec] = dealt.targets;
  assert.equal(spec.id, "unit");
  assert.deepEqual(spec.filter, { type: "unit" });
  assert.equal(spec.min, 1);
  assert.equal(spec.max, 1);
  assert.equal(spec.selection, "one");
});

test("ogs-022-024 Final Spark, Lux golden: effect.damage deals the printed 8 to any unit", () => {
  const kernel = world()
    .unit("enemy", { owner: "B", might: 9, location: { type: "base", player: "B" } })
    .build();
  const run = runInstruction(
    damage,
    { amount: dealt.args.amount, target: "unit" },
    { world: kernel, targets: { unit: [kernel.ref("enemy")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.dealt, 8);
  assert.equal(run.linked.dealtCount, 1);
  assert.equal(kernel.getObject("enemy").damage, 8);
  assert.deepEqual(run.events.map((event) => event.action), ["damage"]);
});

test("ogs-022-024 Final Spark, Lux golden: lethal damage alone does not kill before cleanup", () => {
  const kernel = world().unit("enemy", { owner: "B", might: 5 }).build();
  const run = runInstruction(
    damage,
    { amount: dealt.args.amount, target: "unit" },
    { world: kernel, targets: { unit: [kernel.ref("enemy")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("enemy").damage, 8);
  // 429.4 / 323.4: a unit whose damage is at least its Might dies during the
  // next Cleanup; the damage primitive itself never kills.
  assert.equal(kernel.getObject("enemy").zone, "board");
  assert.deepEqual(run.events.map((event) => event.action), ["damage"]);
});

test("ogs-022-024 Final Spark, Lux golden: a unit that left the Board is mistargeted (359.3.e)", () => {
  const kernel = world().unit("enemy", { owner: "B", might: 5 }).build();
  const stale = kernel.ref("enemy");
  assert.equal(kernel.perform({ type: "banish", object: stale }).status, "done");
  const run = runInstruction(
    damage,
    { amount: dealt.args.amount, target: "unit" },
    { world: kernel, targets: { unit: [stale] } }
  );
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
  assert.deepEqual(run.events, []);
});

test.todo(
  "Final Spark, Lux: enforce the printed [Action] Showdown timing permission through the keyword registry " +
    "(依赖 RIFT-89 continuous.timing 接线) and exclude Pending chain items from the unit target choice (RIFT-90)"
);

test.todo(
  "Final Spark, Lux: the lethal-damage cleanup that kills the damaged unit (323.4, 429.4) runs after the " +
    "spell finishes resolving and belongs to the turn cleanup, not to this card"
);

test("ogs-022-024 Final Spark, Lux golden: the production chain charges 8 energy and deals 8", () => {
  const kernel = world()
    .player("A", { energy: 20 })
    .player("B", { energy: 20 })
    .hand("final-spark-lux", { name: "Final Spark, Lux", types: ["spell"], energy: 8, power: null })
    .unit("unit", { owner: "B", might: 9, location: { type: "base", player: "B" } })
    .build();
  const source = kernel.getObject("final-spark-lux");
  const requests = [];
  const decide = (request) => {
    requests.push(request);
    if (request.type === "select-objects") return [...request.options];
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

  engine.execute({
    id: "final-spark-lux",
    controller: "A",
    source,
    kind: "spell",
    speed: "action",
    body: play.body,
    cost: { id: "final-spark-lux:cost", cost: { kind: "printed" } }
  });
  while (engine.items.length) engine.pass(engine.priority);

  // The Finalize target system ran the card's own unrestricted "a unit"
  // requirement against the real query, then the body dealt the printed 8.
  const targetRequest = requests.find((request) => request.id === "target:unit");
  assert.ok(targetRequest);
  assert.deepEqual(targetRequest.options.map((ref) => ref.id), ["unit"]);
  assert.equal(kernel.getObject("unit").damage, 8);
  assert.equal(kernel.player("A").energy, 12);
  assert.equal(kernel.getObject("final-spark-lux").zone, "trash");
});
