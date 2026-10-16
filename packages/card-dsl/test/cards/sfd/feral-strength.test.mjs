import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/feral-strength.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID = "card.hash-21fa1dc89f8491be1ad8d778109c30c1266a2ee3c7b7b49e5da837edba0103ee";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "[Repeat] :rb_energy_2: (You may pay the additional cost to repeat this spell's effect.)\n" +
  "Give a unit +2 :rb_might: this turn.";

const [reaction, play] = program.abilities;
const [might] = play.body;
const targetSpec = might.targets[0];

test("sfd-034-221 Feral Strength: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("sfd-034-221 Feral Strength: identity, ruleset, status and verbatim text", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("sfd-034-221 Feral Strength: judgeReason names the Might primitive and the Repeat wiring", () => {
  // Contract 3.1 / README §2: the reason must name the missing op/rule and the
  // dependency instead of a generic "not implemented yet".
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /820\.1/);
});

test("sfd-034-221 Feral Strength: [Reaction] keyword plus the printed [Repeat] additional cost", () => {
  assert.equal(program.abilities.length, 2);
  // 813: speed keyword (pure permission; the registry owns the expansion).
  assert.deepEqual(reaction, { kind: "keyword", keyword: "reaction" });
  assert.equal(reaction.value, undefined);

  assert.equal(play.kind, "play");
  // 820.1.a/820.1.c.1: Repeat is an Optional Additional Cost on Spells; the
  // printed 2 Energy is declared as an optional payment with an explicit
  // pay/decline decision (355.1.a, 356.2.b.1).
  assert.equal(play.cost.kind, "additional");
  assert.equal(play.cost.keyword, "repeat");
  assert.equal(play.cost.optional, true);
  assert.equal(play.cost.payments.length, 1);
  const [payment] = play.cost.payments;
  assert.equal(payment.kind, "energy");
  assert.deepEqual(payment.amount, { kind: "constant", value: 2 });
  assert.equal(payment.choice.id, "feral-strength.repeat-payment");
  assert.deepEqual(payment.choice.options, ["pay", "decline"]);
  assert.equal(payment.choice.selection, "one");
});

test("sfd-034-221 Feral Strength: one targeted +2 Might this turn instruction", () => {
  assert.equal(play.body.length, 1);
  assert.equal(might.id, "feral-strength.give-plus-2-might");
  assert.equal(might.op, "continuous.might");
  assert.equal(might.linkedTo, undefined);
  assert.equal(might.condition, undefined);
  // 143.2.a Effective Might + 317.2.c end-of-turn expiry; no printed minimum.
  assert.deepEqual(might.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(might.args.duration, { kind: "constant", value: "this-turn" });
  assert.equal(might.args.minimum, undefined);

  // "a unit" is a specific choice made while finalizing the spell (355.5/355.7).
  assert.deepEqual(targetSpec, {
    id: "feral-strength.unit",
    filter: { type: "unit", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("sfd-034-221 Feral Strength golden: a mistargeted unit ignores the instruction and its events (359.3.e.7)", () => {
  const kernel = world().unit("chosen-unit").build();
  const stale = kernel.ref("chosen-unit");
  assert.equal(kernel.perform({ type: "return-to-hand", object: stale }).status, "done");
  kernel.setTargets("feral-strength.unit", [stale]);
  const eventCount = kernel.events.length;

  const outcome = runAbilityBody(play.body, kernel);

  // The target left the board before resolution: the instruction is ignored
  // (contract 3.4) and submits nothing; the unmerged continuous.might op is
  // never dispatched on this path.
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.events.length, eventCount);
});

test.todo(
  "sfd-034-221 Feral Strength: applying '+2 :rb_might: this turn' needs the card-facing continuous.might " +
    "instruction op registering an arithmetic-layer effect through ResolveContext.addContinuous with an " +
    "end-of-turn duration (CR 143.2.a / 317.2.c; RIFT-91 layers follow-up) — not approximated with Buff counters."
);

test.todo(
  "sfd-034-221 Feral Strength: [Repeat] :rb_energy_2: must be collected at Finalize and the paid instance count " +
    "fed to the interpreter's repeat node so the effect resolves an additional time with re-made choices " +
    "(CR 820.1.c.1 / 820.1.d.1 / 820.2; RIFT-89 cost plan plus the wiring named in effects/keywords/Repeat.ts)."
);
