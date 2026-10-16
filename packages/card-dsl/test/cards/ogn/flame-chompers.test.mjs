import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/flame-chompers.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-0f5f84f75dbe0744c93412016da28963e78fa05c747a4b3163be7cfef5f26cc9";
const TRIGGERED = program.abilities[0];
const CHOICE = TRIGGERED.body[0];
const ACCEPT_BODY = CHOICE.args.body.value;

test("flame-chompers: passes validateCardProgram and is indexed by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(cardProgramsById.get(CARD_ID), program);
});

test("flame-chompers: identity, ruleset, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /cost\.pay/);
  assert.match(program.judgeReason, /RIFT-261/);
  assert.match(program.judgeReason, /366\.1/);
  assert.equal(program.sourceText, "When you discard me, you may pay :rb_rune_fury: to play me.");
});

test("flame-chompers: 'When you discard me' subscribes to card-discarded filtered to the source (423.1.b)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(TRIGGERED.kind, "triggered");
  assert.equal(TRIGGERED.trigger.at, "card-discarded");
  assert.deepEqual(TRIGGERED.trigger.filter, { event: "card-discarded", filter: { source: "self" } });
  assert.equal(TRIGGERED.trigger.condition, undefined);
  assert.equal(TRIGGERED.trigger.once, undefined);
  assert.equal(TRIGGERED.optional, true);
});

test("flame-chompers: 'you may ...' is choice.optional wrapping the selected body (contract 3.9)", () => {
  assert.equal(TRIGGERED.body.length, 1);
  assert.equal(CHOICE.id, "flame-chompers.opt-in");
  assert.equal(CHOICE.op, "choice.optional");
  assert.equal(CHOICE.args.body.kind, "constant");
  assert.deepEqual(CHOICE.args.prompt, {
    kind: "constant",
    value: "Pay :rb_rune_fury: to play Flame Chompers from your trash?"
  });
  // The selected instructions live inside body, never as choice + linkedTo.
  assert.equal(CHOICE.linkedTo, undefined);
  assert.deepEqual(ACCEPT_BODY.map(instruction => instruction.id), ["flame-chompers.play"]);
});

test("flame-chompers: the accepted body declares a finalized 1-Fury-Power play of the trash card (356.1.a, 420.3)", () => {
  const [play] = ACCEPT_BODY;
  assert.equal(play.op, "effect.play");
  assert.equal(play.linkedTo, undefined);
  assert.deepEqual(play.args.target, { kind: "constant", value: "flame-chompers.self" });
  assert.deepEqual(play.args.cost, {
    kind: "constant",
    // No energy/xp component: this card has no printed Energy cost, and the
    // alternate cost never turns "no printed cost" into "energy 0" (356.1.a).
    value: { finalized: true, power: ["Fury"] }
  });
  assert.deepEqual(play.args.location, { kind: "constant", value: { type: "base", player: "controller" } });
  assert.equal(play.targets.length, 1);
  const [target] = play.targets;
  assert.equal(target.id, "flame-chompers.self");
  // Contract 3.6: the card program points at itself with the symbolic selector.
  assert.deepEqual(target.filter, { source: "self", zone: "trash" });
  assert.equal(target.min, 1);
  assert.equal(target.max, 1);
  assert.equal(target.selection, "one");
});

test("flame-chompers: declining skips the whole accepted body and leaves the trash alone", () => {
  const kernel = world().card("flame-chompers", { owner: "A", zone: "trash" }).build();
  kernel.setAnswers({ "flame-chompers.opt-in/optional": false });
  const outcome = resolveChainBody(TRIGGERED.body, kernel);
  assert.deepEqual(outcome.results.map(result => result.id), ["flame-chompers.opt-in"]);
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.deepEqual(kernel.events, []);
  assert.deepEqual(kernel.zone("A", "trash").map(ref => ref.id), ["flame-chompers"]);
  assert.equal(kernel.zone("A", "board").length, 0);
});

test("flame-chompers: the 'play me' half runs as a real play of the trash card (420.3)", () => {
  // Sub-effect evidence only: the printed 1-Fury-Power payment is the unmerged
  // half (judgeReason), so this scenario deliberately supplies no cost plan to
  // effect.play and asserts nothing about payment. The reference kernel's pay
  // action models Energy/XP and cannot prove a Power payment either way.
  const base = world().card("flame-chompers", { owner: "A", zone: "trash" }).build();
  const kernel = base.clone({
    source: base.ref("flame-chompers"),
    sourceSnapshot: base.getObject("flame-chompers")
  });
  // Finalize locks targets before resolution (interpreter README); the golden
  // supplies the locked target for the declared "flame-chompers.self" spec.
  kernel.setTargets("flame-chompers.self", [kernel.ref("flame-chompers")]);
  const [play] = ACCEPT_BODY;
  const { cost: _omitted, ...argsWithoutCost } = play.args;
  const outcome = resolveChainBody([{ ...play, args: argsWithoutCost }], kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(kernel.events.map(event => event.action), ["play"]);
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(outcome.results[0].result.linkedValues.played, 1);
  const board = kernel.zone("A", "board");
  assert.equal(board.length, 1);
  assert.deepEqual(board[0], kernel.ref("flame-chompers"));
});

test.todo(
  "flame-chompers: cost.pay / cost.printed primitives and the card-program -> cost-plan wiring remain RIFT-261 work"
);
test.todo(
  "flame-chompers: paying :rb_rune_fury: and the resulting FinalizedCostPlan must be produced by the cost system " +
    "(356.1.a 'for [Cost]' / 357.2 payment) before the accepted branch may claim to play the card for its alternate cost"
);
test.todo(
  "flame-chompers: playing itself from trash needs the 366.1 zone permission and a Finalize play-location check (RIFT-257)"
);
