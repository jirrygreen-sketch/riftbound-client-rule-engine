import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/rippers-bay.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import channel from "../../../../engine-core/dist/effects/instructions/effect.channel.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createProgramBinding, translateTriggerFilter } from "../../../../engine-core/dist/programs/index.js";
import { assertTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL =
  "card.hash-3d96eb343671872c717cc1217d0c5e82368ec20ade63cc420ecdaf7d9aee1cef";
const SOURCE_TEXT =
  "When a unit here is returned to a player's hand, that player may pay :rb_energy_1: to channel 1 rune exhausted.";
const OPTIONAL_ID = "rippers-bay.opt-in/optional";

const [ability] = program.abilities;
const [choice] = ability.body;
const [pay, channelRune] = choice.args.body.value;

test("unl-214-219 Ripper's Bay: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-214-219 Ripper's Bay: identity, ruleset, status and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardProgramsById.get(program.canonicalCardId), program);
});

test("unl-214-219 Ripper's Bay: judgeReason names the event-player, location and cost gaps", () => {
  assert.match(program.judgeReason, /190\.6\.c/);
  assert.match(program.judgeReason, /object-enters-hand/);
  assert.match(program.judgeReason, /cost\.pay/);
  assert.match(program.judgeReason, /payments/);
  // 2026-10-18 re-sweep: the reason also names the measured pattern-name
  // rejection and the dropped "here" clause.
  assert.match(program.judgeReason, /object-entered-zone/);
  assert.match(program.judgeReason, /TriggerSpecValidationError/);
  assert.match(program.judgeReason, /fromZone/);
  assert.doesNotMatch(program.judgeReason, /没有生产者|生产方.*支付|CostPlan.*生产/);
});

test("unl-214-219 Ripper's Bay: a unit entering a hand from this Battlefield is the trigger event", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, true);
  // 383.2.c / 108.7 / 414.1: the merged subscription point for a card entering
  // a player's hand; the returned unit is the event object (355.9.a.1).
  assert.equal(ability.trigger.at, "object-enters-hand");
  assert.deepEqual(ability.trigger.filter, {
    event: "object-enters-hand",
    object: { type: "unit" },
    here: true
  });
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.trigger.condition, undefined);
});

test("unl-214-219 Ripper's Bay: contract 3.9 optional wrapper around pay 1 then channel 1 exhausted", () => {
  // 204.3.a / 383.3.a: "that player may pay [1] to channel 1 rune" is one
  // optional decision; contract 3.9 puts the chosen instructions inside the
  // choice.optional body (never a choice plus a linkedTo consumer).
  assert.deepEqual(ability.body.map(instruction => instruction.id), ["rippers-bay.opt-in"]);
  assert.equal(choice.op, "choice.optional");
  assert.deepEqual(choice.args.prompt, {
    kind: "constant",
    value: "Pay 1 energy to channel 1 rune exhausted?"
  });
  assert.equal(choice.args.body.kind, "constant");
  assert.deepEqual(choice.args.body.value.map(instruction => instruction.id), [
    "rippers-bay.pay",
    "rippers-bay.channel"
  ]);
  assert.equal(choice.linkedTo, undefined);
  assert.equal(choice.targets, undefined);
  assert.equal(choice.picks, undefined);

  // The merged cost.pay primitive accepts an inline payments map and builds the
  // one-energy plan for the current ability controller.
  assert.equal(pay.op, "cost.pay");
  assert.deepEqual(pay.args.payments, {
    kind: "constant",
    value: { energy: 1 }
  });
  assert.equal(pay.args.energy, undefined);
  assert.equal(pay.args.payer, undefined);

  // 431.1 / 431.2: channel one rune from the top of the channelling player's
  // Rune Deck, entering exhausted (431.2.a is the readied default being
  // overridden). The player defaults to the ability's controller.
  assert.equal(channelRune.op, "effect.channel");
  assert.equal(channelRune.linkedTo, "rippers-bay.pay");
  assert.deepEqual(channelRune.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(channelRune.args.exhausted, { kind: "constant", value: true });
  assert.equal(channelRune.args.player, undefined);
});

test("unl-214-219 Ripper's Bay: declining the optional performs neither the payment nor the channel", () => {
  const kernel = world().unit("unit-here", { owner: "A" }).rune(["r1", "r2"]).build();
  kernel.setAnswers({ [OPTIONAL_ID]: false });

  const outcome = resolveChainBody(ability.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["rippers-bay.opt-in", "negated"]
  ]);
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.equal(kernel.player("A").runeDeckSize, 2);
  assert.equal(kernel.player("A").runePool.length, 0);
  assert.deepEqual(kernel.events, []);
});

test("unl-214-219 Ripper's Bay: payments executes 1 Energy before channeling", () => {
  const kernel = world()
    .player("A", { energy: 1 })
    .unit("unit-here", { owner: "A", controller: "A" })
    .rune(["r1", "r2"], { owner: "A" })
    .build();
  kernel.setAnswers({ [OPTIONAL_ID]: true });

  const outcome = resolveChainBody(ability.body, kernel);

  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.player("A").energy, 0);
  assert.equal(kernel.player("A").runeDeckSize, 1);
  assert.equal(kernel.player("A").runePool.length, 1);
  assert.deepEqual(kernel.events.map(event => event.action), ["pay", "channel-rune"]);
});

test("unl-214-219 Ripper's Bay: insufficient Energy rejects payment before channeling", () => {
  const kernel = world()
    .player("A", { energy: 0 })
    .unit("unit-here", { owner: "A", controller: "A" })
    .rune(["r1", "r2"], { owner: "A" })
    .build();
  kernel.setAnswers({ [OPTIONAL_ID]: true });

  assert.throws(
    () => resolveChainBody(ability.body, kernel),
    /cannot-pay-cost|Insufficient|Energy/i
  );
  assert.equal(kernel.player("A").energy, 0);
  assert.equal(kernel.player("A").runeDeckSize, 2);
  assert.equal(kernel.player("A").runePool.length, 0);
  assert.deepEqual(kernel.events, []);
});

test("unl-214-219 Ripper's Bay: the printed channel half takes 1 rune from that player's Rune Deck (431.1)", () => {
  // The channelling player is the ability's controller (190.6.c/190.6.d), so
  // the controller is bound here to the player whose unit was returned. Only
  // that player's Rune Deck may be used.
  const base = world()
    .unit("unit-here", { owner: "B", controller: "B" })
    .rune(["r1", "r2"], { owner: "B" })
    .build();
  const kernel = base.clone({ controller: "B" });
  const run = runInstruction(
    channel,
    { amount: channelRune.args.amount, exhausted: channelRune.args.exhausted },
    { world: kernel }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.channeled, 1);
  // 431.1: one rune left the top of B's Rune Deck for B's rune pool; A's Rune
  // Deck was never touched.
  assert.deepEqual(kernel.zone("B", "rune-zone").map(ref => ref.id), ["r1"]);
  assert.equal(kernel.zone("B", "rune-deck").map(ref => ref.id).length, 1);
  assert.equal(kernel.player("A").runePool.length, 0);
  assert.deepEqual(run.events.map(event => event.action), ["channel-rune"]);
});

test("unl-214-219 Ripper's Bay: a short Rune Deck channels as much as possible (431.3)", () => {
  const kernel = world().rune([]).build();
  const run = runInstruction(
    channel,
    { amount: channelRune.args.amount, exhausted: channelRune.args.exhausted },
    { world: kernel }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.channeled, 0);
  assert.equal(kernel.player("A").runePool.length, 0);
});

test("unl-214-219 Ripper's Bay: the authored trigger cannot be registered, and the closed spelling drops \"here\"", () => {
  // 383.2.c.3.b: the "here" check needs the returned unit's former Battlefield.
  // Two measured defects block the subscription:
  //  (a) the authored filter names the timing point id "object-enters-hand",
  //      but EventPattern only admits the closed pattern names; the translated
  //      spec fails validation and registerProgramTriggers throws;
  //  (b) with the admitted "object-entered-zone" spelling the here clause is
  //      dropped by programs/filters.ts, so the registration would match a unit
  //      returning from any zone.
  const translated = translateTriggerFilter(ability.trigger.filter, "rippers-bay", ability.trigger.at);
  assert.deepEqual(translated, { event: "object-enters-hand", object: { type: "unit" } });
  assert.throws(
    () => assertTriggerSpec({ at: ability.trigger.at, filter: translated }),
    (error) => error.name === "TriggerSpecValidationError" && /trigger\.filter\.event/.test(error.message)
  );

  const f = fixture({ cards: [] });
  const source = { ...f.kernel.getObject("source"), cardId: program.canonicalCardId, keywords: [] };
  assert.throws(
    () => createProgramBinding({
      cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }]
    }).registerProgramTriggers(f.engine, source),
    (error) => error.name === "TriggerSpecValidationError"
  );

  // The admitted spelling registers, but the "here" clause is gone: the filter
  // keeps the entering object and its zone only.
  const widened = translateTriggerFilter(
    { event: "object-entered-zone", object: { type: "unit" }, here: true },
    "rippers-bay",
    "object-enters-hand"
  );
  assert.deepEqual(widened, { event: "object-entered-zone", object: { type: "unit" } });
  assert.equal(Object.hasOwn(widened, "here"), false);
  assert.doesNotThrow(() => assertTriggerSpec({ at: "object-enters-hand", filter: widened }));
});

test("unl-214-219 Ripper's Bay: the return-to-hand emission carries no former Battlefield", () => {
  // 053.3: "here" is the departing unit's Battlefield. The merged
  // object-enters-hand emission exposes the entering object and fromZone=board
  // only: ZoneChangeProducerContext.details is { cause }, so nothing in the
  // payload identifies which Battlefield the unit left.
  const f = fixture({ cards: [{ id: "unit", types: ["unit"] }] });
  // Put the unit on the Battlefield first: the fixture builds cards into hand.
  assert.equal(f.engine.pipeline.commit({
    type: "move-zone",
    object: f.kernel.ref("unit"),
    to: "board",
    location: { type: "battlefield", id: "bf-1" }
  }).status, "done");
  const seen = [];
  f.engine.pipeline.onEvent = event => seen.push(event);
  // Commit through the pipeline so the real zone-change emissions are derived.
  assert.equal(f.engine.pipeline.commit({ type: "return-to-hand", object: f.kernel.ref("unit") }).status, "done");
  const entries = seen.filter(event => event.timingPoint === "object-enters-hand");
  assert.equal(entries.length, 1);
  const [entry] = entries;
  assert.equal(entry.fromZone, "board");
  assert.equal(entry.toZone, "hand");
  assert.equal(entry.details?.battlefieldId, undefined);
  // The card stops at the Battlefield's own location, so the printed clause is
  // not dropped: it stays in the authored filter (see the structural test).
  assert.equal(ability.trigger.filter.here, true);
});

test.todo(
  "unl-214-219 Ripper's Bay: restrict the trigger to a unit returning from this Battlefield " +
    "(CR 053.3) — the merged object-enters-hand emission carries the entering object and " +
    "fromZone=board but no battlefield id, so 'here' cannot be evaluated yet"
);

test.todo(
  "unl-214-219 Ripper's Bay: resolve 'that player' as the ability's controller so the payment and " +
    "the channel belong to the player whose unit was returned (CR 190.6.c) — needs an event-player " +
    "binding in the CardProgram TriggerRegistration (contract change request plus RIFT-33)"
);

test.todo(
  "unl-214-219 Ripper's Bay: channel 1 rune exhausted really enters exhausted (CR 431.2) — the " +
    "reference kernel passes the stipulation to the channel-rune action but does not model rune " +
    "entry state; production turn/rune state owns it"
);
