import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/riptide-mage.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { AwaitChoice } from "../../../../engine-core/dist/effects/contract.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-b1ac774654b3c23d9236325b0e377a5c94866af93ca718bf2a30313a4cd027b4";
const SOURCE_TEXT =
  "[Accelerate] (You may pay :rb_energy_1::rb_rune_mind: as an additional cost to have me enter ready.)\n" +
  "When you play me, give an enemy unit -3 :rb_might: this turn.";

const [keyword, triggered] = program.abilities;
const [instruction] = triggered.body;

/** Real ChainEngine fixture; `answers` maps choice ids to decisions. */
function fixture(kernel, answers = {}) {
  const choose = (request) => {
    if (Object.hasOwn(answers, request.type)) {
      const answer = answers[request.type];
      return typeof answer === "function" ? answer(request) : answer;
    }
    if (request.type === "select-objects" && request.options.length === request.min) return [...request.options];
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (checkpoint) => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects, perform: (action) => kernel.perform(action), choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
    testTrigger: (registration) => kernel.test(registration.spec.condition)
  });
  return new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
}

function drain(engine) {
  let passes = 0;
  while (engine.items.length) {
    if (++passes > 20) throw new Error("Nonterminating chain");
    engine.pass(engine.priority);
  }
}

test("rad-058-167 Riptide Mage: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-058-167 Riptide Mage: identity, ruleset, executable status and sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-058-167 Riptide Mage: unvalued Accelerate keyword (805.1.b fixed [1][C] cost)", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(keyword, { kind: "keyword", keyword: "accelerate" });
  assert.equal(keyword.value, undefined);
  // RIFT-86 已合入 Accelerate KeywordDef（valued: false, stacking: single）。
  const definition = keywordDefinitionsById.get("Accelerate");
  assert.equal(definition?.keyword, "Accelerate");
  assert.equal(definition?.valued, false);
  assert.equal(definition?.stacking, "single");
});

test("rad-058-167 Riptide Mage: card-played self trigger gives one enemy unit -3 Might this turn", () => {
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, {
    event: "card-played",
    filter: { source: "self", player: "controller" }
  });
  assert.equal(triggered.optional, false);
  assert.equal(triggered.body.length, 1);

  assert.equal(instruction.id, "riptide-mage.give-minus-three-might");
  assert.equal(instruction.op, "continuous.might");
  assert.deepEqual(instruction.args.mode, { kind: "constant", value: "add" });
  assert.equal(instruction.args.layer, undefined);
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: -3 });
  assert.deepEqual(instruction.args.duration, { kind: "constant", value: "end-of-turn" });
  // RIFT-258's op resolves the selection from `objects`; the descriptor carries
  // the Finalize-locked TargetSpec id through the chain's interpreter adapter.
  assert.deepEqual(instruction.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "riptide-mage.enemy-unit" }
  });
  assert.equal(instruction.args.target, undefined);
  assert.deepEqual(instruction.targets, [
    {
      id: "riptide-mage.enemy-unit",
      // "an enemy unit" 不限位置：任一对手控制的 Board 单位。
      filter: { type: "unit", controller: "opponent", zone: "board" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(instruction.linkedTo, undefined);
});

test("rad-058-167 Riptide Mage golden: the trigger body casts -3 Might this turn through the real layers", () => {
  const kernel = world()
    .unit("riptide-mage", { zone: "board", might: 3, energy: 4, power: ["Mind"] })
    .unit("enemy", { owner: "B", controller: "B", might: 4, zone: "board" })
    .build();
  const engine = fixture(kernel);

  engine.enqueue({
    id: "trigger:riptide-mage", controller: "A",
    source: kernel.getObject("riptide-mage"), kind: "triggered", body: triggered.body
  });
  engine.advance();
  drain(engine);

  const registration = engine.layers.registry.snapshot();
  assert.equal(registration.length, 1);
  assert.equal(registration[0].effect.layer, "arithmetic");
  assert.equal(registration[0].effect.effect.kind, "continuous.might");
  assert.equal(registration[0].effect.effect.amount, -3);
  assert.deepEqual(registration[0].duration, { type: "end-of-turn" });

  engine.layers.setObjects(kernel.objects);
  assert.equal(engine.layers.evaluate(kernel.ref("enemy")).might, 1);
  // The grant targets only the chosen enemy unit, never the source.
  assert.equal(engine.layers.evaluate(kernel.ref("riptide-mage")).might, 3);

  // 317.2.c: the modification expires with the end-of-turn batch.
  engine.emit({ timingPoint: "turn-end" });
  engine.layers.setObjects(kernel.objects);
  assert.equal(engine.layers.evaluate(kernel.ref("enemy")).might, 4);
});

test("rad-058-167 Riptide Mage golden: a stale enemy reference ignores the instruction (359.3.e.7)", () => {
  const kernel = world()
    .unit("riptide-mage", { zone: "board", might: 3 })
    .unit("enemy", { owner: "B", controller: "B", might: 4, zone: "board" })
    .build();
  const engine = fixture(kernel);
  const stale = kernel.ref("enemy");
  kernel.perform({ type: "kill", object: stale });

  engine.enqueue({
    id: "trigger:riptide-mage", controller: "A",
    source: kernel.getObject("riptide-mage"), kind: "triggered", body: triggered.body
  });
  engine.advance();

  // The locked target is gone at Finalize; the trigger is dropped rather than
  // registering an effect on an unrelated object.
  assert.equal(engine.layers.registry.snapshot().length, 0);
  assert.equal(kernel.getObject("enemy").zone, "trash");
});

test("rad-058-167 Riptide Mage golden: paying [Accelerate] makes the unit enter ready", () => {
  const kernel = world()
    .player("A", { energy: 10, power: ["Mind", "Mind"] })
    .player("B", { energy: 10, power: [] })
    .unit("riptide-mage", { zone: "hand", types: ["unit"], might: 3, energy: 4, power: ["Mind"] })
    .build();
  const engine = fixture(kernel, { optional: true });

  // 805.1.b: the printed optional additional cost is [1][C]; the cost plan takes
  // it as an `accelerate` optionalAdditional entry and 805.6 makes the resolved
  // unit enter ready instead of exhausted.
  engine.execute({
    id: "riptide-mage:play", controller: "A", source: kernel.getObject("riptide-mage"),
    kind: "unit", speed: "normal", body: [],
    cost: {
      id: "riptide-mage:cost", cost: { kind: "printed" }, domains: ["Mind"],
      optionalAdditional: [{ id: "riptide-mage:accelerate", kind: "accelerate" }]
    }
  });
  drain(engine);

  const played = kernel.getObject("riptide-mage");
  assert.equal(played.zone, "board");
  assert.equal(played.exhausted, false);
  assert.equal(kernel.player("A").energy, 5);
  // The reference kernel records the committed payment (it does not model the
  // rune-pool power deduction); the receipt proves the [1][Mind] accelerate
  // component was selected and paid before the ready entry.
  const pay = kernel.stateForTest().history.map((entry) => entry.action).find((action) => action.type === "pay");
  assert.equal(pay.plan.energy, 5);
  // printed [4][Mind] + accelerate [1][Mind]
  assert.deepEqual(pay.plan.power, ["Mind", "Mind"]);
});

test("rad-058-167 Riptide Mage golden: declining [Accelerate] keeps the default exhausted entry", () => {
  const kernel = world()
    .player("A", { energy: 10, power: ["Mind", "Mind"] })
    .player("B", { energy: 10, power: [] })
    .unit("riptide-mage", { zone: "hand", types: ["unit"], might: 3, energy: 4, power: ["Mind"] })
    .build();
  const engine = fixture(kernel, { optional: false });

  engine.execute({
    id: "riptide-mage:play", controller: "A", source: kernel.getObject("riptide-mage"),
    kind: "unit", speed: "normal", body: [],
    cost: {
      id: "riptide-mage:cost", cost: { kind: "printed" }, domains: ["Mind"],
      optionalAdditional: [{ id: "riptide-mage:accelerate", kind: "accelerate" }]
    }
  });
  drain(engine);

  const played = kernel.getObject("riptide-mage");
  assert.equal(played.zone, "board");
  // 143.4: units enter exhausted by default; the decline pays nothing extra.
  assert.equal(played.exhausted, true);
  assert.equal(kernel.player("A").energy, 6);
  const pay = kernel.stateForTest().history.map((entry) => entry.action).find((action) => action.type === "pay");
  assert.equal(pay.plan.energy, 4);
  assert.deepEqual(pay.plan.power, ["Mind"]);
});

test.todo(
  "rad-058-167 Riptide Mage: the card-played trigger firing from the production play flow " +
    "(CR 420.4.a) and the CardProgram -> TriggerRegistration + auto-accelerate wiring (RIFT-120); " +
    "the golden drives the card's own trigger body and the accelerate cost through the real ChainEngine above"
);
