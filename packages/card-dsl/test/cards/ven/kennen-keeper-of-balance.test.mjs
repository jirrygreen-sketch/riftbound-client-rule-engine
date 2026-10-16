import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/kennen-keeper-of-balance.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-6d5c7c18a2ff9af74ab3f4a4b8ac837540733c2922614f53be32ab4e75be8f6b";
const SOURCE_TEXT =
  "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
  "When you play me or I attack, you may pay :rb_energy_2: to [Stun] a unit. " +
  "(It doesn't deal combat damage this turn.)\n" +
  "While there's a stunned enemy unit here, I have +2 :rb_might:.";

const [hidden, playAbility, attackAbility, mightAura] = program.abilities;
const playChoice = playAbility.body[0];
const attackChoice = attackAbility.body[0];

const kennenKernel = () => {
  const base = world()
    .player("controller")
    .unit("kennen", { controller: "controller", location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy", { owner: "B", controller: "B", location: { type: "battlefield", id: "bf-1" } })
    .build();
  return base.clone({ controller: "controller", sourceSnapshot: base.getObject("kennen") });
};

test("ven-135-166 Kennen, Keeper of Balance: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ven-135-166 Kennen: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /cost\.pay/);
  assert.match(program.judgeReason, /Hidden/);
  assert.match(program.judgeReason, /continuous\.might/);
});

test("ven-135-166 Kennen: [Hidden] declared, play and attack triggers both optional", () => {
  assert.deepEqual(hidden, { kind: "keyword", keyword: "hidden" });

  assert.equal(playAbility.kind, "triggered");
  assert.equal(playAbility.trigger.at, "card-played");
  assert.deepEqual(playAbility.trigger.filter, { self: true });
  assert.equal(playAbility.optional, true);

  // 383.4.e / 466.2.c: “I attack” is an attack trigger filtered to the source.
  assert.equal(attackAbility.kind, "triggered");
  assert.equal(attackAbility.trigger.at, "attack-declared");
  assert.deepEqual(attackAbility.trigger.filter, {
    event: "attack-declared",
    filter: { source: "self" }
  });
  assert.equal(attackAbility.optional, true);
});

test("ven-135-166 Kennen: both triggers wrap pay-then-Stun in an optional body (contract 3.9)", () => {
  for (const [label, choice, ids] of [
    ["play", playChoice, ["kennen.play.pay", "kennen.play.stun"]],
    ["attack", attackChoice, ["kennen.attack.pay", "kennen.attack.stun"]]
  ]) {
    assert.equal(choice.op, "choice.optional", label);
    assert.equal(choice.args.body.kind, "constant", label);
    assert.deepEqual(
      choice.args.body.value.map(instruction => instruction.id),
      ids,
      label
    );
    const [pay, stun] = choice.args.body.value;
    // “you may pay :rb_energy_2:” — the 2 Energy payment (355.10.c.1 cost).
    assert.equal(pay.op, "cost.pay", label);
    assert.deepEqual(pay.args.energy, { kind: "constant", value: 2 }, label);
    assert.equal(pay.linkedTo, undefined, label);
    // “to [Stun] a unit” — one unit, stun through the merged primitive.
    assert.equal(stun.op, "effect.stun", label);
    assert.equal(stun.linkedTo, pay.id, label);
    assert.deepEqual(stun.args.target, { kind: "constant", value: stun.targets[0].id }, label);
    assert.equal(stun.targets.length, 1, label);
    assert.deepEqual(stun.targets[0].filter, { type: "unit", zone: "board" }, label);
    assert.equal(stun.targets[0].min, 1, label);
    assert.equal(stun.targets[0].max, 1, label);
    assert.equal(stun.targets[0].selection, "one", label);
  }
  // Independent statements: the play and attack bodies never link to each other.
  assert.deepEqual(playAbility.trigger.at, "card-played");
  assert.deepEqual(attackAbility.trigger.at, "attack-declared");
});

test("ven-135-166 Kennen: the statically-gated +2 Might aura shape", () => {
  assert.equal(mightAura.kind, "static");
  assert.equal(mightAura.effect.kind, "continuous.might");
  assert.equal(mightAura.effect.layer, "arithmetic");
  assert.deepEqual(mightAura.effect.amount, { kind: "constant", value: 2 });
  assert.equal(mightAura.effect.appliesTo, "self");
  assert.equal(mightAura.condition.kind, "compare");
  assert.equal(mightAura.condition.operator, "gte");
  assert.equal(mightAura.condition.left.kind, "count");
  // “a stunned enemy unit here”: opponent-controlled, same battlefield, Stunned.
  assert.deepEqual(mightAura.condition.left.filter, {
    type: "unit",
    zone: "board",
    controller: "opponent",
    stunned: true,
    sameLocationAs: "self"
  });
  assert.deepEqual(mightAura.condition.right, { kind: "constant", value: 1 });
});

test("ven-135-166 golden: declining the play trigger does nothing (no payment, no stun)", () => {
  const kernel = kennenKernel();
  kernel.setAnswers({ "kennen.play.opt-in/optional": false });
  const outcome = runAbilityBody(playAbility.body, kernel);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status, entry.result.reason]), [
    ["kennen.play.opt-in", "negated", "skipped"]
  ]);
  assert.equal(kernel.getObject("enemy").stunned, false);
  assert.deepEqual(kernel.events, []);
});

test("ven-135-166 golden: the merged Stun half stuns the unit (accept path blocked only at cost.pay)", () => {
  // The program's own stun instruction, with its TargetSpec locked by the
  // reference kernel exactly like Finalize would.
  const { targets, linkedTo, ...stunInstruction } = playChoice.args.body.value[1];
  const kernel = kennenKernel();
  kernel.setTargets("kennen.play.unit", [kernel.ref("enemy")]);

  const outcome = runAbilityBody([stunInstruction], kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.getObject("enemy").stunned, true);
  assert.deepEqual(outcome.events.map(event => event.action), ["stun"]);
  assert.equal(outcome.linkedValues["kennen.play.stun.stunned"].count, 1);

  // Accepting the whole optional body cannot execute today: cost.pay has no
  // merged primitive, and that must fail loudly instead of silently skipping.
  const accepted = kennenKernel();
  accepted.setAnswers({ "kennen.play.opt-in/optional": true });
  assert.throws(() => runAbilityBody(playAbility.body, accepted), /Unregistered instruction opcode: cost\.pay/);
});

test("ven-135-166 golden: an already stunned unit is not stunned twice (CR 424.1.a.1)", () => {
  const base = world()
    .player("controller")
    .unit("kennen", { controller: "controller" })
    .unit("enemy", { owner: "B", controller: "B", stunned: true })
    .build();
  const kernel = base.clone({ controller: "controller", sourceSnapshot: base.getObject("kennen") });
  kernel.setTargets("kennen.attack.unit", [kernel.ref("enemy")]);
  const { targets, linkedTo, ...stunInstruction } = attackChoice.args.body.value[1];
  const outcome = runAbilityBody([stunInstruction], kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.linkedValues.stunned.count, 0);
  assert.equal(outcome.results[0].result.linkedValues.stunned.alreadyStunned, 1);
  assert.deepEqual(outcome.events, []);
});

test.todo(
  "ven-135-166 Kennen: paying :rb_energy_2: through the optional trigger needs the cost.pay " +
    "primitive and the finalized cost plan (RIFT-89)"
);

test.todo(
  "ven-135-166 Kennen: [Hidden]'s cost.hidden / facedown play permission has no consumer even " +
    "though the KeywordDef is merged (811.1.d; RIFT-89 / RIFT-91)"
);

test.todo(
  "ven-135-166 Kennen: the +2 Might aura needs the card-side continuous.might registration " +
    "(RIFT-91) and a Stunned-state predicate over the current battlefield"
);
