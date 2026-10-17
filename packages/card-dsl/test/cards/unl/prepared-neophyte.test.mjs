import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/prepared-neophyte.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { historyCount } from "../../../../engine-core/dist/effects/interpreter/history.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

const CANONICAL_ID =
  "card.hash-c745e78b66006751f13b0d22fe0e99f6be02c370c981380ca0ec714e076b0d3b";
const SOURCE_TEXT =
  "If you've spent :rb_energy_4: or more to play a spell this turn, I have +4 :rb_might:.";

const [ability] = program.abilities;

test("unl-004-219 Prepared Neophyte: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-004-219 Prepared Neophyte: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /HistoryQuery/);
  // The stale "no continuous.might primitive / no card static registration" gap is
  // gone (RIFT-258 + RIFT-257); the reason must name the real remaining gaps.
  assert.match(program.judgeReason, /RIFT-258/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /conditionMatches/);
  assert.doesNotMatch(program.judgeReason, /没有 continuous\.might 的文件|无调用方/);
});

test("unl-004-219 Prepared Neophyte: one conditional static +4 Might ability", () => {
  assert.equal(program.abilities.length, 1);
  // 364.3 / 364.3.a: the "If …" statement is a Conditional Passive Ability, so
  // the card carries a static ability with a condition rather than a trigger.
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "continuous.might");
  assert.equal(ability.effect.mode, "add");
  assert.equal(ability.effect.layer, "arithmetic");
  assert.equal(ability.effect.appliesTo, "self");
  assert.deepEqual(ability.effect.amount, { kind: "constant", value: 4 });
});

test("unl-004-219 Prepared Neophyte: the condition keeps the printed amount threshold of 4", () => {
  assert.equal(ability.condition.kind, "compare");
  assert.equal(ability.condition.operator, "gte");
  assert.deepEqual(ability.condition.right, { kind: "constant", value: 4 });
  assert.equal(ability.condition.left.kind, "count");
  assert.equal(ability.condition.left.subject, "energy-spent-on-spells-this-turn");
  assert.deepEqual(ability.condition.left.filter, { player: "controller", type: "spell" });
});

test("unl-004-219 Prepared Neophyte: the merged history count is an action count, not an Energy amount", () => {
  // Drive the merged evaluator over the this-turn window the card's condition
  // names. A kill action with no Energy spent moves the count, which is how the
  // merged history dimension differs from the printed "Energy spent" clause; the
  // exact predicate gap is recorded in judgeReason and the test.todo below.
  const kernel = world().unit("victim", { zone: "board", controller: "B" }).build();
  assert.equal(historyCount({ scope: "turn" }, kernel), 0);
  const ref = kernel.ref("victim");
  kernel.perform({ type: "kill", object: ref });
  assert.equal(historyCount({ scope: "turn", action: "kill" }, kernel), 1);
  assert.equal(historyCount({ scope: "turn", action: "damage" }, kernel), 0);
  // Nothing was paid to play a spell, yet the history window is non-empty.
  assert.equal(kernel.player("A").energy, 0);
});

test("unl-004-219 Prepared Neophyte: the generated card registry exposes the program under its canonical id", () => {
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test.todo(
  "unl-004-219 Prepared Neophyte: read the Energy actually spent to play a spell this turn (CR 383.2 / 206) and compare " +
    "it with the printed 4 — merged Expr/Condition has no spent-amount read, the frozen HistoryQuery counts actions only, " +
    "and cost/payment.ts receipts never reach ResolveContext"
);

test.todo(
  "unl-004-219 Prepared Neophyte: apply +4 Might in the arithmetic layer while the conditional passive holds " +
    "(CR 143.2.a / 475) — the merged registration path exists, but layers/engine.ts conditionMatches does not " +
    "evaluate the card's compare condition and treats unknown conditions as true"
);

test("unl-004-219 Prepared Neophyte golden: the declaration really registers +4 Might in the arithmetic layer", () => {
  // The card's static effect is the merged continuous.might shape (143.2.a / 475).
  // Run its executable form through the production chain adapter: the arithmetic
  // registration and the layer evaluation both really happen; what is missing is
  // the condition gate in layers/engine.ts, recorded in judgeReason.
  const kernel = world().unit("neophyte", { might: 1 }).build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("neophyte"), source: kernel.ref("neophyte") });
  const outcome = resolveChainBody([{
    id: "neophyte.might", op: "continuous.might",
    args: { amount: ability.effect.amount, mode: { kind: "constant", value: ability.effect.mode }, appliesTo: { kind: "constant", value: ability.effect.appliesTo } }
  }], context);

  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(context.continuousEffects.length, 1);
  assert.equal(context.continuousEffects[0].effect.layer, "arithmetic");
  assert.equal(context.continuousEffects[0].effect.effect.amount, 4);
  const layers = createLayerEngine(context.objects, context.continuousEffects);
  assert.equal(layers.evaluate(context.ref("neophyte")).might, 5);
});
