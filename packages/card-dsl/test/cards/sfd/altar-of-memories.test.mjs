import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/altar-of-memories.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import costPay from "../../../../engine-core/dist/effects/instructions/cost.pay.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { isTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { registerProgramTriggers, triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
// resolveChainBody is the production card-body entry point
// (chain/engine.ts resolveChainBody(item.body, context)); it wraps primitive arg
// expressions the way the chain does, which is what effect.zone's Expr-only
// schema expects.
const { resolveChainBody } = await import(new URL("chain/interpreter-adapter.js", ENGINE));
const { runAbilityBody } = await import(new URL("effects/interpreter.js", ENGINE));
const { runInstruction, world } = await import(new URL("effects/testing/index.js", ENGINE));
const draw = (await import(new URL("effects/instructions/effect.draw.js", ENGINE))).default;

const CANONICAL = "card.hash-fae74af4b0507308396536f4f9d367af185a5d09b03c11aa0a1c4db55655778b";
const SOURCE_TEXT =
  "When a friendly unit dies, you may exhaust me to draw 1, then put a card from your hand " +
  "on the top or bottom of your Main Deck.";
const OPTIONAL_ID = "altar-of-memories.may-exhaust-and-draw/optional";
const DESTINATION_ID = "altar-of-memories.put-back/altar-of-memories.destination";

const [ability] = program.abilities;
const [optional] = ability.body;
const [payExhaust, drawInstruction, putBack] = optional.args.body.value;

test("sfd-169-221 Altar of Memories: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
});

test("sfd-169-221 Altar of Memories: identity, ruleset, status, judgeReason and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // README section 2: the remaining gap is the trigger base cost at Finalize,
  // including the CardProgram declaration and its locked payment plan.
  assert.match(program.judgeReason, /programs\/triggers\.ts/);
  assert.match(program.judgeReason, /Finalize/);
  assert.match(program.judgeReason, /383\.3\.b/);
  assert.match(program.judgeReason, /TriggeredAbility/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-169-221 Altar of Memories: an object-killed trigger for units you control", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 383.1 / 383.2.a / 429.1: "When a friendly unit dies" is the death trigger.
  assert.equal(ability.trigger.at, "object-killed");
  assert.deepEqual(ability.trigger.filter, {
    event: "object-killed",
    // "friendly" is relative to the ability controller (740.1.a).
    object: { type: "unit", controller: "self" }
  });
  assert.equal(ability.trigger.once, undefined);
  // 383.3.a: the printed "you may" is the trigger's own perform decision.
  assert.equal(ability.optional, true);
});

test("sfd-169-221 Altar of Memories: contract 3.9 — one choice.optional wrapping pay, draw and put-back", () => {
  assert.deepEqual(ability.body.map((instruction) => instruction.id), ["altar-of-memories.may-exhaust-and-draw"]);
  assert.equal(optional.op, "choice.optional");
  assert.equal(optional.args.body.kind, "constant");
  assert.deepEqual(optional.args.body.value.map((instruction) => instruction.id), [
    "altar-of-memories.pay-exhaust",
    "altar-of-memories.draw-1",
    "altar-of-memories.put-back"
  ]);
  assert.equal(optional.linkedTo, undefined);

  // 383.3.b / 383.3.b.1: "exhaust me" right after "you may" is the ability's
  // base cost, paid at finalize.
  assert.equal(payExhaust.op, "cost.pay");
  assert.deepEqual(payExhaust.args.payments, {
    kind: "constant",
    value: [{ kind: "exhaust", object: "self" }]
  });

  // 414.1 / 414.3: draw 1, linked to the paid cost.
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(drawInstruction.linkedTo, "altar-of-memories.pay-exhaust");

  // "then put a card from your hand on the top or bottom of your Main Deck":
  // "then" is a sequence word (no linkedTo); the hand card is a non-target pick
  // (355.10.a) and the top/bottom choice is made as the instruction resolves.
  assert.equal(putBack.op, "effect.zone");
  assert.deepEqual(putBack.args.pick, { kind: "constant", value: "altar-of-memories.hand-card" });
  assert.deepEqual(putBack.args.choice, {
    kind: "constant",
    value: {
      id: "altar-of-memories.destination",
      options: ["deck-top", "deck-bottom"],
      prompt: "Put that card on the top or the bottom of your Main Deck?"
    }
  });
  assert.equal(putBack.linkedTo, undefined);
  assert.equal(putBack.targets, undefined);
  assert.deepEqual(putBack.picks, [{
    id: "altar-of-memories.hand-card",
    options: ["card-in-controller-hand"],
    filter: { zone: "hand", owner: "controller" },
    min: 1,
    max: 1,
    selection: "one"
  }]);
});

test("sfd-169-221 Altar of Memories golden: declining the optional performs neither the cost nor the actions", () => {
  const kernel = world().deck(["d1"]).build();
  kernel.setAnswers({ [OPTIONAL_ID]: false });

  const outcome = runAbilityBody(ability.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map((result) => [result.id, result.result.status]), [
    ["altar-of-memories.may-exhaust-and-draw", "negated"]
  ]);
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.equal(kernel.player("A").handSize, 0);
  assert.deepEqual(kernel.events, []);
});

test("sfd-169-221 Altar of Memories golden: the printed draw really draws one card", () => {
  const kernel = world().deck(["top", "second"]).build();
  const run = runInstruction(draw, { amount: drawInstruction.args.amount }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["top"]);
  assert.deepEqual(run.events.map((event) => event.action), ["draw"]);
});

test("sfd-169-221 Altar of Memories golden: the chosen hand card goes on top of the Main Deck", () => {
  const kernel = world().hand("h1").deck(["d1", "d2"]).build();
  kernel.setPicks("altar-of-memories.hand-card", [kernel.ref("h1")]);
  kernel.setAnswers({ [DESTINATION_ID]: "deck-top" });

  const outcome = resolveChainBody([putBack], kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((result) => [result.id, result.result.status]), [
    ["altar-of-memories.put-back", "executed"]
  ]);
  assert.deepEqual(outcome.results[0].result.linkedValues, {
    moved: 1,
    movedIds: ["h1"],
    destination: "deck-top"
  });
  assert.deepEqual(kernel.zone("A", "hand"), []);
  // "your Main Deck": it is the ability controller's own deck.
  assert.deepEqual(kernel.zone("A", "deck").map((ref) => ref.id), ["h1", "d1", "d2"]);
  assert.deepEqual(kernel.events.map((event) => event.action), ["move-zone"]);
});

test("sfd-169-221 Altar of Memories golden: the chosen hand card goes to the bottom instead", () => {
  const kernel = world().hand("h1").deck(["d1", "d2"]).build();
  kernel.setPicks("altar-of-memories.hand-card", [kernel.ref("h1")]);
  kernel.setAnswers({ [DESTINATION_ID]: "deck-bottom" });

  const outcome = resolveChainBody([putBack], kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results[0].result.linkedValues, {
    moved: 1,
    movedIds: ["h1"],
    destination: "deck-bottom"
  });
  assert.deepEqual(kernel.zone("A", "deck").map((ref) => ref.id), ["d1", "d2", "h1"]);
});

test.todo(
  "Altar of Memories: register and finalize the friendly-death ability with its exhaust base cost (429.1/383.3.b.1); trigger translation already works"
);
test.todo(
  "Altar of Memories: carry CardProgram trigger cost into the existing TriggerRegistration.cost and Finalize transaction (383.3.b.1/415.4/415.5)"
);

test("Altar of Memories: the trigger registration carries no base cost and cost.pay rejects the card's payments array", () => {
  // 383.3.b.1 / 405.2: the leading "exhaust me" cost must be paid to finalize
  // the triggered ability. The merged TriggeredAbility contract has no cost
  // field, programs/triggers.ts emits no cost, and the merged payer refuses the
  // authored payments list (it is not a finalized plan), so no production path
  // can charge it.
  assert.equal(Object.hasOwn(ability, "cost"), false);
  const { judgeReason, ...executableProgram } = program;
  const registration = triggerRegistrations(
    new ProgramRegistry([{ ...executableProgram, status: "executable" }]),
    world().unit("altar", { cardId: CANONICAL, types: ["gear"] }).build().getObject("altar")
  )[0];
  assert.equal(registration.cost, undefined);

  const kernel = world().unit("altar", { types: ["gear"] }).build();
  assert.throws(() => runInstruction(costPay, { payments: payExhaust.args.payments }, { world: kernel }),
    error => error.reason === "cannot-pay-cost");
  assert.equal(kernel.getObject("altar").exhausted, false);
});

test("Altar of Memories: the merged registration really attaches to the event pipeline", () => {
  // The friendly-death trigger itself is registrable (429.1/740.1.a); only the
  // missing base cost blocks the card.
  const f = fixture({ cards: [{ id: "altar", cardId: CANONICAL, types: ["unit"] }] });
  const { judgeReason, ...executableProgram } = program;
  const registry = new ProgramRegistry([{ ...executableProgram, status: "executable" }]);
  const source = f.kernel.getObject("altar");
  const ids = registerProgramTriggers(registry, f.engine, source);
  assert.equal(ids.length, 1);
  const registered = triggerRegistrations(registry, source)[0];
  assert.deepEqual(registered.body.map(instruction => instruction.id), [
    "altar-of-memories.may-exhaust-and-draw"
  ]);
});


test("Altar of Memories: the merged trigger translator preserves friendly-death filtering", () => {
  const translated = translateTriggerFilter(ability.trigger.filter, "altar", ability.trigger.at);
  assert.deepEqual(translated, { event: "object-killed", object: { type: "unit", controller: "self" } });
  assert.equal(isTriggerSpec({ at: ability.trigger.at, filter: translated }), true);
});

test("Altar of Memories: a locked exhaust plan pays through cost.pay, while an exhausted source cannot pay", () => {
  for (const exhausted of [false, true]) {
    const base = world().unit("altar", { types: ["gear"], exhausted }).deck(["top", "bottom"]).build();
    const kernel = base.clone({ sourceSnapshot: base.getObject("altar") });
    const plan = buildCostPlan(kernel, {
      id: "altar.exhaust", cost: { kind: "activated", payments: payExhaust.args.payments.value }
    });
    if (exhausted) {
      const before = kernel.snapshot();
      assert.throws(() => runInstruction(costPay, { cost: { kind: "constant", value: plan } }, { world: kernel }),
        error => error.reason === "cannot-pay-cost");
      assert.deepEqual(kernel.snapshot(), before);
      assert.deepEqual(kernel.events, []);
    } else {
      const run = runInstruction(costPay, { cost: { kind: "constant", value: plan } }, { world: kernel });
      assert.equal(run.result.status, "executed");
      assert.equal(run.linked.payment.paid, true);
      assert.deepEqual(run.linked.payment.actions.map(entry => entry.action.type), ["pay", "exhaust"]);
      assert.equal(kernel.getObject("altar").exhausted, true);
      assert.equal(kernel.player("A").handSize, 0);
      assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["top", "bottom"]);
    }
  }
});
