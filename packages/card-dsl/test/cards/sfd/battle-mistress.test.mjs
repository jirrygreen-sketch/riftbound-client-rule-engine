import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/battle-mistress.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { buildCostPlan, payCostPlan } from "../../../../engine-core/dist/cost/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

import costPay from "../../../../engine-core/dist/effects/instructions/cost.pay.js";
import { runInstruction } from "../../../../engine-core/dist/effects/testing/index.js";
import tokenInstruction from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { isTriggerSpec, validateTriggerSpec, OBJECT_FILTER_ZONES } from "../../../../engine-core/dist/events/trigger-spec.js";
import { registerProgramTriggers, triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CARD_ID = "card.hash-01131fb927733e60c9009e61900d2495713b314af34ab00ef3cddc7512efe6be";
const SOURCE_TEXT =
  "When you recycle a rune, you may exhaust me to play a Gold gear token exhausted.\n" +
  "When one or more enemy units die, ready me.";

const [recycleTrigger, deathTrigger] = program.abilities;
const optionalAbility = recycleTrigger.body[0];
const optionalBody = optionalAbility.args.body.value;
const [payExhaust, playGold] = optionalBody;
const [readySelf] = deathTrigger.body;

const legendWorld = ({ exhausted = false } = {}) => {
  const base = world()
    .unit("battle-mistress", { types: ["legend"], exhausted, location: { type: "base", player: "A" } })
    .build();
  return base.clone({ sourceSnapshot: base.getObject("battle-mistress") });
};

test("sfd-203-221 Battle Mistress: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-203-221 Battle Mistress: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /card-recycled/);
  assert.match(program.judgeReason, /187\.5/);
  assert.match(program.judgeReason, /one or more/);
  assert.match(program.judgeReason, /TriggeredAbility/);
  assert.match(program.judgeReason, /legend-zone/);
});

test("sfd-203-221 Battle Mistress: 'when you recycle a rune' subscribes to the recycle event", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(recycleTrigger.kind, "triggered");
  // 417.1 / 417.1.b: Recycling moves cards to the bottom of the corresponding
  // deck (runes to the Rune Deck); the event pipeline maps the recycle action
  // to card-recycled (events/action-adapter.ts). "you" is the ability
  // controller (412.4) and "a rune" is a rune object, not a card (185.1).
  assert.equal(recycleTrigger.trigger.at, "card-recycled");
  assert.deepEqual(recycleTrigger.trigger.filter, {
    event: "card-recycled",
    player: "self",
    object: { type: "rune" }
  });
  assert.equal(recycleTrigger.trigger.once, undefined);
  assert.equal(recycleTrigger.trigger.condition, undefined);
  // 403.1 / 383.3.a + contract 3.9: the leading "you may" wraps the chosen
  // instructions in choice.optional's body.
  assert.equal(recycleTrigger.optional, true);
  assert.equal(recycleTrigger.body.length, 1);
});

test("sfd-203-221 Battle Mistress: the may-body pays the exhaust cost then plays a Gold token", () => {
  assert.equal(optionalAbility.id, "battle-mistress.may-play-gold");
  assert.equal(optionalAbility.op, "choice.optional");
  assert.equal(optionalAbility.linkedTo, undefined);
  assert.deepEqual(optionalBody.map(instruction => [instruction.id, instruction.op]), [
    ["battle-mistress.pay-exhaust", "cost.pay"],
    ["battle-mistress.play-gold", "effect.token"]
  ]);
  // "exhaust me": 415.4/415.5 — a cost, not effect.exhaust's state change.
  assert.deepEqual(payExhaust.args, {
    payments: { kind: "constant", value: [{ kind: "exhaust", object: "self" }] }
  });
  // "play a Gold gear token exhausted" (187.5 / 440.2.c / 185.2.a / 185.2.d).
  assert.deepEqual(playGold.args, {
    token: { kind: "constant", value: "gold" },
    amount: { kind: "constant", value: 1 },
    mode: { kind: "constant", value: "play" },
    linkKey: { kind: "constant", value: "goldToken" }
  });
  assert.equal(playGold.linkedTo, "battle-mistress.pay-exhaust");
});

test("sfd-203-221 Battle Mistress: 'when one or more enemy units die' is a death trigger readying the legend", () => {
  assert.equal(deathTrigger.kind, "triggered");
  // 429.1 / 429.2: "die" corresponds to the object-killed timing point; 740.1.b
  // makes "enemy" the controller-relative opponent selector.
  assert.equal(deathTrigger.trigger.at, "object-killed");
  assert.deepEqual(deathTrigger.trigger.filter, {
    event: "object-killed",
    object: { type: "unit", zone: "board", controller: "opponent" }
  });
  assert.equal(deathTrigger.trigger.once, undefined);
  // "ready me" is mandatory.
  assert.equal(deathTrigger.optional, false);
  assert.equal(deathTrigger.body.length, 1);
  assert.equal(readySelf.id, "battle-mistress.ready-self");
  assert.equal(readySelf.op, "effect.ready");
  // "ready me": effect.ready's default selection is the ability source.
  assert.deepEqual(readySelf.args, {});
  assert.equal(readySelf.targets, undefined);
  assert.equal(readySelf.linkedTo, undefined);
});

test("sfd-203-221 Battle Mistress: the incoming death-trigger body really readies the legend", () => {
  const kernel = legendWorld({ exhausted: true });

  const outcome = resolveChainBody(deathTrigger.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["battle-mistress.ready-self", "executed"]
  ]);
  assert.equal(kernel.getObject("battle-mistress").exhausted, false);
  assert.deepEqual(kernel.events.map(event => event.action), ["ready"]);
});

test("sfd-203-221 Battle Mistress: the death-trigger ready is a no-op on an already ready legend (416.1.c)", () => {
  const kernel = legendWorld({ exhausted: false });

  const outcome = resolveChainBody(deathTrigger.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(kernel.getObject("battle-mistress").exhausted, false);
  // 416.1.c: nothing additional happens, so no ready action is committed.
  assert.deepEqual(kernel.events, []);
});

test("sfd-203-221 Battle Mistress: declining the recycle trigger pays nothing and creates nothing", () => {
  const kernel = legendWorld();
  kernel.setAnswers({ "battle-mistress.may-play-gold/optional": false });

  const outcome = resolveChainBody(recycleTrigger.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status, result.result.reason]), [
    ["battle-mistress.may-play-gold", "negated", "skipped"]
  ]);
  assert.equal(kernel.getObject("battle-mistress").exhausted, false);
  assert.deepEqual(kernel.events, []);
  assert.equal(kernel.query({ zone: "board", type: "gear" }).length, 0);
});

test("sfd-203-221 Battle Mistress: the printed exhaust cost is charged as a real exhaust payment", () => {
  const kernel = legendWorld();
  const plan = buildCostPlan(kernel, {
    id: "cost:battle-mistress",
    cost: { kind: "activated", payments: payExhaust.args.payments.value }
  });

  assert.deepEqual(plan.total.actions.map(entry => entry.action.type), ["exhaust"]);
  const receipt = payCostPlan(kernel, plan);
  assert.equal(receipt.paid, true);
  assert.deepEqual(receipt.actions.map(entry => entry.action.type), ["pay", "exhaust"]);
  assert.equal(kernel.getObject("battle-mistress").exhausted, true);
});

test.todo(
  "Battle Mistress: accept the card-recycled EventPattern with rune and responsible-player filtering (417.1/185.1)"
);
test.todo(
  "Battle Mistress: define Gold with its own printed ability and support exhausted entry (187.5/143.4/185.2.d)"
);
test.todo(
  "Battle Mistress: bind the trigger base cost at Finalize and support a Legend Zone exhaust payer (383.3.b.1/107.4)"
);
test.todo(
  "Battle Mistress: group simultaneous enemy deaths by the same game action so one or more triggers once (370.1.a.2)"
);

test("Battle Mistress: the recycle trigger really cannot register through the closed event vocabulary", () => {
  // 417.1/185.1: the actions adapter emits card-recycled for real recycle
  // actions, but the event pattern vocabulary has no such name, so trigger
  // registration is rejected before any filtering happens.
  const translated = translateTriggerFilter(recycleTrigger.trigger.filter, "battle-mistress", recycleTrigger.trigger.at);
  const validation = validateTriggerSpec({ at: recycleTrigger.trigger.at, filter: translated });
  assert.equal(validation.ok, false);
  assert.deepEqual(validation.issues.map(issue => issue.code), ["invalid-event-type"]);

  const f = fixture({ cards: [{ id: "battle-mistress", cardId: CARD_ID, types: ["legend"] }] });
  const registry = new ProgramRegistry([{ ...program, status: "executable", judgeReason: undefined }]);
  const source = f.kernel.getObject("battle-mistress");
  // Both abilities translate into registrations; only the death trigger's event
  // name is in the closed vocabulary, so registering the set fails on the
  // recycle trigger and leaves the pipeline without the card's triggers.
  const registrations = triggerRegistrations(registry, source);
  assert.deepEqual(registrations.map(registration => registration.spec.at), ["card-recycled", "object-killed"]);
  assert.throws(() => registerProgramTriggers(registry, f.engine, source),
    error => error.name === "TriggerSpecValidationError" &&
      error.issues.some(issue => issue.code === "invalid-event-type" && issue.path === "trigger.filter.event"));
  assert.equal(f.engine.pipeline.triggers.size, 0);
});

test("Battle Mistress: the Gold gear token is created and played on the real chain", () => {
  // 187.5/185.2.a: Gold carries its own printed ability and is a canonical
  // creatable/playable token. The card's own arguments drive the shared
  // create-token -> Play handoff.
  const kernel = legendWorld();
  const run = runInstruction(tokenInstruction, { ...playGold.args, location: { kind: "constant", value: { type: "base", player: "A" } } }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.goldToken.blockedReason, undefined);
  assert.equal(run.linked.goldToken.amount, 1);
  assert.equal(run.linked.goldToken.createdAmount, 1);
  const golds = run.world.query({ zone: "board", type: "gear" }).filter(object => object.isToken);
  assert.equal(golds.length, 1);
  assert.equal(golds[0].name, "Gold");
  assert.deepEqual(golds[0].types, ["gear"]);
  assert.deepEqual(golds[0].location, { type: "base", player: "A" });
  assert.equal(golds[0].energy, null);
  assert.equal(golds[0].power, null);
  assert.deepEqual(run.events.map(event => [event.action, event.timingPoint]), [
    ["create-token", "chain-item-pending"],
    ["pay", "main-start"],
    ["play", "card-played"]
  ]);
});

test("Battle Mistress: the trigger base cost has no declaration point or Finalize consumer", () => {
  // 383.3.b.1/415.4/415.5: "you may exhaust me to" must be paid to finalize the
  // ability. TriggeredAbility has no cost field, programs/triggers.ts never
  // fills TriggerRegistration.cost, and the legend-zone payer is missing.
  assert.equal(Object.hasOwn(recycleTrigger, "cost"), false);
  const f = fixture({ cards: [{ id: "battle-mistress", cardId: CARD_ID, types: ["legend"] }] });
  const registry = new ProgramRegistry([{ ...program, status: "executable", judgeReason: undefined }]);
  const registration = triggerRegistrations(registry, f.kernel.getObject("battle-mistress"))[0];
  assert.equal(registration.cost, undefined);
  assert.equal(OBJECT_FILTER_ZONES.includes("legend-zone"), false);
});


test("Battle Mistress: the merged trigger translator preserves enemy-unit death filtering", () => {
  const translated = translateTriggerFilter(deathTrigger.trigger.filter, "battle-mistress", deathTrigger.trigger.at);
  assert.deepEqual(translated, { event: "object-killed", object: { type: "unit", zone: "board", controller: "opponent" } });
  assert.equal(isTriggerSpec({ at: deathTrigger.trigger.at, filter: translated }), true);
});

test("Battle Mistress: cost.pay consumes a locked exhaust plan without granting the unresolved token", () => {
  // The existing reference fixture binds a board source for the supported
  // payment half; it does not model the missing Legend Zone payment path.
  const kernel = legendWorld();
  const plan = buildCostPlan(kernel, { id: "battle-mistress.exhaust", cost: { kind: "activated", payments: payExhaust.args.payments.value } });
  const run = runInstruction(costPay, { cost: { kind: "constant", value: plan } }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.payment.paid, true);
  assert.equal(kernel.getObject("battle-mistress").exhausted, true);
  assert.equal(kernel.query({ type: "gear" }).length, 0);
});
