import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/spirit-wheel.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { runAbilityBody } = await import(new URL("effects/interpreter.js", ENGINE));
const { runInstruction, world } = await import(new URL("effects/testing/index.js", ENGINE));
const { validateTriggerSpec } = await import(new URL("events/trigger-spec.js", ENGINE));
const draw = (await import(new URL("effects/instructions/effect.draw.js", ENGINE))).default;

const CANONICAL = "card.hash-498c7e8ce2e20ef011de716db7cf2ff6e0f71a410cc40dace65553df8b0b2518";
const SOURCE_TEXT =
  "When you choose a friendly unit, you may pay :rb_energy_1: and exhaust this to draw 1.";
const OPTIONAL_ID = "spirit-wheel.may-pay-and-draw/optional";

const [ability] = program.abilities;
const [optional] = ability.body;
const [pay, drawInstruction] = optional.args.body.value;

test("sfd-144-221 Spirit Wheel: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
});

test("sfd-144-221 Spirit Wheel: identity, ruleset, status, judgeReason and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // README section 2: the reason names the missing subscription and the missing
  // cost-within-instructions payment, with the real task numbers.
  assert.match(program.judgeReason, /TriggerRegistration/);
  assert.match(program.judgeReason, /RIFT-120/);
  assert.match(program.judgeReason, /383\.3\.b/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-144-221 Spirit Wheel: a became-target trigger for units you control", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 383.4.b: "When you choose …" is a Targeting Effect, carried by became-target.
  assert.equal(ability.trigger.at, "became-target");
  assert.deepEqual(ability.trigger.filter, {
    event: "became-target",
    player: "self",
    target: { type: "unit", controller: "self" }
  });
  assert.equal(ability.trigger.once, undefined);
  // 383.3.a: the printed "you may" is the trigger's own perform decision.
  assert.equal(ability.optional, true);
  // The frozen TriggerSpec accepts this spelling.
  const validated = validateTriggerSpec(ability.trigger);
  assert.equal(validated.ok, true, JSON.stringify(validated.ok ? [] : validated.issues));
});

test("sfd-144-221 Spirit Wheel: contract 3.9 — one choice.optional wrapping pay and draw", () => {
  assert.deepEqual(ability.body.map((instruction) => instruction.id), ["spirit-wheel.may-pay-and-draw"]);
  assert.equal(optional.op, "choice.optional");
  assert.equal(optional.args.body.kind, "constant");
  assert.deepEqual(optional.args.body.value.map((instruction) => instruction.id), [
    "spirit-wheel.pay",
    "spirit-wheel.draw-1"
  ]);
  assert.equal(optional.linkedTo, undefined);

  // 383.3.b / 383.3.b.1: "pay 1 energy and exhaust this" is the ability's base
  // cost, paid at finalize.
  assert.equal(pay.op, "cost.pay");
  assert.deepEqual(pay.args.energy, { kind: "constant", value: 1 });
  assert.deepEqual(pay.args.payments, {
    kind: "constant",
    value: [{ kind: "exhaust", object: "self" }]
  });

  // The draw is linked to the paid cost, so a failed payment also skips the draw.
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(drawInstruction.linkedTo, "spirit-wheel.pay");
});

test("sfd-144-221 Spirit Wheel golden: declining the optional performs neither the cost nor the draw", () => {
  const kernel = world().player("A", { energy: 3 }).deck(["d1", "d2"]).build();
  kernel.setAnswers({ [OPTIONAL_ID]: false });

  const outcome = runAbilityBody(ability.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map((result) => [result.id, result.result.status]), [
    ["spirit-wheel.may-pay-and-draw", "negated"]
  ]);
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.equal(kernel.player("A").handSize, 0);
  assert.equal(kernel.player("A").energy, 3);
  assert.deepEqual(kernel.events, []);
});

test("sfd-144-221 Spirit Wheel golden: the printed draw really draws one card through the reference kernel", () => {
  // The supported half of the body: 414.1/414.3 draws one card from the top of
  // the controller's Main Deck. The cost half needs the unmerged cost-within-
  // instructions primitive (see judgeReason), so it is not faked here.
  const kernel = world().deck(["top", "second"]).build();
  const run = runInstruction(draw, { amount: drawInstruction.args.amount }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["top"]);
  assert.deepEqual(run.events.map((event) => event.action), ["draw"]);
});

test.todo(
  "sfd-144-221 Spirit Wheel: the became-target trigger needs the card-program -> " +
    "TriggerRegistration producer (contract 3.5, RIFT-120 follow-up) before it can fire."
);
test.todo(
  "sfd-144-221 Spirit Wheel: paying \"1 energy and exhaust this\" as the trigger's base cost " +
    "(CR 383.3.b/383.3.b.1) needs a cost field on TriggeredAbility or a merged cost.pay " +
    "primitive plus the finalize payment pipeline (RIFT-89 follow-up)."
);
