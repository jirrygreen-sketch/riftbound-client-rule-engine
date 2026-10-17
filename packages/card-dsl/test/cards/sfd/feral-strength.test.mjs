import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/feral-strength.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
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
  assert.match(program.judgeReason, /translateCost/);
  assert.match(program.judgeReason, /820\.2/);
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
  assert.deepEqual(might.args.objects, { kind: "constant", value: { kind: "target", id: "feral-strength.unit" } });
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

  const outcome = resolveChainBody(play.body, kernel);

  // The target left the board before resolution: the instruction is ignored
  // (contract 3.4) and registers no effect on this path.
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.events.length, eventCount);
  assert.deepEqual(kernel.continuousEffects, []);
});

test.todo(
  "sfd-034-221 Feral Strength: translate the optional Repeat CostSpec into optionalAdditional at Finalize, " +
    "then repeat the effect with new choices using the paid receipt (820.1.c.1/820.1.d.1/820.2)"
);

test("sfd-034-221 Feral Strength golden: the chosen unit gains +2 Might and the effect expires this turn", () => {
  const base = world()
    .unit("source", { might: 6 })
    .unit("chosen", { might: 3, controller: "B" })
    .unit("unchosen", { might: 4 })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("source") });
  kernel.setTargets("feral-strength.unit", [kernel.ref("chosen")]);

  const outcome = resolveChainBody(play.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["feral-strength.give-plus-2-might", "executed"]
  ]);
  assert.equal(kernel.continuousEffects.length, 1);
  const [registration] = kernel.continuousEffects;
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, 2);
  assert.equal(registration.effect.filter.objectId, "chosen");
  assert.deepEqual(registration.duration, { type: "end-of-turn" });
  const layers = createLayerEngine(kernel.objects, [{ ...registration, timestamp: 1 }]);
  assert.equal(layers.evaluate(kernel.ref("chosen")).might, 5);
  assert.equal(layers.evaluate(kernel.ref("source")).might, 6);
  assert.equal(layers.evaluate(kernel.ref("unchosen")).might, 4);
  assert.equal(kernel.getObject("chosen").buffs, 0);
  assert.deepEqual(outcome.events, []);
  assert.equal(layers.expireAt("turn-end").length, 1);
  assert.equal(layers.evaluate(kernel.ref("chosen")).might, 3);
});
