import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/twilight-shroud.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

const CANONICAL = "card.hash-e54ee1b49e982f2d0d89cb2a1ada3688523cfee6c53db33c9aa872c7802ea0df";
const SOURCE_TEXT =
  "Give a friendly unit +1 :rb_might: this turn. It can't be chosen by enemy spells and abilities this turn.\n" +
  "[Flow] :rb_energy_2: (You may play this from your trash for its Flow cost. Then banish it.)";

const [flowKeyword, play] = program.abilities;
const [mightInstruction, restrictInstruction] = play.body;
const [unitSpec] = mightInstruction.targets;

test("ven-031-166 Twilight Shroud: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
});

test("ven-031-166 Twilight Shroud: identity, ruleset, status, judgeReason and verbatim text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /355\.9\.b/);
  assert.match(program.judgeReason, /params\.cost/);
  assert.doesNotMatch(program.judgeReason, /RIFT-9|RIFT-90|RIFT-91|RIFT-260|RIFT-261/);
});

test("ven-031-166 Twilight Shroud: [Flow], the energy-only cost, and the two remaining clauses", () => {
  assert.deepEqual(flowKeyword, { kind: "keyword", keyword: "flow" });
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 1 }
  });
  assert.equal(Object.hasOwn(play.cost, "power"), false);

  // "+1 Might this turn": a temporary Might modification (317.2.c / 143.2.a),
  // never a Buff counter (702/703).
  assert.equal(mightInstruction.id, "twilight-shroud.grant-might");
  assert.equal(mightInstruction.op, "continuous.might");
  assert.deepEqual(mightInstruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(mightInstruction.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(mightInstruction.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "twilight-shroud.friendly-unit" }
  });
  assert.deepEqual(unitSpec, {
    id: "twilight-shroud.friendly-unit",
    filter: { type: "unit", zone: "board", controller: "controller" },
    min: 1,
    max: 1,
    selection: "one"
  });

  // "It can't be chosen by enemy spells and abilities this turn": 355.9.b's own
  // example of a targeting restriction, on the same unit ("it", 359.3.e.14).
  assert.equal(restrictInstruction.id, "twilight-shroud.cannot-be-chosen");
  assert.equal(restrictInstruction.op, "continuous.restrict");
  assert.equal(restrictInstruction.linkedTo, "twilight-shroud.grant-might");
  assert.deepEqual(restrictInstruction.args.restriction, {
    kind: "constant",
    value: "cannot-be-chosen-by-enemy-spells-and-abilities"
  });
  assert.deepEqual(restrictInstruction.args.action, { kind: "constant", value: "target" });
  assert.deepEqual(restrictInstruction.args.target, {
    kind: "constant",
    value: "twilight-shroud.friendly-unit"
  });
  assert.deepEqual(restrictInstruction.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(restrictInstruction.targets, mightInstruction.targets);
});

test.todo(
  "ven-031-166 Twilight Shroud: enforce \"It can't be chosen by enemy spells and abilities this turn\" " +
    "(355.9.b) — continuous.restrict is registered, but the target consumer still needs to interpret the " +
    "restriction together with the enemy spell/ability actor"
);

test.todo(
  "ven-031-166 Twilight Shroud: play from trash for the printed Flow cost (2 energy) then banish it — the " +
    "printed cost cannot reach KeywordDef.expand (contract 3.8.3), so the Flow alternate-cost and banish consumers remain incomplete"
);

test("ven-031-166 Twilight Shroud golden: +1 Might and the targeting restriction register on the chosen unit", () => {
  const base = world()
    .unit("friendly", { controller: "controller", owner: "controller", might: 3 })
    .build();
  const kernel = base.clone({
    source: base.ref("friendly"),
    sourceSnapshot: base.getObject("friendly"),
    controller: "controller"
  });
  kernel.setTargets("twilight-shroud.friendly-unit", [kernel.ref("friendly")]);

  const outcome = resolveChainBody(play.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["twilight-shroud.grant-might", "executed"],
    ["twilight-shroud.cannot-be-chosen", "executed"]
  ]);
  assert.equal(kernel.continuousEffects.length, 2);
  const might = kernel.continuousEffects.find(entry => entry.effect.effect.kind === "continuous.might");
  assert.ok(might);
  assert.equal(might.effect.layer, "arithmetic");
  assert.equal(might.effect.filter.objectId, "friendly");
  assert.deepEqual(might.duration, { type: "end-of-turn" });
  assert.equal(createLayerEngine(
    kernel.objects,
    kernel.continuousEffects.map(entry => ({ effect: entry.effect, duration: entry.duration, timestamp: 1 }))
  ).evaluate(kernel.ref("friendly")).might, 4);

  const restriction = kernel.continuousEffects.find(entry => entry.effect.effect.kind === "restriction");
  assert.ok(restriction);
  assert.deepEqual(restriction.effect.effect.actions, ["target"]);
  assert.equal(restriction.effect.effect.restriction, "cannot-be-chosen-by-enemy-spells-and-abilities");
  assert.deepEqual(restriction.duration, { type: "end-of-turn" });
});
