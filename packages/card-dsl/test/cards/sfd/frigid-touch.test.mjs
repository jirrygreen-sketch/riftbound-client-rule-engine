import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/frigid-touch.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const play = program.abilities.find(ability => ability.kind === "play");
const mightInstruction = play.body[0];
const repeatInstruction = play.body[1];
const targetSpec = mightInstruction.targets[0];

test("Frigid Touch program is valid EffectIR v2 data", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Frigid Touch is judge-required because Repeat cost/count wiring and a Might repeat action are missing", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-153eb4df721b70662a63652ba1602985ceed08d81a0b23fc0d6b10349ee15ca9"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // The judgeReason must name the current gaps (contract 3.1): the Repeat
  // cost/count wiring and the closed GameAction set's lack of a Might
  // modification — not the stale "continuous.might is unmerged" claim.
  assert.match(program.judgeReason, /continuous.might/);
  assert.match(program.judgeReason, /repeat/);
  assert.match(program.judgeReason, /Play\/Finalize/);
  assert.doesNotMatch(program.judgeReason, /RIFT-86|RIFT-91|RIFT-261/);
  assert.match(program.sourceText, /Give a unit -2 :rb_might: this turn./);
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("Frigid Touch structure: Reaction keyword plus the Repeat additional cost", () => {
  // [Reaction] (CR 813) is a keyword ability; [Repeat] (CR 820) is an
  // optional additional cost declared on the play ability (820.1.c.1).
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "reaction" });

  assert.equal(play.cost.kind, "additional");
  assert.equal(play.cost.payments.length, 1);
  const payment = play.cost.payments[0];
  assert.equal(payment.kind, "energy");
  assert.deepEqual(payment.amount, { kind: "constant", value: 2 });
  // Paying is optional (820.1.b): the cost carries an explicit pay/decline choice.
  assert.equal(payment.choice.id, "repeat-payment");
  assert.deepEqual(payment.choice.options, ["pay", "decline"]);
  assert.equal(payment.choice.selection, "one");
});

test("Frigid Touch structure: -2 Might instruction, then the linked Repeat instruction", () => {
  assert.equal(play.body.length, 2);

  // "Give a unit -2 [M] this turn": one targeted unit, temporary duration.
  assert.equal(mightInstruction.id, "give-minus-2-might");
  assert.equal(mightInstruction.op, "continuous.might");
  assert.deepEqual(mightInstruction.args.amount, { kind: "constant", value: -2 });
  assert.deepEqual(mightInstruction.args.duration, { kind: "constant", value: "this-turn" });
  // Contract 3.6: the affected unit comes from the Finalize-locked TargetSpec
  // through the objects descriptor; the default selection would be the source.
  assert.deepEqual(mightInstruction.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "affected-unit" }
  });
  assert.equal(mightInstruction.targets.length, 1);
  assert.equal(targetSpec.id, "affected-unit");
  assert.equal(targetSpec.selection, "one");
  assert.deepEqual(targetSpec.filter, { types: "unit" });

  // The Repeat instruction is linked to the effect instruction: it re-reads
  // the same TargetSpec so the repeated execution may choose a different unit
  // (820.2 / 820.2.a), and one paid cost yields exactly one extra execution
  // (820.1.d.1, 820.1.c.3).
  assert.equal(repeatInstruction.id, "repeat-effect");
  assert.equal(repeatInstruction.op, "effect.repeat");
  assert.equal(repeatInstruction.linkedTo, "give-minus-2-might");
  assert.deepEqual(repeatInstruction.args.count, { kind: "constant", value: 1 });
  const [action] = repeatInstruction.args.actions.value;
  assert.equal(action.type, "buff");
  assert.deepEqual(action.values.amount, { kind: "constant", value: -2 });
  assert.deepEqual(action.targets, { object: "affected-unit" });
});

test("Frigid Touch golden execution: an ignored Might instruction also ignores the Repeat", () => {
  // Contract 3.4 / CR 359.3.e.14.a-b: when the first instruction's target is
  // mistargeted and ignored, the linked repeat instruction is ignored too.
  // This exercises the merged interpreter's linked-ignored propagation; the
  // first instruction is ignored before its op is ever dispatched.
  const kernel = world().unit("staying-unit").unit("leaving-unit").build();
  const stale = kernel.ref("leaving-unit");
  kernel.perform({ type: "move-zone", object: stale, to: "hand" });
  const eventCount = kernel.events.length;
  kernel.setTargets(targetSpec.id, [stale]);

  const outcome = runAbilityBody(play.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(outcome.results[1].result, { status: "ignored", reason: "linked-ignored" });
  assert.equal(kernel.events.length, eventCount);
});

test.todo(
  "Frigid Touch: collecting the optional [2] Repeat cost at Finalize and exposing the paid " +
    "count to the repeat instruction (820.1.c.1) needs Play/Finalize to consume the expanded " +
    "repeat.cost static effect; the card must not write a fixed count."
);

test.todo(
  "Frigid Touch: repeating '-2 Might' cannot use effect.repeat's closed GameAction set — " +
    "it has no Might-modification action, and effect.buff would place Buff counters (702/703); " +
    "the repeated Might execution needs a Might action in the closed set (contract change)."
);

test("Frigid Touch golden: the card's own -2 Might instruction registers an end-of-turn arithmetic effect", () => {
  const kernel = world()
    .unit("target-unit", { owner: "B", controller: "B", might: 6 })
    .build();
  kernel.setTargets("affected-unit", [kernel.ref("target-unit")]);

  const outcome = resolveChainBody([mightInstruction], kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["give-minus-2-might", "executed"]
  ]);
  assert.equal(kernel.continuousEffects.length, 1);
  const [registration] = kernel.continuousEffects;
  // 478 / 478.1.a: Might modifications live in the arithmetic layer, and
  // 317.1.a / 468.7.c: "this turn" expires at the turn-end timing point.
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, -2);
  assert.deepEqual(registration.duration, { type: "end-of-turn" });

  const layers = createLayerEngine(
    kernel.objects,
    kernel.continuousEffects.map((entry, index) => ({ ...entry, timestamp: index + 1 }))
  );
  assert.equal(layers.evaluate(kernel.ref("target-unit")).might, 4);
  assert.equal(layers.expireAt("turn-end").length, 1);
  assert.equal(layers.evaluate(kernel.ref("target-unit")).might, 6);
});

test("Frigid Touch golden: a target that left the Board makes the Might instruction ignored", () => {
  const kernel = world().unit("target-unit", { owner: "B", controller: "B", might: 5 }).build();
  const stale = kernel.ref("target-unit");
  kernel.perform({ type: "kill", object: stale });
  kernel.setTargets("affected-unit", [stale]);

  const outcome = resolveChainBody([mightInstruction], kernel);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.continuousEffects.length, 0);
  assert.equal(kernel.getObject("target-unit").might, 5);
});
