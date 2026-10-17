import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/rippers-bay.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import channel from "../../../../engine-core/dist/effects/instructions/effect.channel.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

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
  assert.match(program.judgeReason, /CostPlan/);
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

  // The printed 1 Energy is a cost within instructions (204.3.a). cost.pay is
  // not a merged instruction primitive, so the declaration keeps the amount
  // reviewable; the payer is the ability's controller (190.6.c/190.6.d), which
  // is why no fabricated player argument appears here.
  assert.equal(pay.op, "cost.pay");
  assert.deepEqual(pay.args.energy, { kind: "constant", value: 1 });
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

  const outcome = runAbilityBody(ability.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["rippers-bay.opt-in", "negated"]
  ]);
  assert.equal(outcome.results[0].result.reason, "skipped");
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
  "unl-214-219 Ripper's Bay: submit the 1-Energy cost within instructions at resolution " +
    "(CR 204.3.a/383.3.a) — cost.pay is merged and settles an already finalized CostPlan, " +
    "but no producer builds or submits the payer-scoped plan at resolution"
);

test.todo(
  "unl-214-219 Ripper's Bay: channel 1 rune exhausted really enters exhausted (CR 431.2) — the " +
    "reference kernel passes the stipulation to the channel-rune action but does not model rune " +
    "entry state; production turn/rune state owns it"
);
