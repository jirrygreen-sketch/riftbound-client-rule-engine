import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/battle-mistress.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { buildCostPlan, payCostPlan } from "../../../../engine-core/dist/cost/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

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
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /RIFT-261/);
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
  "sfd-203-221 Battle Mistress: card-recycled is missing from events/trigger-spec.ts's closed " +
    "EVENT_PATTERN_TYPES, and the event is emitted per card with no 'this recycle' batch predicate " +
    "(417.1/417.1.b, 185.1 'runes are not cards') — same gap as ogn/karma-channeler"
);
test.todo(
  "sfd-203-221 Battle Mistress: the Gold gear token (187.5) is not in effect.token's frozen definition " +
    "table, and 'exhausted' is an entry state (143.4/185.2.d) that create-token does not support"
);
test.todo(
  "sfd-203-221 Battle Mistress: the cost's 'exhaust me' needs a Legend Zone in contract 3.6's ZoneId " +
    "(CR 108.3) and the card-side cost.pay entry point (RIFT-261); the triggers need the RIFT-257 " +
    "card-program -> TriggerRegistration subscriber"
);
test.todo(
  "sfd-203-221 Battle Mistress: 'one or more enemy units die' needs simultaneous-event batching and " +
    "responsibility attribution (370.1.a.2 / 383.1.b); object-killed is emitted per unit with the dying " +
    "unit's controller in `player`, so two simultaneous deaths would trigger twice instead of once"
);
