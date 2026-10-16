import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/lady-of-clockwork.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-3cd6936ca27659594b605ddc164b8a803fc72df73ac4a16f33b673ecabc1791a";
const SOURCE_TEXT =
  "At the start of your Main Phase, you may pay :rb_energy_1: to choose a friendly gear. " +
  "It becomes a unit gear with Might equal to its Energy cost until you choose another gear with me.";

const [ability] = program.abilities;
const [optIn] = ability.body;
const [pay, becomeUnitGear] = optIn.args.body.value;

test("rad-145-167 Lady of Clockwork: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
});

test("rad-145-167 Lady of Clockwork: identity, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // cards README §2: judgeReason names cost.pay, the trait/Might layer gap and
  // the "until you choose another gear" duration model, with task numbers.
  assert.match(program.judgeReason, /cost\.pay/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /Duration/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /206/);
});

test("rad-145-167 Lady of Clockwork: Main Phase start trigger for the controller", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 316.1 / 316.4: "At the start of your Main Phase" is the main-start timing
  // point; 190.6.d resolves the implied "you" to the ability controller.
  assert.equal(ability.trigger.at, "main-start");
  assert.deepEqual(ability.trigger.filter, { event: "main-start", player: "self" });
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
  // The trigger itself stays non-optional: 383.3.a makes the "you may" a
  // finalization decision, which the frozen control shape expresses as
  // choice.optional around the chosen instructions (contract 3.9).
  assert.equal(ability.optional, false);
});

test("rad-145-167 Lady of Clockwork: “you may pay … to choose a friendly gear” uses choice.optional with the chosen instructions in its body", () => {
  // Contract 3.9 (frozen): "may" is choice.optional wrapping the chosen
  // instructions in body; a bare choice followed by linkedTo is invalid.
  assert.equal(ability.body.length, 1);
  assert.equal(optIn.id, "lady-of-clockwork.opt-in");
  assert.equal(optIn.op, "choice.optional");
  assert.deepEqual(optIn.args.prompt, {
    kind: "constant",
    value: "Pay 1 energy to choose a friendly gear?"
  });
  assert.equal(optIn.args.body.kind, "constant");
  assert.deepEqual(
    optIn.args.body.value.map(instruction => instruction.id),
    ["lady-of-clockwork.pay", "lady-of-clockwork.become-unit-gear"]
  );

  // 204.3 / 383.3.b: the 1 energy is the ability's base cost (paid at
  // Finalize), preserved as cost.pay rather than a resolution effect.
  assert.equal(pay.op, "cost.pay");
  assert.deepEqual(pay.args, { energy: { kind: "constant", value: 1 } });
  assert.equal(pay.linkedTo, undefined);
  assert.equal(pay.targets, undefined);
});

test("rad-145-167 Lady of Clockwork: unit-gear transformation reads the target's printed Energy cost", () => {
  assert.equal(becomeUnitGear.id, "lady-of-clockwork.become-unit-gear");
  // The trait change (Gear -> unit Gear) plus the Might set belong to the
  // layers; continuous.might has no merged consumer, so the instruction stays
  // a declaration of the intended layer effect.
  assert.equal(becomeUnitGear.op, "continuous.might");
  assert.deepEqual(becomeUnitGear.args.addTypes, { kind: "constant", value: ["unit"] });
  assert.deepEqual(becomeUnitGear.args.mode, { kind: "constant", value: "set" });
  assert.deepEqual(becomeUnitGear.args.duration, {
    kind: "constant",
    value: "until-you-choose-another-gear-with-me"
  });
  // 206: the Might value is the gear's PRINTED Energy cost, read through an
  // object-property expression on the chosen target (evaluated at resolution
  // time); energy:null still means "no printed value", never 0.
  assert.deepEqual(becomeUnitGear.args.amount, {
    kind: "object-property",
    object: { target: "lady-of-clockwork.gear" },
    property: "energy"
  });
  assert.equal(becomeUnitGear.linkedTo, "lady-of-clockwork.pay");

  // 355.7 / 355.10: "choose a friendly gear" picks a specific object, so it is
  // a target of the controller's own Gear.
  assert.equal(becomeUnitGear.targets.length, 1);
  assert.deepEqual(becomeUnitGear.targets[0], {
    id: "lady-of-clockwork.gear",
    filter: { zone: "board", type: "gear", controller: "controller" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(becomeUnitGear.picks, undefined);
});

test("rad-145-167 Lady of Clockwork: declining the optional ability performs nothing", () => {
  // 383.3.a + contract 3.9: refusal negates (skips) the choice, so no payment
  // and no transformation happen; later independent instructions would still
  // run. The reference kernel executes the real choice.optional node.
  const kernel = world()
    .player("A", { energy: 2 })
    .unit("gear-1", { zone: "board", types: ["gear"], controller: "A", energy: 3 })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("gear-1") });
  scoped.setAnswers({ "lady-of-clockwork.opt-in/optional": false });

  const outcome = runAbilityBody(ability.body, scoped);
  assert.deepEqual(outcome.results.map(result => result.id), ["lady-of-clockwork.opt-in"]);
  assert.deepEqual(outcome.results[0].result, {
    status: "negated",
    reason: "skipped",
    events: []
  });
  assert.equal(outcome.status, "partial");
  assert.equal(scoped.player("A").energy, 2);
  assert.equal(scoped.getObject("gear-1").types.includes("unit"), false);
  assert.equal(scoped.getObject("gear-1").might, 1);
  assert.equal(scoped.events.length, 0);
});

test("rad-145-167 Lady of Clockwork: accepting the ability stops at the unmerged cost.pay opcode", () => {
  // Accepting reaches the cost step, which has no merged primitive: the whole
  // body aborts instead of approximating a payment or transforming the gear.
  // The reference kernel must be left untouched by the failed run.
  const kernel = world()
    .player("A", { energy: 2 })
    .unit("gear-1", { zone: "board", types: ["gear"], controller: "A", energy: 3 })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("gear-1") });
  scoped.setAnswers({ "lady-of-clockwork.opt-in/optional": true });

  assert.throws(
    () => runAbilityBody(ability.body, scoped),
    /Unregistered instruction opcode: cost\.pay/
  );
  assert.equal(scoped.player("A").energy, 2);
  assert.deepEqual(scoped.getObject("gear-1").types, ["gear"]);
  assert.equal(scoped.getObject("gear-1").exhausted, false);
});

test("rad-145-167 Lady of Clockwork: choosing a gear is a target, so the printed text is not a look-up", () => {
  // Boundary: "choose a friendly gear" names one object and is targeted
  // (355.7 / 355.10), unlike the "ageless" each-set wording; the filter also
  // pins the controller so an opponent's gear is not a legal choice (355.9.b).
  const spec = becomeUnitGear.targets[0];
  assert.equal(spec.filter.controller, "controller");
  assert.equal(spec.filter.owner, undefined);
  assert.equal(spec.filter.other, undefined);
  assert.equal(spec.min, 1);
  assert.equal(spec.max, 1);
});

test.todo(
  "rad-145-167: pay the 1 Energy at Finalize — needs the triggered-ability base cost wiring " +
    "(CR 204.3 / 383.3.b / 404.1.b.1) and a cost.pay implementation in the cost plan (RIFT-89)"
);

test.todo(
  "rad-145-167: turn the chosen Gear into a unit Gear whose Might is its printed Energy cost — " +
    "needs the trait layer to add the unit type, a continuous.might set mode that reads another " +
    "object's printed cost (CR 206), and a 5+ Might / Mighty recheck through the layers (RIFT-91)"
);

test.todo(
  "rad-145-167: expire the transformation when this legend chooses another gear — the merged " +
    "Duration union has no repeat-choice trigger, so the source-bound, choice-driven duration " +
    "model is still missing (CR 135.4.b / 801.3.a)"
);
