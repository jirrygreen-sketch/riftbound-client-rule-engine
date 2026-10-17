import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/glorious-executioner.js";

const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { getTimingPoint, isTimingPointId } = await import(new URL("events/timing-points.js", ENGINE));
const { matchesTriggerEvent } = await import(new URL("events/pipeline-match.js", ENGINE));
const { runInstruction, world } = await import(new URL("effects/testing/index.js", ENGINE));
const draw = (await import(new URL("effects/instructions/effect.draw.js", ENGINE))).default;
const { validateTriggerSpec } = await import(new URL("events/trigger-spec.js", ENGINE));
const { ProgramRegistry } = await import(new URL("programs/registry.js", ENGINE));
const { triggerRegistrations } = await import(new URL("programs/triggers.js", ENGINE));
const { fixture, settle, timings } = await import(new URL("../../../../engine-core/test/turn/helpers.mjs", import.meta.url));

const CANONICAL_ID = "card.hash-fe2db2b592e71d47e736d643538a15fe129a6cb0b7aab53bd27572177b88671b";
const SOURCE_TEXT = "When you win a combat, draw 1. (You win if only your units remain after combat.)";

const [ability] = program.abilities;
const [drawOne] = ability.body;

/** Register the ability's own trigger through the merged program adapter. */
function registrationError() {
  const { judgeReason, ...binding } = program;
  const registry = new ProgramRegistry([{ ...binding, status: "executable" }]);
  const kernel = world().unit("legend", { cardId: CANONICAL_ID, types: ["legend"] }).build();
  try {
    triggerRegistrations(registry, kernel.getObject("legend"));
    return null;
  } catch (error) {
    return error;
  }
}

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
  assert.match(program.judgeReason, /EVENT_PATTERN_TYPES/);
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

test("sfd-185-221 Glorious Executioner: the trigger names the combat-result timing point and its payload field", () => {
  // 468.3.a-468.4: the trigger's timing is the closed `combat-result` timing point,
  // whose declared payload field for the winner is `winnerId`
  // (events/timing-points.ts).
  assert.equal(isTimingPointId("combat-result"), true);
  assert.deepEqual(getTimingPoint("combat-result").ruleRefs, ["468.3.a", "468.3.b", "468.3.c", "468.3.d", "468.4"]);
  assert.equal(getTimingPoint("combat-result").payloadFields.includes("winnerId"), true);

  // The declared filter matches a combat-result event carrying winnerId "self"
  // and nothing else. "self" is a literal in `details`, so a combat you lost can
  // never match (fail-closed); the golden states what the declaration does rather
  // than claiming the placeholder is evaluated (see judgeReason item 2).
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

test("sfd-185-221 Glorious Executioner: the declared winner filter is still rejected by production trigger validation", () => {
  const result = validateTriggerSpec(ability.trigger);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(issue => issue.path.includes("event")));
  // The descriptive 'self' value is not a comparison to controller A.
  assert.equal(matchesTriggerEvent(ability.trigger.filter, {
    timingPoint: "combat-result", details: { winnerId: "A" }
  }, "A"), false);
});

test("sfd-185-221 Glorious Executioner: the merged program adapter cannot register the combat-result trigger", () => {
  // programs/triggers.ts funnels the EventPattern through
  // programs/filters.ts, which has no `details` field; the CardProgram can
  // therefore never subscribe the Draw 1 body to a real combat-result event.
  const error = registrationError();
  assert.ok(error, "the merged adapter must refuse this trigger instead of dropping the winner predicate");
  assert.equal(error.code, "judge-required");
  assert.match(error.message, /Unsupported filter field details/);
});

test("sfd-185-221 Glorious Executioner: no production path emits combat-result yet", () => {
  // 468.3.a-468.4: the step that determines the winner is exactly the step
  // CombatFlow still blocks on. Driving the real TurnFlow through a staged
  // combat shows the timing point is never emitted; the declared
  // payloadFields are not a producer.
  const f = fixture({ fields: [{ id: "bf1", controller: "B" }, { id: "bf2", controller: null }],
    setup: w => w.unit("defender", { owner: "B", location: { type: "battlefield", id: "bf1" } }) });
  f.flow.start();
  f.flow.execute(f.draft("move-to-enemy", [
    { id: "move", op: "effect.move", args: { to: { kind: "constant", value: { type: "battlefield", id: "bf1" } } } }
  ]));
  assert.throws(() => settle(f.flow), error => error.code === "combat-start-transaction");
  assert.equal(timings(f.flow).includes("combat-start"), false);
  assert.equal(timings(f.flow).includes("combat-result"), false);
  assert.deepEqual(f.flow.chain.pipeline.events.filter(event => event.timingPoint === "combat-result"), []);
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
    "payload, i.e. comparing winnerId to the ability's controller — EventPattern.details compares " +
    "literal scalars only, `player` means the acting player rather than the combat winner, and the " +
    "closed EVENT_PATTERN_TYPES discriminator list has no `combat-result` member while the timing " +
    "point itself exists (contract: align the event vocabulary with the timing-point enum)"
);

test.todo(
  "sfd-185-221 Glorious Executioner: the merged program → TriggerRegistration machinery " +
  "(programs/triggers.ts) is gated on the program status, so the trigger stays unsubscribed " +
  "while this program is judge-required"
);
