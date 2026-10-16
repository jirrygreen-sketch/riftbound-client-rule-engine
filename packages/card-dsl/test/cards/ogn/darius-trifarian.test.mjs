import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/darius-trifarian.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-d60be23b23f087174848368190675a57a5a2f0d7dee4d43b85af49e18d0e2d31";
const READY_ID = "darius-trifarian.ready";

test("ogn-027-298 Darius, Trifarian: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /RIFT-261/);
});

test("ogn-027-298 Darius, Trifarian: identity, ruleset and exact source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(
    program.sourceText,
    "When you play your second card in a turn, give me +2 :rb_might: this turn and ready me."
  );
});

test("ogn-027-298 Darius, Trifarian: card-played trigger with a second-card condition and two instructions", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    filter: { player: "controller" }
  });
  assert.equal(ability.optional, false);

  // "your second card in a turn" is a condition on the trigger (383.2.a.1):
  // exactly one card already finalized by this controller this turn.
  const condition = ability.trigger.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "eq");
  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.subject, "cards-finalized-this-turn");
  assert.deepEqual(condition.left.filter, { player: "controller", exclude: "self" });
  assert.deepEqual(condition.right, { kind: "constant", value: 1 });

  assert.deepEqual(
    ability.body.map((instruction) => [instruction.id, instruction.op]),
    [
      ["darius-trifarian.might-2", "continuous.might"],
      [READY_ID, "effect.ready"]
    ]
  );
  const [might, readyInstruction] = ability.body;
  assert.equal(might.args.amount.value, 2);
  assert.equal(might.args.duration.value, "end-of-turn");
  assert.deepEqual(might.args.appliesTo, { kind: "constant", value: "self" });
  assert.equal(might.args.target, undefined);
  // "and ready me" is a separate instruction: it is not linked to the Might
  // half, so a negated Might change still readies Darius (359.3.e.14.b).
  assert.equal(readyInstruction.linkedTo, undefined);
  assert.deepEqual(readyInstruction.args, {});
  assert.equal(readyInstruction.targets, undefined);
});

test("ogn-027-298 Darius, Trifarian: 'ready me' runs through the interpreter and reference kernel", () => {
  const kernel = world().unit("darius", { exhausted: true }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("darius") });
  const outcome = runAbilityBody([program.abilities[0].body[1]], scoped);
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(scoped.getObject("darius").exhausted, false);
});

test("ogn-027-298 Darius, Trifarian: 'ready me' is a no-op when already ready (CR 416.1.c)", () => {
  const kernel = world().unit("darius", { exhausted: false }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("darius") });
  const run = runInstruction(ready, {}, { world: scoped });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.readied.count, 0);
  assert.equal(scoped.getObject("darius").exhausted, false);
});

test("ogn-027-298 Darius, Trifarian: 'ready me' against an exhausted source readies exactly that object", () => {
  const kernel = world()
    .unit("darius", { exhausted: true })
    .unit("other", { exhausted: true })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("darius") });
  const run = runInstruction(ready, {}, { world: scoped });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.readied.objects.map((ref) => ref.id), ["darius"]);
  assert.equal(scoped.getObject("darius").exhausted, false);
  assert.equal(scoped.getObject("other").exhausted, true);
});

test("ogn-027-298 Darius, Trifarian: the full body registers Might on self and readies self", () => {
  const kernel = world().unit("darius", { exhausted: true, might: 5 }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("darius") });

  const outcome = runAbilityBody(program.abilities[0].body, scoped);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => entry.result.status), ["executed", "executed"]);
  assert.equal(scoped.continuousEffects.length, 1);
  assert.equal(scoped.continuousEffects[0].effect.filter.objectId, "darius");
  assert.equal(scoped.continuousEffects[0].effect.effect.kind, "continuous.might");
  assert.equal(scoped.continuousEffects[0].effect.effect.amount, 2);
  assert.deepEqual(scoped.continuousEffects[0].duration, { type: "end-of-turn" });
  assert.equal(scoped.getObject("darius").exhausted, false);
});

test.todo(
  "ogn-027-298 Darius, Trifarian: the 'you play your second card in a turn' history count " +
    "(cards-finalized-this-turn with exclude self) still needs the history condition and " +
    "RIFT-257 CardProgram trigger binding; the Might and ready body now has execution evidence."
);
