import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/frigid-touch.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
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

test("Frigid Touch is judge-required because temporary Might modification is unmerged", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-153eb4df721b70662a63652ba1602985ceed08d81a0b23fc0d6b10349ee15ca9"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // The judgeReason must name the actual gap (contract 3.1): continuous.might
  // layers support and the Repeat cost hook, not a generic complaint.
  assert.match(program.judgeReason, /continuous.might/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /RIFT-86/);
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
  // The op is the unmerged continuous.might layers effect, not a Buff.
  assert.equal(mightInstruction.id, "give-minus-2-might");
  assert.equal(mightInstruction.op, "continuous.might");
  assert.deepEqual(mightInstruction.args.amount, { kind: "constant", value: -2 });
  assert.deepEqual(mightInstruction.args.duration, { kind: "constant", value: "this-turn" });
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
  // This exercises the merged interpreter's linked-ignored propagation without
  // touching the unmerged continuous.might op (the first instruction is
  // ignored before its op is ever dispatched).
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
  "Frigid Touch: executing 'Give a unit -2 [M] this turn' needs the layers continuous " +
    "effect consumer (continuous.might with end-of-turn expiry, RIFT-91)."
);

test.todo(
  "Frigid Touch: collecting the optional [2] Repeat cost at Finalize, exposing the paid " +
    "count to the repeat instruction, and re-selecting the target for the repeated " +
    "execution (820.1.c.1 / 820.2) need the Repeat keyword expansion (RIFT-86) and the " +
    "cost plan (RIFT-89)."
);
