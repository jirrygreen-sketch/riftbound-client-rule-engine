import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/mysterious-chronomancer.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import disarm from "../../../../engine-core/dist/effects/keywords/Disarm.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import might from "../../../../engine-core/dist/effects/instructions/continuous.might.js";

const CANONICAL =
  "card.hash-6b0bcf2f0d70419ac960f2e10f95b86b212de65ad51127d9ca67749bf9316641";
const SOURCE_TEXT =
  "When you play me, [Predict 2]. (Look at the top 2 cards of your Main Deck. " +
  "Recycle any of them and put the rest back in any order.)\n" +
  "[Disarm 2] (When I attack, give an enemy unit here -2 :rb_might: this turn.)";

const [triggered, disarmAbility] = program.abilities;
const [look, recycle, putBack] = triggered.body;
const SELECT_ID = "mysterious-chronomancer.predict-look/mysterious-chronomancer.predict";
const ORDER_ID = "mysterious-chronomancer.predict-put-back/effect.order%3Atop%3AA";

function predictBodyFor(player) {
  return triggered.body.map(instruction => instruction.id === look.id
    ? { ...instruction, args: { ...instruction.args, player: { kind: "constant", value: player } } }
    : instruction);
}

test("rad-050-167 Mysterious Chronomancer: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-050-167 Mysterious Chronomancer: identity, executable status and sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "executable");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(program.judgeReason, undefined);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-050-167 Mysterious Chronomancer: play trigger declares Predict 2 and Disarm 2", () => {
  assert.equal(triggered.kind, "triggered");
  assert.deepEqual(triggered.trigger, {
    at: "card-played",
    filter: { event: "card-played", filter: { source: "self", player: "controller" } }
  });
  assert.equal(triggered.optional, false);
  assert.deepEqual(disarmAbility, { kind: "keyword", keyword: "disarm", value: 2 });
  assert.deepEqual(triggered.body.map(instruction => instruction.id), [
    "mysterious-chronomancer.predict-look",
    "mysterious-chronomancer.predict-recycle",
    "mysterious-chronomancer.predict-put-back"
  ]);
  assert.equal(look.op, "effect.inspect");
  assert.deepEqual(look.args.scope, { kind: "constant", value: "top" });
  assert.deepEqual(look.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(look.args.picksSpecId, {
    kind: "constant",
    value: "mysterious-chronomancer.predict-top-2"
  });
  assert.deepEqual(look.args.chooseCount, { kind: "constant", value: { min: 0, max: 2 } });
  assert.equal(recycle.linkedTo, look.id);
  assert.equal(putBack.linkedTo, recycle.id);
  assert.deepEqual(putBack.args.count, {
    kind: "arithmetic",
    operator: "sub",
    operands: [
      { kind: "constant", value: 2 },
      { kind: "linked-value", instructionId: recycle.id, key: "recycledCount" }
    ]
  });
});

test("rad-050-167 Mysterious Chronomancer: Predict recycles one card and orders the rest", () => {
  const kernel = world().deck(["top", "second", "third"]).build();
  const top = kernel.ref("top");
  const second = kernel.ref("second");
  kernel.setPicks("mysterious-chronomancer.predict-top-2", [top, second]);
  kernel.setAnswers({ [SELECT_ID]: [top], [ORDER_ID]: [second] });

  const outcome = resolveChainBody(predictBodyFor("A"), kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    [look.id, "executed"], [recycle.id, "executed"], [putBack.id, "executed"]
  ]);
  assert.equal(outcome.linkedValues[look.id + ".inspected"], 2);
  assert.equal(outcome.linkedValues[recycle.id + ".recycledCount"], 1);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["second", "third", "top"]);
  assert.deepEqual(kernel.events.map(event => event.action), ["look", "recycle", "order-top"]);
});

test("rad-050-167 Mysterious Chronomancer: Predict can recycle nothing and handle a one-card deck", () => {
  const kernel = world().deck(["only-card"]).build();
  const only = kernel.ref("only-card");
  kernel.setPicks("mysterious-chronomancer.predict-top-2", [only]);
  kernel.setAnswers({ [SELECT_ID]: [], [ORDER_ID]: [only] });

  const outcome = resolveChainBody(predictBodyFor("A"), kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues[look.id + ".inspected"], 1);
  assert.equal(outcome.linkedValues[recycle.id + ".recycledCount"], 0);
  assert.equal(outcome.linkedValues[putBack.id + ".ordered"], 1);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["only-card"]);
});

test("rad-050-167 Mysterious Chronomancer: merged Disarm expands to attack-declared -2 Might", () => {
  const registered = keywordDefinitionsById.get("Disarm");
  assert.ok(registered);
  assert.equal(registered, disarm);
  const [expansion] = disarm.expand({ value: 2, host: { canonicalCardId: CANONICAL } });
  assert.equal(expansion.kind, "triggered");
  assert.equal(expansion.trigger.at, "attack-declared");
  assert.equal(expansion.body[0].op, "continuous.might");
  assert.deepEqual(expansion.body[0].args.amount, { kind: "constant", value: -2 });
  assert.deepEqual(expansion.body[0].args.duration, { kind: "constant", value: "this-turn" });
});

test("rad-050-167 Mysterious Chronomancer: Disarm's Might instruction registers an end-of-turn layer effect", () => {
  const kernel = world()
    .unit("chronomancer", { might: 4 })
    .unit("enemy", { owner: "B", might: 5 })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("chronomancer") });
  const run = runInstruction(
    might,
    { amount: -2, duration: "this-turn", target: "disarm.enemy-unit" },
    { world: scoped, targets: { "disarm.enemy-unit": [scoped.ref("enemy")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(scoped.continuousEffects.length, 1);
  assert.equal(scoped.continuousEffects[0].effect.layer, "arithmetic");
  assert.deepEqual(scoped.continuousEffects[0].duration, { type: "end-of-turn" });
  assert.equal(scoped.continuousEffects[0].effect.effect.kind, "continuous.might");
});
