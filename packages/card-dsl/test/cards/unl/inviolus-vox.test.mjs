import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/inviolus-vox.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-f11b51df9013e0151586a2443eb2342dba8ad5f6aa01ea4e5f5bb83f35e722df";
const SOURCE_TEXT = "When I conquer, give a friendly unit +8 :rb_might: this turn.";

const [conquerTrigger] = program.abilities;
const [grantMight] = conquerTrigger.body;
const targetSpec = grantMight.targets[0];

test("unl-027-219 Inviolus Vox: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-027-219 Inviolus Vox: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /143\.2/);
  assert.match(program.judgeReason, /702/);
  assert.match(program.judgeReason, /RIFT-91/);
});

test("unl-027-219 Inviolus Vox: the conquer trigger is a Conquer Effect on self", () => {
  assert.equal(program.abilities.length, 1);
  // 383.4.c / 383.4.c.1 / 383.4.c.2.a: "When I conquer" is a Conquer Effect put
  // on the chain after this unit conquers a battlefield; 383.4.c.2.c keeps it
  // independent of whether the point gain was replaced.
  assert.equal(conquerTrigger.kind, "triggered");
  assert.equal(conquerTrigger.trigger.at, "conquer");
  assert.deepEqual(conquerTrigger.trigger.filter, {
    event: "conquer",
    filter: { source: "self" }
  });
  assert.equal(conquerTrigger.trigger.condition, undefined);
  assert.equal(conquerTrigger.trigger.once, undefined);
  assert.equal(conquerTrigger.optional, false);
  assert.equal(conquerTrigger.body.length, 1);
});

test("unl-027-219 Inviolus Vox: +8 Might for the turn is recorded with its target shape", () => {
  assert.equal(grantMight.id, "inviolus-vox.grant-might-8");
  // No merged continuous.might primitive exists; the op records the intended
  // arithmetic-layer effect (see judgeReason) and must not be approximated with
  // effect.buff (702 Buff counters are a different thing).
  assert.equal(grantMight.op, "continuous.might");
  assert.deepEqual(grantMight.args.amount, { kind: "constant", value: 8 });
  assert.deepEqual(grantMight.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(grantMight.args.layer, { kind: "constant", value: "arithmetic" });
  assert.deepEqual(grantMight.args.mode, { kind: "constant", value: "add" });
  // 355.9 / 355.9.a.1: "a friendly unit" is one chosen Board unit controlled by
  // the ability's controller.
  assert.deepEqual(targetSpec, {
    id: "inviolus-vox.friendly-unit",
    filter: { type: "unit", controller: "controller", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(grantMight.picks, undefined);
  assert.equal(grantMight.linkedTo, undefined);
  assert.equal(grantMight.condition, undefined);
});

test("unl-027-219 Inviolus Vox: the +8 amount is a literal, not a read of some other value", () => {
  // The modifier is a fixed +8 (the printed amount), unlike a Doubling effect
  // which reads the current value at resolution. The reference kernel resolves
  // the program's own expression to confirm the authored value.
  const kernel = world().unit("vox", { might: 8 }).build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.getObject("vox") });
  assert.equal(ctx.evaluate(grantMight.args.amount), 8);
  assert.equal(grantMight.args.amount.kind, "constant");
  assert.equal(grantMight.args.amount.value, 8);
});

test.todo(
  "unl-027-219 Inviolus Vox: apply +8 Might in the arithmetic layer with a this-turn duration and cleanup" +
    " expiry (CR 143.2.a / 475 / 478; no continuous.might instruction is merged — RIFT-91)"
);
test.todo(
  "unl-027-219 Inviolus Vox: the conquer trigger is registered and its friendly-unit target is locked at" +
    " Finalize (CR 383.4.c.2.a; RIFT-120 / RIFT-90)"
);
