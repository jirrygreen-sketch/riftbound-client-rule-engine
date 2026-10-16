import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/katarina-reckless.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-af09eca4367e2e4b14d75cf96d7b4ae549ed3f338f0f188c50f3e6c83001ffaa";
const SOURCE_TEXT =
  "When you hide a card, ready me.\n" +
  "When you play a card from face down, deal 2 to an enemy unit.";

const [hideTrigger, faceDownTrigger] = program.abilities;
const [readyInstruction] = hideTrigger.body;
const [dealTwo] = faceDownTrigger.body;
const targetSpec = dealTwo.targets[0];

// Finalize locks the damage target; the reference kernel compares filter values
// literally, so the "opponent" selector never matches there. The golden hands
// the finalized target to the kernel and drops only the TargetSpec, keeping the
// card's own instruction and arguments (same as the merged impermanent goldens).
const stripTargets = ({ targets, ...instruction }) => instruction;
const DAMAGE_BODY = faceDownTrigger.body.map(stripTargets);

/**
 * The reference kernel's default source object is a synthetic "source"; point
 * the world's source at Katarina so "ready me" (effect.ready's default source
 * selector) resolves against the unit itself.
 */
function fixture() {
  const base = world()
    .unit("katarina", { might: 5, exhausted: true })
    .unit("enemy-unit", { owner: "B", might: 3 })
    .build();
  return base.clone({ sourceSnapshot: base.getObject("katarina") });
}

test("unl-023-219 Katarina, Reckless: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-023-219 Katarina, Reckless: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /card-hidden/);
  assert.match(program.judgeReason, /422\.1/);
  assert.match(program.judgeReason, /811\.1\.d/);
  assert.match(program.judgeReason, /RIFT-120/);
});

test("unl-023-219 Katarina, Reckless: the hide trigger waits on the card-hidden timing point", () => {
  assert.equal(program.abilities.length, 2);
  // 422.1 / 422.2: Hiding is the act of placing a card facedown at a battlefield
  // you control; the closed card-hidden timing point observes it.
  assert.equal(hideTrigger.kind, "triggered");
  assert.equal(hideTrigger.trigger.at, "card-hidden");
  assert.deepEqual(hideTrigger.trigger.filter, { event: "card-hidden", player: "self" });
  assert.equal(hideTrigger.optional, false);
  assert.equal(hideTrigger.body.length, 1);
  // 416.1 / 355.10.g: "ready me" is the source object, never a target.
  assert.equal(readyInstruction.id, "katarina-reckless.ready-self");
  assert.equal(readyInstruction.op, "effect.ready");
  assert.deepEqual(readyInstruction.args, {
    objects: { kind: "constant", value: { kind: "source" } }
  });
  assert.equal(readyInstruction.targets, undefined);
});

test("unl-023-219 Katarina, Reckless: the second trigger is one enemy-unit damage target", () => {
  // 359 / 383.4.a: the event is a card being played; the face-down provenance
  // is part of the missing payload (see judgeReason) and is not faked.
  assert.equal(faceDownTrigger.kind, "triggered");
  assert.equal(faceDownTrigger.trigger.at, "card-played");
  assert.deepEqual(faceDownTrigger.trigger.filter, {
    event: "card-played",
    filter: { fromFaceDown: true },
    player: "self"
  });
  assert.equal(faceDownTrigger.optional, false);
  assert.equal(dealTwo.id, "katarina-reckless.deal-two");
  assert.equal(dealTwo.op, "effect.damage");
  assert.deepEqual(dealTwo.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(dealTwo.args.target, {
    kind: "constant",
    value: "katarina-reckless.enemy-unit"
  });
  assert.deepEqual(targetSpec, {
    id: "katarina-reckless.enemy-unit",
    filter: { type: "unit", controller: "opponent", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(dealTwo.picks, undefined);
  assert.equal(dealTwo.linkedTo, undefined);
});

test("unl-023-219 Katarina, Reckless golden: 'ready me' readies the exhausted source", () => {
  const kernel = fixture();
  const outcome = resolveChainBody(hideTrigger.body, kernel);
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["katarina-reckless.ready-self", "executed"]
  ]);
  assert.equal(kernel.getObject("katarina").exhausted, false);
  assert.deepEqual(kernel.events.map(event => event.action), ["ready"]);
});

test("unl-023-219 Katarina, Reckless golden: an already-ready source is not readied again (CR 416.1.c)", () => {
  const base = world().unit("katarina", { might: 5, exhausted: false }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("katarina") });
  const outcome = resolveChainBody(hideTrigger.body, kernel);
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.getObject("katarina").exhausted, false);
  assert.deepEqual(kernel.events, []);
  const run = runInstruction(ready, readyInstruction.args, { world: kernel });
  assert.equal(run.linked.readied.count, 0);
});

test("unl-023-219 Katarina, Reckless golden: the locked enemy unit takes the printed 2 damage", () => {
  const kernel = fixture();
  kernel.setTargets(targetSpec.id, [kernel.ref("enemy-unit")]);
  const outcome = resolveChainBody(DAMAGE_BODY, kernel);

  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["katarina-reckless.deal-two", "executed"]
  ]);
  assert.equal(kernel.getObject("enemy-unit").damage, 2);
  assert.equal(kernel.getObject("katarina").damage, 0);
  assert.deepEqual(kernel.events.map(event => event.action), ["damage"]);
});

test("unl-023-219 Katarina, Reckless golden: a locked enemy unit that left the Board makes the damage ignored", () => {
  const kernel = fixture();
  const stale = kernel.ref("enemy-unit");
  kernel.perform({ type: "kill", object: stale });
  kernel.setTargets(targetSpec.id, [stale]);
  const outcome = resolveChainBody(DAMAGE_BODY, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, {
    status: "ignored",
    reason: "mistargeted"
  });
});

test("unl-023-219 Katarina, Reckless golden: the merged effect.damage alone applies the card's amount", () => {
  const kernel = fixture();
  const run = runInstruction(
    damage,
    { amount: dealTwo.args.amount, target: targetSpec.id },
    { world: kernel, targets: { [targetSpec.id]: [kernel.ref("enemy-unit")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.dealt, 2);
  assert.deepEqual(run.linked.dealtCount, 1);
  assert.equal(kernel.getObject("enemy-unit").damage, 2);
});

test.todo(
  "unl-023-219 Katarina, Reckless: the card-hidden timing point (CR 422.1) is emitted for a completed Hide —" +
    " the closed GameAction set has no Hide action and the facedown zone belongs to the cost.hidden workstream (RIFT-89)"
);
test.todo(
  "unl-023-219 Katarina, Reckless: 'When you play a card from face down' provenance (CR 811.1.d facedown zone)" +
    " once the card-played payload records the played-from-face-down fact"
);
test.todo(
  "unl-023-219 Katarina, Reckless: both triggers are registered through the CardProgram -> TriggerRegistration" +
    " adapter (RIFT-120)"
);
