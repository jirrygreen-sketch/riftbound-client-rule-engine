// Template evidence: ../templates/keyword-play-continuous-might-653.test.mjs.
// Whole-card scenarios remain blocked by Repeat; existing body goldens remain valid.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/feral-strength.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { describePlay } from "../../../../engine-core/dist/programs/play.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/index.js";

const CANONICAL_ID = "card.hash-21fa1dc89f8491be1ad8d778109c30c1266a2ee3c7b7b49e5da837edba0103ee";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "[Repeat] :rb_energy_2: (You may pay the additional cost to repeat this spell's effect.)\n" +
  "Give a unit +2 :rb_might: this turn.";

const reaction = program.abilities.find(ability => ability.keyword === "reaction");
const play = program.abilities.find(ability => ability.kind === "play");
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
  // 2026-10-18 re-sweep: name the two measured halves and drop the merged tasks.
  assert.match(program.judgeReason, /Unsupported play cost field optional/);
  assert.match(program.judgeReason, /optionalAdditional/);
  assert.match(program.judgeReason, /cost\.optional-additional-paid/);
  assert.match(program.judgeReason, /Repeat count must be a non-negative safe integer/);
  assert.doesNotMatch(program.judgeReason, /repeat\.cost 尚无图层映射/);
});

test("sfd-034-221 Feral Strength: [Reaction] keyword plus the printed [Repeat] additional cost", () => {
  assert.equal(program.abilities.length, 3);
  // 813: speed keyword (pure permission; the registry owns the expansion).
  assert.deepEqual(reaction, { kind: "keyword", keyword: "reaction" });
  assert.deepEqual(program.abilities[1], { kind: "keyword", keyword: "repeat" });
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

test("sfd-034-221 Feral Strength: play binding exposes the printed Repeat additional cost", () => {
  const kernel = world()
    .card("feral", {
      cardId: program.canonicalCardId,
      owner: "A",
      controller: "A",
      zone: "hand",
      types: ["spell"],
      energy: 2,
      power: null
    })
    .build();
  const source = kernel.getObject("feral");
  const registry = new ProgramRegistry([{ ...program, status: "executable", judgeReason: undefined }]);
  const draft = describePlay(registry, { type: "play", object: source.ref, player: "A" }, source);
  assert.equal(draft.cost.optionalAdditional.length, 1);
  assert.equal(draft.cost.optionalAdditional[0].kind, "repeat");
  assert.deepEqual(draft.cost.optionalAdditional[0].cost.payments, [
    { kind: "energy", amount: { kind: "constant", value: 2 } }
  ]);
});

test("sfd-034-221 Feral Strength: the production play draft carries the printed Repeat cost", () => {
  const kernel = world()
    .card("feral", { cardId: program.canonicalCardId, types: ["spell"], zone: "hand", energy: 2, power: null })
    .build();
  const source = kernel.getObject("feral");
  const expanded = expandProgram({ ...program, status: "executable", judgeReason: undefined }, source).expanded;
  const repeatStatic = expanded.find((ability) => ability.kind === "static" && ability.effect.kind === "repeat.cost");
  assert.ok(repeatStatic, "the merged Repeat keyword expands to a repeat.cost static");
  const registry = new ProgramRegistry([{ ...program, status: "executable", judgeReason: undefined }]);
  const draft = describePlay(registry, { type: "play", object: source.ref, player: "A" }, source);
  assert.deepEqual(draft.cost.optionalAdditional[0].cost.payments, [
    { kind: "energy", amount: { kind: "constant", value: 2 } }
  ]);
});

test("sfd-034-221 Feral Strength: the paid Repeat receipt is a boolean the repeat node cannot consume", () => {
  // Live evidence for the second half of gap (2). The receipt is readable as a
  // predicate, but the merged repeat node requires a non-negative integer
  // count, so no card-side expression derives 0/1 repetitions from it (820.1.d.1).
  const kernel = world().player("A", { energy: 6 }).deck(["d1", "d2"])
    .card("feral", { cardId: program.canonicalCardId, types: ["spell"], zone: "board", energy: 2, power: null })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("feral") });
  const cost = {
    plan: {
      components: [{ id: "feral-strength.repeat-payment", stage: "optional-additional" }],
      selectedAdditional: [{ id: "feral-strength.repeat-payment", kind: "repeat" }],
      declinedAdditional: []
    },
    receipt: { paid: true, additional: [{ id: "feral-strength.repeat-payment", kind: "repeat", paid: true }] }
  };

  const read = runAbilityBody(
    [{ id: "feral.read-repeat", op: "condition.predicate", args: { condition: { kind: "constant", value: { kind: "result", result: "cost.optional-additional-paid", id: "feral-strength.repeat-payment" } } } }],
    context,
    undefined,
    { cost }
  );
  assert.equal(read.results[0].result.status, "executed");
  assert.equal(read.results[0].result.linkedValues.value, true);

  // Feeding that bound boolean to the merged repeat node fails closed.
  const repeated = kernel.clone({ sourceSnapshot: kernel.getObject("feral") });
  assert.throws(
    () => runAbilityBody(
      [
        { id: "feral.read-repeat", op: "condition.predicate", args: { condition: { kind: "constant", value: { kind: "result", result: "cost.optional-additional-paid", id: "feral-strength.repeat-payment" } } } },
        {
          id: "feral.repeat",
          op: "repeat",
          linkedTo: "feral.read-repeat",
          args: {
            count: { kind: "linked-value", instructionId: "feral.read-repeat", key: "value" },
            body: { kind: "constant", value: [{ id: "feral.draw", op: "effect.draw", args: { amount: { kind: "constant", value: 1 } } }] }
          }
        }
      ],
      repeated,
      undefined,
      { cost }
    ),
    /Repeat count must be a non-negative safe integer/
  );
  assert.equal(repeated.player("A").handSize, 0, "no repetitions ran");
});

test("sfd-034-221 Feral Strength: the merged cost planner really accepts an optional Repeat component", () => {
  // The plan side of the gap is merged and really charges: the missing link is
  // the card-program → Finalize wiring that this card's declaration cannot reach.
  const kernel = world().player("A", { energy: 6, power: ["Calm"] })
    .card("feral", { cardId: program.canonicalCardId, types: ["spell"], zone: "board", energy: 2, power: null })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("feral") });
  context.setAnswers({ "feral-plan:optional:feral.repeat": true });

  const plan = buildCostPlan(context, {
    id: "feral-plan",
    cost: { kind: "printed" },
    optionalAdditional: [{
      id: "feral.repeat",
      kind: "repeat",
      cost: { energy: { kind: "constant", value: 2 } }
    }]
  });

  assert.deepEqual(plan.selectedAdditional, [{ id: "feral.repeat", kind: "repeat" }]);
  assert.deepEqual(plan.components.map((component) => [component.id, component.stage]), [
    ["base", "base"],
    ["feral.repeat", "optional-additional"]
  ]);
  assert.equal(plan.total.energy, 4);
});
