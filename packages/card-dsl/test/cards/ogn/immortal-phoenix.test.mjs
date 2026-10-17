import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/immortal-phoenix.js";
import pay from "../../../../engine-core/dist/effects/instructions/cost.pay.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import play from "../../../../engine-core/dist/effects/instructions/effect.play.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-acb364f84a4f3f4cdad5e6ff9db1641d7f71a3989926dd02555f13274d3ec43d";
const MAY_ID = "immortal-phoenix.may-play";

test("ogn-037-298 Immortal Phoenix: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /429\.5/);
  assert.match(program.judgeReason, /Trash/);
  assert.match(program.judgeReason, /Finalize/);
  assert.match(program.judgeReason, /designation/);
  assert.match(program.judgeReason, /combatRole/);
  assert.match(program.judgeReason, /activeZones/);
  assert.match(program.judgeReason, /programs\/triggers\.ts/);
  assert.ok(!/RIFT-\d+/.test(program.judgeReason));
});

test("ogn-037-298 Immortal Phoenix: identity, ruleset and exact source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(
    program.sourceText,
    "[Assault 2] (+2 :rb_might: while I'm an attacker.)\n" +
      "When you kill a unit with a spell, you may pay :rb_energy_1::rb_rune_fury: to play me from your trash."
  );
});

test("ogn-037-298 Immortal Phoenix: Assault 2 plus a kill-with-a-spell trigger optionally playing self from trash", () => {
  assert.equal(program.abilities.length, 2);
  const [assault, triggered] = program.abilities;
  assert.deepEqual(assault, { kind: "keyword", keyword: "assault", value: 2 });

  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "object-killed");
  assert.deepEqual(triggered.trigger.filter, {
    event: "object-killed",
    filter: { zone: "board", type: "unit" }
  });
  assert.equal(triggered.optional, false);

  // The condition needs both the spell attribution (429.5.c/.d) and the
  // "active while in the trash" clause (385.2, 383.2.c.1).
  const condition = triggered.trigger.condition;
  assert.equal(condition.kind, "all");
  assert.equal(condition.conditions.length, 2);
  assert.equal(condition.conditions[0].left.subject, "kill-sources-this-event");
  assert.deepEqual(condition.conditions[0].left.filter, { type: "spell", controller: "controller" });
  assert.equal(condition.conditions[0].operator, "gte");
  assert.deepEqual(condition.conditions[1].left, { kind: "object-property", object: "self", property: "zone" });
  assert.deepEqual(condition.conditions[1].right, { kind: "constant", value: "trash" });

  assert.equal(triggered.body.length, 1);
  const [choice] = triggered.body;
  assert.equal(choice.id, MAY_ID);
  assert.equal(choice.op, "choice.optional");
  const body = choice.args.body.value;
  assert.deepEqual(body.map((instruction) => [instruction.id, instruction.op]), [
    ["immortal-phoenix.pay", "cost.pay"],
    ["immortal-phoenix.play-from-trash", "effect.play"]
  ]);
  assert.deepEqual(body[0].args, {
    payments: { kind: "constant", value: { energy: 1, power: ["Fury"] } }
  });
  assert.equal(body[1].linkedTo, "immortal-phoenix.pay");
  assert.deepEqual(body[1].args.object, { kind: "object-property", object: "self", property: "ref" });
  assert.equal(body[1].targets, undefined);
});

test("ogn-037-298 Immortal Phoenix: the linked play instruction moves the card from trash to the board", () => {
  // effect.play with an already-finalized zero cost: the merged primitive
  // performs the zone move itself. The actual 1 + Fury payment is tested
  // separately below; the resulting Play Finalize/location lifecycle remains
  // judged. This isolated handoff is not whole-ability execution evidence.
  const initial = world()
    .card("phoenix", { owner: "A", zone: "trash", types: ["unit"], might: 3 })
    .build();
  const kernel = initial.clone({ sourceSnapshot: initial.getObject("phoenix") });
  const instruction = program.abilities[1].body[0].args.body.value[1];
  const run = runInstruction(
    play,
    instruction.args,
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.played, 1);
  assert.equal(kernel.getObject("phoenix").zone, "board");
  // The finalized zero-cost plan still routes through the pay action before the
  // play action commits the zone move.
  assert.deepEqual(run.events.map((event) => event.action), ["pay", "play"]);
});

test("ogn-037-298 Immortal Phoenix: playing a stale trash reference is ignored, not rebinding another card", () => {
  // A new object identity after leaving the trash must not be silently rebound
  // to the same id (CR 124); the interpreter/kernel drops stale refs.
  const initial = world()
    .card("phoenix", { owner: "A", zone: "trash", types: ["unit"], might: 3 })
    .build();
  const kernel = initial.clone({ sourceSnapshot: initial.getObject("phoenix") });
  const stale = kernel.ref("phoenix");
  kernel.perform({ type: "banish", object: stale });
  const instruction = program.abilities[1].body[0].args.body.value[1];
  const run = runInstruction(
    play,
    instruction.args,
    { world: kernel }
  );
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
  assert.equal(kernel.getObject("phoenix").zone, "banishment");
});

test.todo(
  'ogn-037-298 Immortal Phoenix: the "when you kill a unit with a spell" trigger attribution ' +
    "(429.5.c/.d) and the trash-zone registration window (385.2) are needed before the trigger can fire " +
    "for real."
);
test.todo(
  "ogn-037-298 Immortal Phoenix: paying :rb_energy_1::rb_rune_fury: to play from the trash through the " +
    "cost pipeline and asserting the payment events; cost.pay.payments already executes but the production nested Play binding " +
    "still needs the alternative-cost window and resulting-Play Finalize location choices."
);

test("Immortal Phoenix payment regression: the original cost.pay instruction pays 1 Energy plus Fury", () => {
  const kernel = world().player("A", { energy: 2, power: ["Fury"] })
    .card("phoenix", { zone: "trash" }).build();
  const payment = program.abilities[1].body[0].args.body.value[0];
  const run = runInstruction(pay, payment.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").energy, 1);
  assert.equal(run.linked.payment.paid, true);
  assert.equal(run.linked.payment.total.energy, 1);
  assert.deepEqual(run.linked.payment.total.power, [{ amount: 1, allowedDomains: ["Fury"] }]);
  assert.deepEqual(run.events.map(event => event.action), ["pay"]);
  assert.equal(kernel.getObject("phoenix").zone, "trash");
});

test("Immortal Phoenix payment regression: an unaffordable payment fails without moving or playing", () => {
  const kernel = world().player("A", { energy: 0, power: ["Fury"] })
    .card("phoenix", { zone: "trash" }).build();
  const before = kernel.snapshot();
  const payment = program.abilities[1].body[0].args.body.value[0];
  assert.throws(() => runInstruction(pay, payment.args, { world: kernel }), { name: "CostPlanError", reason: "cannot-pay-cost" });
  assert.deepEqual(kernel.snapshot(), before);
});

test("Immortal Phoenix supported optional body: declining pays nothing and leaves Phoenix in Trash", () => {
  const kernel = world().player("A", { energy: 2, power: ["Fury"] })
    .card("phoenix", { zone: "trash" }).build();
  kernel.setAnswers({ "immortal-phoenix.may-play/optional": false });
  const outcome = resolveChainBody(program.abilities[1].body, kernel);
  assert.deepEqual(outcome.results[0].result, { status: "negated", reason: "skipped", events: [] });
  assert.equal(kernel.player("A").energy, 2);
  assert.equal(kernel.getObject("phoenix").zone, "trash");
  assert.deepEqual(outcome.events, []);
});

test.todo(
  "Immortal Phoenix Assault 2: bind the keyword's designation condition to the current combatRole " +
    "attacker characteristic before asserting the CR 807.1 Might bonus in production"
);
