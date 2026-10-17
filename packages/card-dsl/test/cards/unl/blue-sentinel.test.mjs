import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/blue-sentinel.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL_ID =
  "card.hash-cc5b4c7c8552ab416ee26137732c2e83c4df87b7e9fed57fdc4d1c19b390bcba";
const SOURCE_TEXT =
  "[Shield 2] (+2 :rb_might: while I'm a defender.)\n" +
  "Your hold effects for holding here trigger an additional time.\n" +
  "When I hold, [Add] :rb_rune_rainbow: at the start of your next Main Phase. " +
  "(Abilities that add resources can't be reacted to.)";

const [shield, multiplicity, holdTrigger] = program.abilities;
const [scheduleAdd] = holdTrigger.body;
const [addPower] = scheduleAdd.args.body.value;

test("unl-087-219 Blue Sentinel: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-087-219 Blue Sentinel: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /trigger|触发倍率/);
  assert.match(program.judgeReason, /trigger\.delayed/);
  assert.match(program.judgeReason, /Universal Power/);
  assert.match(program.judgeReason, /163\.2\.b/);
  assert.doesNotMatch(program.judgeReason, /RIFT-(9|120|257)/);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-087-219 Blue Sentinel: [Shield 2] is a valued keyword declaration", () => {
  // 814.1.b / 814.1.b.2: the printed "Shield 2" carries its Shield Value.
  assert.deepEqual(shield, { kind: "keyword", keyword: "shield", value: 2 });
});

test("unl-087-219 Blue Sentinel: 'hold effects here trigger an additional time' keeps the multiplicity shape", () => {
  // 383.4.d.2.b: the rewrite applies to the controller's hold effects at this
  // battlefield; the trigger-collection stage owns it (same shape as
  // ogn/karthus-eternal and rad/detonation-amplifier).
  assert.equal(multiplicity.kind, "static");
  assert.equal(multiplicity.effect.kind, "continuous.trigger-multiplicity");
  assert.deepEqual(multiplicity.effect.mode, "additional");
  assert.deepEqual(multiplicity.effect.amount, { kind: "constant", value: 1 });
  assert.deepEqual(multiplicity.effect.appliesTo, {
    keyword: "hold-effect",
    controller: "controller",
    zone: "board",
    here: true
  });
  assert.equal(multiplicity.condition, undefined);
});

test("unl-087-219 Blue Sentinel: 'When I hold' schedules the [Add] for the next Main Phase", () => {
  // 383.4.d / 383.4.d.1: the Hold Effect at the closed hold timing point,
  // filtered to this source.
  assert.equal(holdTrigger.kind, "triggered");
  assert.equal(holdTrigger.trigger.at, "hold");
  assert.deepEqual(holdTrigger.trigger.filter, { event: "hold", filter: { source: "self" } });
  assert.equal(holdTrigger.optional, false);

  // 391.2 / 392: "at the start of your next Main Phase" is a delayed trigger;
  // no merged opcode consumes ctx.registerDelayedTrigger.
  assert.equal(scheduleAdd.op, "trigger.delayed");
  assert.deepEqual(scheduleAdd.args.at, { kind: "constant", value: "main-start" });
  assert.deepEqual(scheduleAdd.args.window, { kind: "constant", value: "next-main-phase" });
  assert.equal(scheduleAdd.args.body.kind, "constant");
  assert.deepEqual(scheduleAdd.args.body.value.map(instruction => instruction.id), [
    "blue-sentinel.add-universal-power"
  ]);

  // 430.1 / 430.5: [Add] :rb_rune_rainbow: adds one Universal Power; the closed
  // six-domain set has no Universal value, so the exact spelling is kept and
  // the primitive refuses it (never substituted by a named domain).
  assert.equal(addPower.op, "effect.resources");
  assert.deepEqual(addPower.args.power, { kind: "constant", value: ["rainbow"] });
  assert.equal(addPower.args.energy, undefined);
  assert.equal(addPower.targets, undefined);
});

test.todo(
  "unl-087-219 Blue Sentinel: execute the [Add] :rb_rune_rainbow: body through effect.resources once Universal Power " +
    "is representable (CR 163.2.b / 430.1) — no execution scenario is claimed here"
);

test.todo(
  "unl-087-219 Blue Sentinel: 'trigger an additional time' consumed at trigger collection " +
    "(CR 383.4.d.2.b) — Ability has no trigger multiplier and events/ has no multiplicity hook"
);
test.todo(
  "unl-087-219 Blue Sentinel: register the delayed trigger for 'the start of your next Main Phase' " +
    "(CR 391.2 / 392) — no merged primitive consumes ctx.registerDelayedTrigger and no next-phase window exists"
);
test.todo(
  "unl-087-219 Blue Sentinel: add the [A] Universal Power to the Rune Pool (CR 163.2.b / 135.2.e.5) — " +
    "contract change request (closed six-domain Domain type / gain-power action)"
);
