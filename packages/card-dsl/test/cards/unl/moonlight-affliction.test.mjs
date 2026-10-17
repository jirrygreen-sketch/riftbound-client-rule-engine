import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/moonlight-affliction.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-3dfe95c2b5760342ff53da5b907465cf7b0aa40a27553cfdfa36e7a449d7530b";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Give a unit -10 :rb_might: this turn.";

const [keyword, play] = program.abilities;
const [mightInstruction] = play.body;

test("unl-066-219 Moonlight Affliction: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
});

test("unl-066-219 Moonlight Affliction: identity, ruleset, executable status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardProgramsById.get(program.canonicalCardId), program);
});

test("unl-066-219 Moonlight Affliction: [Reaction], printed cost and one printed instruction", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(keyword, { kind: "keyword", keyword: "reaction" });
  assert.equal(keyword.value, undefined);
  assert.equal(play.kind, "play");
  // Catalog printing: 7 energy, no printed power.
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 7 }
  });
  assert.deepEqual(
    play.body.map((instruction) => [instruction.id, instruction.op]),
    [["moonlight-affliction.give-minus-10-might", "continuous.might"]]
  );
});

test("unl-066-219 Moonlight Affliction: 'Give a unit -10 Might this turn' targets one Board unit", () => {
  // 355.5 / 355.5.a: "a unit" is an explicit choice of one game object, so it
  // is a target; 424.1-style Board restriction is carried by the filter.
  assert.deepEqual(mightInstruction.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "moonlight-affliction.chosen-unit" }
  });
  assert.deepEqual(mightInstruction.targets, [
    {
      id: "moonlight-affliction.chosen-unit",
      filter: { type: "unit", zone: "board" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(mightInstruction.linkedTo, undefined);
  assert.equal(mightInstruction.picks, undefined);
  assert.equal(mightInstruction.condition, undefined);
});

test("unl-066-219 Moonlight Affliction: the -10 is temporary, never reduced or substituted by a Buff", () => {
  // 143.2.a: the card's "Might" is the layered effective value; 143.2.c keeps a
  // Might below 0 as 0 only when referenced (and 143.2.c.1 keeps the real value
  // for later calculations); 317.2.c expires it in the end-of-turn cleanup.
  // effect.buff only adds CR 702/703 counters, so it is never used here.
  assert.deepEqual(mightInstruction.args.amount, { kind: "constant", value: -10 });
  assert.deepEqual(mightInstruction.args.duration, { kind: "constant", value: "this-turn" });
  // The floor is a layers evaluation rule, not a card-side clamp: the printed
  // -10 stays exactly as printed, and the instruction is never effect.buff.
  assert.notEqual(mightInstruction.op, "effect.buff");
});

function affectedWorld(might) {
  const kernel = world()
    .unit("target-unit", { owner: "B", controller: "B", might })
    .build();
  kernel.setTargets("moonlight-affliction.chosen-unit", [kernel.ref("target-unit")]);
  return kernel;
}

const registrations = kernel => kernel.continuousEffects.map(entry => ({
  effect: entry.effect,
  duration: entry.duration,
  timestamp: 1
}));

test("unl-066-219 Moonlight Affliction golden: the card body registers -10 Might until end of turn", () => {
  const kernel = affectedWorld(12);
  const outcome = resolveChainBody(play.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["moonlight-affliction.give-minus-10-might", "executed"]
  ]);
  assert.equal(kernel.continuousEffects.length, 1);
  assert.equal(kernel.continuousEffects[0].effect.layer, "arithmetic");
  assert.equal(kernel.continuousEffects[0].effect.effect.kind, "continuous.might");
  assert.equal(kernel.continuousEffects[0].effect.effect.amount, -10);
  assert.deepEqual(kernel.continuousEffects[0].duration, { type: "end-of-turn" });
  const layers = createLayerEngine(kernel.objects, registrations(kernel));
  assert.equal(layers.evaluate(kernel.ref("target-unit")).might, 2);
  assert.deepEqual(layers.advance({ id: "turn-end" }).length, 1);
  assert.equal(layers.evaluate(kernel.ref("target-unit")).might, 12);
});

test("unl-066-219 Moonlight Affliction golden: negative effective Might is referenced as zero", () => {
  const kernel = affectedWorld(8);
  resolveChainBody(play.body, kernel);
  const layers = createLayerEngine(kernel.objects, registrations(kernel));
  assert.equal(layers.evaluate(kernel.ref("target-unit")).might, 0);
});

test("unl-066-219 Moonlight Affliction golden: a stale target is ignored instead of retargeted", () => {
  const kernel = affectedWorld(12);
  const stale = kernel.ref("target-unit");
  kernel.perform({ type: "kill", object: stale });
  kernel.setTargets("moonlight-affliction.chosen-unit", [stale]);
  const outcome = resolveChainBody(play.body, kernel);
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.continuousEffects.length, 0);
});
