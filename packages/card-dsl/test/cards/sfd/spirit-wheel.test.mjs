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
const { resolveChainBody } = await import(new URL("chain/interpreter-adapter.js", ENGINE));
const { runInstruction, world } = await import(new URL("effects/testing/index.js", ENGINE));
const { validateTriggerSpec } = await import(new URL("events/trigger-spec.js", ENGINE));
const { createProgramBinding } = await import(new URL("programs/index.js", ENGINE));
const draw = (await import(new URL("effects/instructions/effect.draw.js", ENGINE))).default;

const CANONICAL = "card.hash-498c7e8ce2e20ef011de716db7cf2ff6e0f71a410cc40dace65553df8b0b2518";
const SOURCE_TEXT =
  "When you choose a friendly unit, you may pay :rb_energy_1: and exhaust this to draw 1.";
const OPTIONAL_ID = "spirit-wheel.may-pay-and-draw/optional";

const [ability] = program.abilities;
const [optional] = ability.body;
const [preparePayment, pay, drawInstruction] = optional.args.body.value;

test("sfd-144-221 Spirit Wheel: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
});

test("sfd-144-221 Spirit Wheel: identity, ruleset, status, judgeReason and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // README section 2: the reason names the real gaps. The subscription and the
  // settled-cost pair have merged, so the live gap is the Finalize binding
  // (TriggeredAbility cost field + triggers.ts extraction) plus the chain
  // adapter's missing cost.modify literalization.
  assert.match(program.judgeReason, /TriggerRegistration/);
  assert.match(program.judgeReason, /383\.3\.b/);
  assert.match(program.judgeReason, /404\.1\.b\.1/);
  assert.match(program.judgeReason, /TriggeredAbility/);
  assert.match(program.judgeReason, /mayAtFinalize/);
  // 2026-10-18 re-sweep: the reason must keep the measured split between the
  // settled-cost pair (merged, now authored in the card) and the two live
  // binding gaps.
  assert.match(program.judgeReason, /cost\.modify/);
  assert.match(program.judgeReason, /cost\.pay/);
  assert.match(program.judgeReason, /cost\.modify id must be a non-empty string/);
  assert.match(program.judgeReason, /interpreter-adapter\.ts/);
  assert.match(program.judgeReason, /415\.4/);
  assert.ok(!/RIFT-257/.test(program.judgeReason), "the merged binding task must not stay listed");
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

test("sfd-144-221 Spirit Wheel: contract 3.9 — one choice.optional wrapping the paid base cost and draw", () => {
  assert.deepEqual(ability.body.map((instruction) => instruction.id), ["spirit-wheel.may-pay-and-draw"]);
  assert.equal(optional.op, "choice.optional");
  assert.equal(optional.args.body.kind, "constant");
  assert.deepEqual(optional.args.body.value.map((instruction) => instruction.id), [
    "spirit-wheel.prepare-payment",
    "spirit-wheel.pay",
    "spirit-wheel.draw-1"
  ]);
  assert.equal(optional.linkedTo, undefined);

  // 383.3.b / 383.3.b.1: "pay 1 energy and exhaust this" is the ability's base
  // cost. It uses the merged payable shape (cost.modify locks the plan,
  // cost.pay charges it) exactly as sfd/altar-of-memories. The remaining gap is
  // lifting this leading cost into Finalize (judgeReason).
  assert.equal(preparePayment.op, "cost.modify");
  assert.deepEqual(preparePayment.args, {
    id: { kind: "constant", value: "spirit-wheel.prepare-payment" },
    cost: {
      kind: "constant",
      value: {
        kind: "activated",
        energy: { kind: "constant", value: 1 },
        payments: [{ kind: "exhaust", object: "self" }]
      }
    }
  });
  assert.equal(pay.op, "cost.pay");
  assert.equal(pay.linkedTo, "spirit-wheel.prepare-payment");
  assert.deepEqual(pay.args, {
    cost: {
      kind: "linked-value",
      instructionId: "spirit-wheel.prepare-payment",
      key: "cost"
    }
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
  // the controller's Main Deck. The cost half needs the TriggeredAbility cost
  // field and the runtime payment reference (see judgeReason), so it is not
  // faked here.
  const kernel = world().deck(["top", "second"]).build();
  const run = runInstruction(draw, { amount: drawInstruction.args.amount }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["top"]);
  assert.deepEqual(run.events.map((event) => event.action), ["draw"]);
});

test("sfd-144-221 Spirit Wheel: the merged CardProgram binding registers through the real ChainEngine pipeline", async () => {
  // registerProgramTriggers turns the declared triggered ability into a
  // TriggerRegistration on the shared pipeline, keeping the printed
  // became-target timing point and resolving the target filter's controller
  // placeholder to the ability controller.
  const lifted = { ...program, status: "executable" };
  delete lifted.judgeReason;
  const { fixture } = await import("../../../../engine-core/test/chain/helpers.mjs");
  const binding = createProgramBinding({ cardPrograms: [lifted] });
  const f = fixture({
    cards: [{ id: "spirit-wheel", cardId: CANONICAL, types: ["gear"], energy: 2, power: [] }]
  });
  const source = f.kernel.getObject("spirit-wheel");
  const ids = binding.registerProgramTriggers(f.engine, source);
  const registrations = [...f.engine.pipeline.checkpoint().triggers.values()];

  assert.equal(ids.length, 1);
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].spec.at, "became-target");
  assert.deepEqual(registrations[0].spec.filter, {
    event: "became-target",
    target: { type: "unit", controller: "self" },
    player: "self"
  });
  assert.equal(registrations[0].optional, true);
  // The live gap: the binding leaves the leading base cost and the Finalize
  // "you may" decision (383.3.a/b) unbound even though the registration type
  // carries both fields.
  assert.equal(registrations[0].cost, undefined);
  assert.equal(registrations[0].mayAtFinalize, undefined);
});

test("sfd-144-221 Spirit Wheel golden: the card's own cost.modify + cost.pay pair really pays 1 Energy and exhausts the host", () => {
  // 383.3.b / 383.3.b.1 / 415.4 / 415.5: the two leading instructions are the
  // merged payable spelling of "you may pay 1 energy and exhaust this". The
  // interpreter runs the card's own IR and really charges the plan; the live
  // gap is only the Finalize lift of that cost (judgeReason).
  const base = world()
    .player("A", { energy: 3 })
    .deck(["d1", "d2"])
    .unit("wheel", { types: ["gear"], might: 0, location: { type: "base", player: "A" } })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("wheel") });

  const outcome = runAbilityBody([preparePayment, pay], kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["spirit-wheel.prepare-payment", "executed"],
    ["spirit-wheel.pay", "executed"]
  ]);
  const planned = outcome.results[0].result.linkedValues.cost;
  assert.equal(planned.finalized, true);
  assert.deepEqual(planned.total.energy, 1);
  assert.deepEqual(planned.total.actions.map((entry) => entry.action.type), ["exhaust"]);
  const receipt = outcome.results[1].result.linkedValues.payment;
  assert.equal(receipt.paid, true);
  assert.deepEqual(receipt.actions.map((entry) => entry.action.type), ["pay", "exhaust"]);
  assert.equal(kernel.player("A").energy, 2);
  assert.equal(kernel.getObject("wheel").exhausted, true);
  // The cost is not a draw: nothing left the deck.
  assert.equal(kernel.player("A").handSize, 0);
  assert.deepEqual(kernel.zone("A", "deck").map((ref) => ref.id), ["d1", "d2"]);
});

test("sfd-144-221 Spirit Wheel golden: the card's own cost pair fails closed on an already exhausted host (415.4)", () => {
  const base = world()
    .player("A", { energy: 3 })
    .unit("wheel", { types: ["gear"], might: 0, exhausted: true, location: { type: "base", player: "A" } })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("wheel") });
  const before = kernel.snapshot();

  assert.throws(
    () => runAbilityBody([preparePayment, pay], kernel),
    (error) => error?.reason === "cannot-pay-cost"
  );
  assert.deepEqual(kernel.snapshot(), before);
  assert.equal(kernel.player("A").energy, 3);
  assert.equal(kernel.getObject("wheel").exhausted, true);
  assert.deepEqual(kernel.events, []);
});

test("sfd-144-221 Spirit Wheel: the production chain body cannot literalize the declared cost.modify yet", () => {
  // Live evidence for the judgeReason gap: chain/interpreter-adapter.ts wraps
  // primitive arguments and only decodes the declared LITERAL_FIELDS, which do
  // not include cost.modify. The card's own leading instruction therefore
  // reaches the primitive schema with the id still wrapped in an Expr and fails
  // closed with a TypeError instead of silently paying nothing.
  const base = world()
    .player("A", { energy: 3 })
    .unit("wheel", { types: ["gear"], might: 0, location: { type: "base", player: "A" } })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("wheel") });

  assert.throws(
    () => resolveChainBody([preparePayment, pay], kernel),
    (error) => error instanceof TypeError && /cost\.modify id must be a non-empty string/.test(error.message)
  );
  assert.equal(kernel.player("A").energy, 3);
  assert.equal(kernel.getObject("wheel").exhausted, false);
  assert.deepEqual(kernel.events, []);
});

test("sfd-144-221 Spirit Wheel: accepting the optional never draws without a real payment (383.3.b)", () => {
  // 383.3.b/383.3.b.1: the printed "pay 1 energy and exhaust this" is the
  // ability's base cost, so accepting the printed optional may never produce
  // the draw for free. The whole declared body fails closed while the finalize
  // lift is missing (judgeReason), leaving resources, the host state and the
  // deck untouched; once the payment path lands, the payment test above pins
  // the required 1-Energy + exhaust charge.
  const base = world()
    .player("A", { energy: 3 })
    .deck(["d1", "d2"])
    .unit("wheel", { types: ["gear"], might: 0, location: { type: "base", player: "A" } })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("wheel") });
  kernel.setAnswers({ [OPTIONAL_ID]: true });

  assert.throws(
    () => resolveChainBody(optional.args.body.value, kernel),
    (error) => error instanceof TypeError && /cost\.modify id must be a non-empty string/.test(error.message)
  );
  // Nothing was approximated: no draw, no charge, no exhaust.
  assert.equal(kernel.player("A").handSize, 0);
  assert.equal(kernel.player("A").energy, 3);
  assert.equal(kernel.getObject("wheel").exhausted, false);
  assert.deepEqual(kernel.events, []);
});

test.todo(
  "sfd-144-221 Spirit Wheel: paying \"1 energy and exhaust this\" as the trigger's base cost " +
    "(CR 383.3.b/383.3.b.1) needs the TriggeredAbility cost field and the runtime payment " +
    "reference (non-standard exhaust) recorded as a contract change request."
);
