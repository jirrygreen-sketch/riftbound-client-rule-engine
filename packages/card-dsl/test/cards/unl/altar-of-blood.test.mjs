import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/altar-of-blood.js";
import exhaust from "../../../../engine-core/dist/effects/instructions/effect.exhaust.js";
import heal from "../../../../engine-core/dist/effects/instructions/effect.heal.js";
import { bindReplacement } from "../../../../engine-core/dist/replacement/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-8a6701849fc591215d101121138ec91bc46da22693dc4c35b90fbfe6c36f0155";
const SOURCE_TEXT =
  "If a unit here would die during combat, its controller may pay " +
  ":rb_rune_rainbow::rb_rune_rainbow::rb_rune_rainbow: to heal it, exhaust it, and recall it instead.";
const HERE = { type: "battlefield", id: "battlefield-1" };

const [replacement] = program.abilities;
const [optional] = replacement.with;
const [pay, healInstruction, exhaustInstruction, recallInstruction] = optional.args.body.value;

test("unl-206-219 Altar of Blood: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-206-219 Altar of Blood: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Recall/);
  assert.match(program.judgeReason, /457-460/);
  assert.match(program.judgeReason, /rainbow/);
  // RIFT-260's replacement layer is merged, so the reason must name what it
  // actually refuses rather than the old "no registration path" claim.
  assert.match(program.judgeReason, /bindReplacement/);
  assert.doesNotMatch(program.judgeReason, /没有任何已合入路径读取/);
});

test("unl-206-219 Altar of Blood: a replacement over a unit death at this battlefield", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(replacement.kind, "replacement");
  // 369.1/370.1.a.1: the replaced event is the death itself; 053.3 anchors
  // "here" to the source Battlefield.
  assert.equal(replacement.replaces.event, "object-killed");
  assert.deepEqual(replacement.replaces.filter, {
    type: "unit",
    zone: "board",
    sameLocationAs: "self"
  });
  assert.equal(replacement.condition, undefined);
});

test("unl-206-219 Altar of Blood: the optional three-Rune payment wraps heal, exhaust and recall", () => {
  // 355.10.c: "it" is part of the replacement effect, so the payment decision
  // is the optional node — no choice-plus-linkedTo shape (contract 3.9).
  assert.equal(replacement.with.length, 1);
  assert.equal(optional.id, "altar-of-blood.opt-in");
  assert.equal(optional.op, "choice.optional");
  assert.equal(optional.linkedTo, undefined);
  assert.deepEqual(optional.args.body.value.map(entry => entry.id), [
    "altar-of-blood.pay",
    "altar-of-blood.heal",
    "altar-of-blood.exhaust",
    "altar-of-blood.recall"
  ]);

  // 163.2.b/135.2.e.5: three Universal Power runes; the frozen cost model has
  // no executable arbitrary-domain value, so "rainbow" stays the merged
  // descriptive spelling (same as ven/matriarch-of-war).
  assert.equal(pay.op, "cost.pay");
  assert.deepEqual(pay.args.power, {
    kind: "constant",
    value: ["rainbow", "rainbow", "rainbow"]
  });

  // Each follow-up is linked to the previous step so a failed payment stops
  // the chain of instructions (359.3.e.14).
  assert.equal(healInstruction.linkedTo, "altar-of-blood.pay");
  assert.equal(exhaustInstruction.linkedTo, "altar-of-blood.heal");
  assert.equal(recallInstruction.linkedTo, "altar-of-blood.exhaust");
  for (const instruction of [healInstruction, exhaustInstruction, recallInstruction]) {
    assert.deepEqual(instruction.args.objects, { kind: "constant", value: { linked: "replacement.object" } });
    assert.equal(instruction.targets, undefined, "the affected unit is a referent, not a chosen target");
  }

  // 460.1: the printed recall is 457-460's Recall; effect.move accepts the mode
  // but reports the blocked action instead of substituting a Move.
  assert.equal(recallInstruction.op, "effect.move");
  assert.deepEqual(recallInstruction.args.mode, { kind: "constant", value: "recall" });
  assert.deepEqual(recallInstruction.args.to, { kind: "constant", value: "controller-base" });
});

test("unl-206-219 Altar of Blood: the merged heal primitive clears the doomed unit's marked damage", () => {
  const kernel = world()
    .unit("altar", { types: ["battlefield"], location: HERE })
    .unit("doomed", { location: HERE, might: 3, damage: 3 })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("altar") });
  const run = runInstruction(
    heal,
    { objects: { kind: "constant", value: { kind: "target", id: "altar-of-blood.dying-unit" } } },
    { world: scoped, targets: { "altar-of-blood.dying-unit": [scoped.ref("doomed")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.healed.count, 1);
  assert.deepEqual(run.linked.healed.objects, [{ id: "doomed", zoneEntryId: 1 }]);
  assert.equal(scoped.getObject("doomed").damage, 0);
  assert.deepEqual(run.events.map(event => event.action), ["heal"]);
});

test("unl-206-219 Altar of Blood: the merged exhaust primitive sets the state the printed line asks for", () => {
  const kernel = world()
    .unit("altar", { types: ["battlefield"], location: HERE })
    .unit("doomed", { location: HERE, might: 3, exhausted: false })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("altar") });
  const run = runInstruction(
    exhaust,
    { target: "altar-of-blood.dying-unit" },
    { world: scoped, targets: { "altar-of-blood.dying-unit": [scoped.ref("doomed")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(scoped.getObject("doomed").exhausted, true);
  assert.deepEqual(run.events.map(event => event.action), ["exhaust"]);
});

test("unl-206-219 Altar of Blood: the real pipeline accepts the isolated heal/exhaust replacement plan and binds 'it'", () => {
  // CR 370.1.a.1 / 355.10.c: RIFT-260 turns the card's replaces pattern into a
  // pipeline registration and binds the replaced event's object through
  // { linked: "replacement.object" }. The golden asserts that registration is
  // real; it deliberately does not re-implement the printed payment.
  const f = fixture({ cards: [
    { id: "altar", types: ["battlefield"], might: null, energy: null, power: null },
    { id: "doomed", types: ["unit"], might: 3 }
  ] });
  const kernel = f.kernel;
  for (const id of ["altar", "doomed"]) {
    f.engine.commit({ type: "move-zone", object: kernel.ref(id), to: "battlefield", location: HERE });
  }
  // Exercise the original supported subinstructions, without the still-blocked
  // optional payment and Recall. This verifies planning, not the complete card.
  const ability = {
    replaces: replacement.replaces,
    with: [healInstruction, exhaustInstruction]
  };
  const bound = bindReplacement(ability, kernel.ref("altar"), {
    host: { object: ref => kernel.object(ref), objects: () => kernel.objects, context: () => kernel },
    pipeline: f.engine.pipeline
  });

  assert.equal(bound.registration.id, `replacement:altar:${kernel.ref("altar").zoneEntryId}`);
  assert.deepEqual(bound.registration.source.ref, kernel.ref("altar"));
  // The ability really matches a unit death at this battlefield.
  const plan = bound.registration.apply(
    { type: "kill", object: kernel.ref("doomed") },
    { type: "kill", object: kernel.ref("doomed") }
  );
  assert.equal(plan.status, "replace");
  assert.deepEqual(plan.actions.map(action => action.type), ["heal", "exhaust"]);
  bound.cancel();
});

test.todo(
  "unl-206-219 Altar of Blood: bind the program's printed body (choice.optional around the three-Rune payment) " +
    "once the planner accepts an optional/payment replacement shape — today only the closed GameAction " +
    "opcode set is planned, so the wrapper fails loudly at bind time instead of replacing the death when the " +
    "player declines"
);

test.todo(
  "unl-206-219 Altar of Blood: execute the three-rune Universal Power payment (163.2.b / 135.2.e.5) " +
    "and the Recall action (457-460), so the doomed unit really reaches its Base without being a Move"
);

test.todo(
  "Altar of Blood: plan unqualified Heal as clearing all marked damage (419.1), preserving the amount-omitted semantics of effect.heal"
);
test.todo(
  "Altar of Blood: restrict the replacement to unit deaths during combat using an authoritative combat-death discriminator"
);
