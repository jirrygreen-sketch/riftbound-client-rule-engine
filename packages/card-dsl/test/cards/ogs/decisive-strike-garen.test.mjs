import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogs/decisive-strike-garen.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { AwaitChoice } from "../../../../engine-core/dist/effects/contract.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID = "card.hash-8ede68abdc12ce7e49e3fb3df89263c308b4405bac8deb070fc67b27cf1b3a30";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\nGive friendly units +2 :rb_might: this turn.";

const [speed, play] = program.abilities;
const [mighty] = play.body;

test("ogs-024-024 Decisive Strike, Garen: program passes validateCardProgram and is executable", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.status, "executable");
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(program.judgeReason, undefined);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("ogs-024-024 Decisive Strike, Garen: [Action] keyword plus the printed 5 energy + 1 Order power cost", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(speed, { kind: "keyword", keyword: "action" });
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 5 },
    power: { kind: "constant", value: 1 }
  });
});

test("ogs-024-024 Decisive Strike, Garen: the +2 Might body is the merged continuous.might instruction", () => {
  assert.equal(play.body.length, 1);
  assert.equal(mighty.id, "decisive-strike-garen.grant-plus-2-might");
  assert.equal(mighty.op, "continuous.might");
  assert.deepEqual(mighty.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(mighty.args.duration, { kind: "constant", value: "end-of-turn" });
  // "friendly units" is a programmatic set (355.10.d): no unit is ever chosen,
  // so there is no TargetSpec and no way to fire "becomes a target".
  assert.equal(mighty.targets, undefined);
  assert.equal(mighty.picks, undefined);
});

test("ogs-024-024 Decisive Strike, Garen: the recorded set is the controller's units, with no location filter", () => {
  assert.deepEqual(mighty.args.objects, {
    kind: "constant",
    value: { kind: "query", filter: { type: "unit", controller: "self" } }
  });
  // "controller: self" is the engine PlayerSelector for the ability controller
  // (events/trigger-spec.ts), and the merged chain normalizes it to the item's
  // controller before matching (chain/engine.ts context.query). The set is not
  // restricted by location, which is why the grant covers units in Bases too.
  const filter = mighty.args.objects.value.filter;
  assert.equal(filter.location, undefined);
  assert.equal(filter.zone, undefined);
  assert.equal(filter.controller, "self");
});

test("ogs-024-024 Decisive Strike, Garen: the +2 is not approximated with Buff counters", () => {
  // CR 702: a Buff counter is a distinct object that contributes +1 Might; it is
  // not a Might value change. Approximating the grant with effect.buff would
  // change the units' Buff state, so the op stays the layers effect.
  assert.notEqual(mighty.op, "effect.buff");
  assert.equal(mighty.args.mode, undefined);
});

/**
 * Drive the card's own body through the production chain adapter. The chain's
 * Finalize/query wrapper binds the filter's "self" placeholder to the item's
 * controller (chain/engine.ts), so the programmatic friendly-unit set resolves
 * exactly as printed.
 */
const runChain = (options = {}) => {
  const {
    friendly = [["ally-bf", 2, { type: "battlefield", id: "bf-1" }], ["ally-base", 3, { type: "base", player: "A" }]],
    enemy = [["enemy-bf", 4, { type: "battlefield", id: "bf-1" }]],
    power = ["Order"]
  } = options;
  const builder = world()
    .player("A", { energy: 20, power })
    .player("B", { energy: 20 })
    .hand("dsg", { name: "dsg", types: ["spell"], energy: 5, power: ["Order"] });
  for (const [id, might, location] of friendly) builder.unit(id, { owner: "A", controller: "A", might, location });
  for (const [id, might, location] of enemy) builder.unit(id, { owner: "B", controller: "B", might, location });
  const kernel = builder.build();
  const source = kernel.getObject("dsg");
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
    id: "dsg",
    controller: "A",
    source,
    kind: "spell",
    speed: "action",
    body: play.body,
    cost: { id: "dsg:cost", cost: { kind: "printed" } }
  });
  while (engine.items.length) engine.pass(engine.priority);
  return { kernel, engine, requests };
};

test("ogs-024-024 Decisive Strike, Garen golden: +2 Might registers for every friendly unit, wherever it is", () => {
  const { kernel, engine } = runChain();

  // The real chain charged the printed 5 energy; the printed 1 Order power was
  // required at Finalize (the reference kernel's pay action models energy/XP).
  assert.equal(kernel.player("A").energy, 15);

  // 478 / 478.1.a: one arithmetic-layer registration per friendly unit, with
  // the end-of-turn duration (317.1.a / 468.7.c). "friendly units" has no
  // location restriction, so Base units are covered too.
  const registrations = engine.layers.registry.list();
  assert.deepEqual(registrations.map((entry) => entry.effect.filter.objectId).sort(), ["ally-base", "ally-bf"]);
  assert.deepEqual(registrations.map((entry) => entry.duration), [{ type: "end-of-turn" }, { type: "end-of-turn" }]);
  for (const entry of registrations) {
    assert.equal(entry.effect.layer, "arithmetic");
    assert.equal(entry.effect.effect.kind, "continuous.might");
    assert.equal(entry.effect.effect.amount, 2);
  }

  engine.layers.setObjects(kernel.objects);
  assert.equal(engine.layers.evaluate(kernel.ref("ally-bf")).might, 4);
  assert.equal(engine.layers.evaluate(kernel.ref("ally-base")).might, 5);
  assert.equal(engine.layers.evaluate(kernel.ref("enemy-bf")).might, 4);
  // No Buff counter is placed: the Might change is a layer effect (CR 702).
  assert.equal(kernel.getObject("ally-bf").buffs, 0);
  assert.equal(kernel.getObject("dsg").zone, "trash");
});

test("ogs-024-024 Decisive Strike, Garen golden: the +2 expires at the end of the turn (317.1.a)", () => {
  const { kernel, engine } = runChain();
  engine.layers.setObjects(kernel.objects);
  assert.equal(engine.layers.evaluate(kernel.ref("ally-bf")).might, 4);

  const expired = engine.layers.advance({ id: "turn-end", player: "A" });
  assert.equal(expired.length, 2);
  engine.layers.setObjects(kernel.objects);
  assert.equal(engine.layers.evaluate(kernel.ref("ally-bf")).might, 2);
  assert.equal(engine.layers.evaluate(kernel.ref("ally-base")).might, 3);
});

test("ogs-024-024 Decisive Strike, Garen golden: an empty friendly set registers nothing and still resolves", () => {
  // 355.13 / contract 3.3: the empty set is a skipped negation for the
  // instruction, not a fabricated registration or a substitute target.
  const { kernel, engine, requests } = runChain({ friendly: [] });
  assert.deepEqual(requests, []);
  assert.equal(engine.layers.registry.list().length, 0);
  assert.equal(kernel.getObject("enemy-bf").might, 4);
  // The spell still resolved and moved to the trash.
  assert.equal(kernel.getObject("dsg").zone, "trash");
});

test("ogs-024-024 Decisive Strike, Garen: the printed 1 Order power is required at Finalize", () => {
  // 376 / printed cost: casting without the printed Power is not payable; the
  // card must not silently drop the cost.
  assert.throws(() => runChain({ power: [] }), /insufficient matching Power/i);
});
