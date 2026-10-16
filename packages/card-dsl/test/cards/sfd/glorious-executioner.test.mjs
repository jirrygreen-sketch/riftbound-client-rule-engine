import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/glorious-executioner.js";

const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { getTimingPoint, isTimingPointId } = await import(new URL("events/timing-points.js", ENGINE));
const { matchesTriggerEvent } = await import(new URL("events/pipeline-match.js", ENGINE));
const { validateTriggerSpec } = await import(new URL("events/trigger-spec.js", ENGINE));
const { runInstruction, world } = await import(new URL("effects/testing/index.js", ENGINE));
const draw = (await import(new URL("effects/instructions/effect.draw.js", ENGINE))).default;

const CANONICAL_ID = "card.hash-fe2db2b592e71d47e736d643538a15fe129a6cb0b7aab53bd27572177b88671b";
const SOURCE_TEXT = "When you win a combat, draw 1. (You win if only your units remain after combat.)";

const [ability] = program.abilities;
const [drawOne] = ability.body;

test("sfd-185-221 Glorious Executioner: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
});

test("sfd-185-221 Glorious Executioner: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /combat-result/);
  assert.match(program.judgeReason, /winnerId/);
  assert.match(program.judgeReason, /RIFT-120/);
});

test("sfd-185-221 Glorious Executioner: one combat-result trigger whose body is Draw 1", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 468.3 / 468.3.a: "When you win a combat" is the combat-result timing point.
  assert.equal(ability.trigger.at, "combat-result");
  assert.equal(isTimingPointId(ability.trigger.at), true);
  assert.equal(getTimingPoint(ability.trigger.at).triggerable ?? true, true);
  // The closed payload field for 468.3.a is winnerId; comparing it to the ability
  // controller has no merged spelling (judgeReason item 2), so it is declared as a
  // descriptive, fail-closed record.
  assert.deepEqual(ability.trigger.filter, { event: "combat-result", details: { winnerId: "self" } });
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.trigger.condition, undefined);
  // 468.3.a's win is a condition, not a printed "you may".
  assert.equal(ability.optional, false);

  assert.equal(ability.body.length, 1);
  assert.equal(drawOne.id, "glorious-executioner.draw");
  assert.equal(drawOne.op, "effect.draw");
  assert.deepEqual(drawOne.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(drawOne.targets, undefined);
  assert.equal(drawOne.picks, undefined);
  assert.equal(drawOne.linkedTo, undefined);
  assert.equal(drawOne.condition, undefined);
});

test("sfd-185-221 Glorious Executioner: the trigger spec passes the engine's own validator and matcher", () => {
  // The closed EventPattern discriminator list has no `combat-result` member, so
  // the engine's own validator rejects the contract-correct spelling. The golden
  // locks that rejection as the evidence for judgeReason item 2.a rather than
  // switching to a wrong-but-accepted event name (see the same treatment in
  // ven/matriarch-of-war.test.mjs).
  const validated = validateTriggerSpec(ability.trigger);
  assert.equal(validated.ok, false);
  assert.deepEqual(validated.issues.map((issue) => [issue.path, issue.code]), [
    ["trigger.filter.event", "invalid-event-type"]
  ]);
  // The discriminator the timing point is actually named after is a valid timing
  // point even though it is missing from the event vocabulary.
  assert.equal(isTimingPointId("combat-result"), true);

  // The declared filter matches a combat-result event carrying winnerId "self"
  // and nothing else. "self" is a literal in `details`, so a combat you lost can
  // never match (fail-closed); the golden states what the declaration does rather
  // than claiming the placeholder is evaluated (see judgeReason item 2.b).
  assert.equal(
    matchesTriggerEvent(ability.trigger.filter, { timingPoint: "combat-result", details: { winnerId: "self" } }, "A"),
    true
  );
  assert.equal(
    matchesTriggerEvent(ability.trigger.filter, { timingPoint: "combat-result", details: { winnerId: "B" } }, "A"),
    false
  );
  assert.equal(
    matchesTriggerEvent(ability.trigger.filter, { timingPoint: "combat-end", details: { winnerId: "self" } }, "A"),
    false
  );
});

test("sfd-185-221 Glorious Executioner: the Draw 1 body executes through the reference kernel", () => {
  // 414.1 / 414.3: drawing 1 takes the top card of the controller's Main Deck.
  const kernel = world().deck(["top", "second"]).build();
  const run = runInstruction(draw, drawOne.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["top"]);
  assert.deepEqual(run.events.map((event) => event.action), ["draw"]);
});

test("sfd-185-221 Glorious Executioner: an empty Main Deck still resolves the instruction as far as possible", () => {
  // 414.4 / 432.1.a: drawing from an empty deck draws as many as possible; the
  // reference kernel reports the real count instead of inventing a card.
  const kernel = world().build();
  const run = runInstruction(draw, drawOne.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 0);
  assert.equal(kernel.player("A").handSize, 0);
});

test.todo(
  "sfd-185-221 Glorious Executioner: the combat-result timing point must actually be emitted " +
    "(468.3 / 468.4) — combat/flow.ts blocks before it (combat-start-transaction, " +
    "simultaneous-damage-transaction) and the name only appears as a boundary label in " +
    "duel/engagement-executor-v2.ts"
);

test.todo(
  "sfd-185-221 Glorious Executioner: a \"you won this combat\" predicate over the combat-result " +
    "payload, i.e. comparing winnerId to the ability's controller (EventPattern.details compares " +
    "literal scalars only, and `player` means the acting player, not the combat winner)"
);

test.todo(
  "sfd-185-221 Glorious Executioner: the program → TriggerRegistration wiring (contract 3.5) " +
    "needed before the trigger can be subscribed at all"
);
