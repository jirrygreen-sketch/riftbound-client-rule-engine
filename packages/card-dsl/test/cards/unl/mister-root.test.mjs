import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/mister-root.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID =
  "card.hash-2f32c6395b7dc0bd6975c6b7bb280cc4c1c63da74289ee612c41dd38e92b8074";
const SOURCE_TEXT =
  "[Accelerate] (You may pay :rb_energy_1::rb_rune_chaos: as an additional cost to have me enter ready.)\n" +
  "When I move to a battlefield, gain 2 XP.";

const [keyword, triggered] = program.abilities;
const [gainXp] = triggered.body;

test("unl-127-219 Mister Root: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-127-219 Mister Root: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Accelerate/);
  assert.match(program.judgeReason, /move-location/);
  assert.match(program.judgeReason, /449\.1/);
  assert.match(program.judgeReason, /toZone/);
});

test("unl-127-219 Mister Root: unvalued Accelerate keyword plus the move-to-battlefield trigger", () => {
  assert.equal(program.abilities.length, 2);
  // 805.1.b: the printed cost is fixed at [1][C], so the keyword carries no value.
  assert.deepEqual(keyword, { kind: "keyword", keyword: "accelerate" });

  assert.equal(triggered.kind, "triggered");
  // 421.1 / 449.1 / 449.2 / 458: a Move, not a Recall.
  assert.equal(triggered.trigger.at, "object-moved");
  assert.deepEqual(triggered.trigger.filter, {
    event: "object-moved",
    toZone: "battlefield",
    filter: { source: "self" }
  });
  assert.equal(triggered.optional, false);
  assert.equal(triggered.trigger.once, undefined);
});

test("unl-127-219 Mister Root: the effect is a plain gain 2 XP (730.1 / 190.6.d)", () => {
  assert.equal(triggered.body.length, 1);
  assert.equal(gainXp.id, "mister-root.gain-xp");
  assert.equal(gainXp.op, "effect.xp");
  assert.deepEqual(gainXp.args, { amount: { kind: "constant", value: 2 } });
  assert.equal(gainXp.targets, undefined);
  assert.equal(gainXp.picks, undefined);
  assert.equal(gainXp.linkedTo, undefined);
});

test("unl-127-219 Mister Root: the declared keyword id matches the merged Accelerate KeywordDef", () => {
  const registered = keywordDefinitionsById.get("Accelerate");
  assert.ok(registered, "effects/keywords/Accelerate.ts must be in the generated keyword registry");
  assert.equal(keyword.keyword, registered.keyword.toLowerCase());
  assert.equal(registered.valued, false);
  assert.ok(registered.ruleRefs.includes("805.1.b"));
});

test("unl-127-219 Mister Root golden: the trigger body really gains 2 XP for the ability controller", () => {
  const kernel = world().build();
  const outcome = resolveChainBody(triggered.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["mister-root.gain-xp", "executed"]
  ]);
  // 730.1 / 733: XP is marked on the gaining player and has no cap.
  assert.equal(kernel.player("A").xp, 2);
  assert.equal(kernel.player("B").xp, 0);
  assert.equal(outcome.linkedValues["mister-root.gain-xp.gained"], 2);
  assert.equal(outcome.linkedValues["mister-root.gain-xp.gainedTo"], "A");
  assert.deepEqual(outcome.events.map(event => event.action), ["gain-xp"]);
});

test("unl-127-219 Mister Root golden: a replaced gain-xp is reported as negated, never as XP", () => {
  const kernel = world().build();
  kernel.addReplacement(action => (action.type === "gain-xp" ? "replaced" : null));
  const outcome = resolveChainBody(triggered.body, kernel);
  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "replaced");
  assert.equal(kernel.player("A").xp, 0);
});

test.todo(
  "unl-127-219 Mister Root: [Accelerate] (CR 805.1.b additional cost + 805.6 enter-ready replacement) — the " +
    "KeywordDef and replacement binding are merged, but the additional-cost Finalize consumer and the pay-before-entry " +
    "delay are still missing"
);
test.todo(
  "unl-127-219 Mister Root: subscribe 'When I move to a battlefield' for real (CR 449.1/449.2 targets and " +
    "458/458.1 Recall exclusion) — action-adapter.ts leaves toZone/toKind/toLocationId unset on object-moved and the " +
    "inner source: self anchor has no consumer"
);
