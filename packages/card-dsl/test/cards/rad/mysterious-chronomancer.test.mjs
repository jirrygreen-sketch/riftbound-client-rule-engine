import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/mysterious-chronomancer.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import disarm from "../../../../engine-core/dist/effects/keywords/Disarm.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import might from "../../../../engine-core/dist/effects/instructions/continuous.might.js";

const CANONICAL = "card.hash-6b0bcf2f0d70419ac960f2e10f95b86b212de65ad51127d9ca67749bf9316641";
const SOURCE_TEXT =
  "When you play me, [Predict 2]. (Look at the top 2 cards of your Main Deck. " +
  "Recycle any of them and put the rest back in any order.)\n" +
  "[Disarm 2] (When I attack, give an enemy unit here -2 :rb_might: this turn.)";

const [predict, disarmAbility] = program.abilities;

test("rad-050-167 Mysterious Chronomancer: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-050-167 Mysterious Chronomancer: identity, ruleset, status, judgeReason and sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-050-167 Mysterious Chronomancer: judgeReason keeps only the current gaps", () => {
  // Disarm is merged now, so the reason must say so; the Predict KeywordDef,
  // the ordered inspect range and the program wiring stay recorded.
  assert.match(program.judgeReason, /Disarm 的 KeywordDef 已合入/);
  assert.match(program.judgeReason, /Predict/);
  assert.match(program.judgeReason, /437/);
  assert.match(program.judgeReason, /zoneSlice/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.equal(/没有 Disarm KeywordDef|no assigned task for the shared keyword/.test(program.judgeReason), false);
});

test("rad-050-167 Mysterious Chronomancer: [Predict 2] is declared with its printed value", () => {
  assert.equal(program.abilities.length, 2);
  // README 第 5 节：关键词只声明，不重写展开；437.3 的 X = 2。
  assert.deepEqual(predict, { kind: "keyword", keyword: "predict", value: 2 });
  // README section 5: the card declares the keyword only. Whether a reusable
  // Predict KeywordDef is merged is recorded in judgeReason and the todos; the
  // declaration itself is what this golden fixes.
  assert.equal(predict.value, 2);
});

test("rad-050-167 Mysterious Chronomancer: [Disarm 2] is declared with its printed value (831.1.c)", () => {
  assert.deepEqual(disarmAbility, { kind: "keyword", keyword: "disarm", value: 2 });
});

test("rad-050-167 Mysterious Chronomancer: the merged Disarm KeywordDef matches the printed rules text", () => {
  const registered = keywordDefinitionsById.get("Disarm");
  assert.ok(registered, "effects/keywords/Disarm.ts must be registered");
  assert.equal(registered, disarm);
  // 831.1.d.1 / 831.2: all instances on one Unit produce one summed trigger.
  assert.equal(registered.valued, true);
  assert.equal(registered.stacking, "sum");
  assert.ok(registered.ruleRefs.includes("831.1.d"));
  assert.ok(registered.ruleRefs.includes("831.2"));
});

test("rad-050-167 Mysterious Chronomancer: the [Disarm 2] expansion is an attack trigger for -2 Might this turn", () => {
  const [expansion] = disarm.expand({
    value: disarmAbility.value,
    host: { canonicalCardId: CANONICAL }
  });
  assert.equal(expansion.kind, "triggered");
  assert.equal(expansion.trigger.at, "attack-declared");
  assert.deepEqual(expansion.trigger.filter, {
    event: "attack-declared",
    filter: { source: "self" }
  });
  assert.equal(expansion.optional, false);

  // 831.1.b: "give an enemy unit here -2 [M] this turn" is one continuous.might
  // instruction with an enemy-unit target at the host's location.
  assert.equal(expansion.body.length, 1);
  const [instruction] = expansion.body;
  assert.equal(instruction.op, "continuous.might");
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: -2 });
  assert.deepEqual(instruction.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(instruction.targets, [
    {
      id: "disarm.enemy-unit",
      filter: { type: "unit", zone: "board", controller: "opponent", sameLocationAs: "source" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("rad-050-167 Mysterious Chronomancer: the expanded -2 Might really registers an arithmetic-layer effect", () => {
  const [expansion] = disarm.expand({ value: 2, host: { canonicalCardId: CANONICAL } });
  const [instruction] = expansion.body;
  const kernel = world()
    .unit("chronomancer", { might: 4 })
    .unit("enemy", { owner: "B", might: 5 })
    .build();
  const enemy = kernel.ref("enemy");
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("chronomancer") });

  // runInstruction invokes the primitive directly, so it receives evaluated
  // literals (the interpreter is what evaluates the Expr args of the card IR).
  const run = runInstruction(
    might,
    { amount: -2, duration: "this-turn", target: "disarm.enemy-unit" },
    { world: scoped, targets: { "disarm.enemy-unit": [enemy] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.result.linkedValues.affected.count, 1);
  assert.deepEqual(run.result.linkedValues.affected.objects, [enemy]);
  assert.equal(scoped.continuousEffects.length, 1);
  const [registered] = scoped.continuousEffects;
  // 143.2.a / 475: the -2 Might is an arithmetic-layer modification that lasts
  // until end of turn (317.2.c), never a Buff counter (702).
  assert.equal(registered.effect.layer, "arithmetic");
  assert.deepEqual(registered.duration, { type: "end-of-turn" });
  assert.equal(registered.effect.effect.kind, "continuous.might");
  assert.equal(registered.effect.effect.amount, -2);
  assert.equal(kernel.getObject("enemy").buffs, 0);
  // The instruction the card's keyword expansion declares is the executed one.
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: -2 });
});

test.todo(
  "rad-050-167 Mysterious Chronomancer: expand [Predict 2] (look at the top 2, recycle any, put the rest back in any " +
    "order — CR 437.1 / 437.1.a / 437.3) into a reusable kw-predict KeywordDef; RIFT-269 only covers the composition, " +
    "and no shared Predict KeywordDef is merged"
);

test.todo(
  "rad-050-167 Mysterious Chronomancer: effect.inspect's non-zero top scope needs an upstream ordered picks provider " +
    "(the merged implementation negates with impossible without one; CR 437.1.a / 437.4)"
);

test.todo(
  "rad-050-167 Mysterious Chronomancer: register the card's keyword abilities (Predict + Disarm) into the layer and " +
    "timing systems — no merged path consumes a CardProgram keyword ability (RIFT-257), and attack-declared has no producer"
);
