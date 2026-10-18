import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/forsaken-baccai.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { registerProgramTriggers, triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CARD_ID =
  "card.hash-6f947454591d22ba8b13d37e0096d52966b2aa026047f0a31cb9dd1d80addb64";
const SOURCE_TEXT =
  "If you control fewer runes than an opponent at the start of your Beginning Phase, give me " +
  "+1 :rb_might: this turn.";

const [ability] = program.abilities;
const [grant] = ability.body;

/** The program as the production registry sees it (status still judge-required). */
const executableView = { ...program, status: "executable", judgeReason: undefined };

/**
 * The reference kernel compares filter values literally while the IR uses the
 * contract 3.6 symbolic selectors "self"/"opponent"; the execution cases bind
 * that one symbol to real player ids. They prove the comparison primitives only;
 * production testTrigger wiring and relative-player normalisation stay missing
 * (see judgeReason and the evidence cases).
 */
function substitutePlayers(value, playerId, opponentId) {
  if (Array.isArray(value)) return value.map(item => substitutePlayers(item, playerId, opponentId));
  if (value === null || typeof value !== "object") {
    if (value === "self") return playerId;
    if (value === "opponent") return opponentId;
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, substitutePlayers(item, playerId, opponentId)])
  );
}

/** 133.5.a.1 / 431.1: only runes in the Rune Zone are controlled. */
function runeDeck(player, total) {
  return Array.from({ length: total }, (_, index) => `${player}-rune-${index + 1}`);
}

/** Build each player's Rune Deck, then channel the requested count (431.1). */
function runeZoneWorld({ aRuneDeck, aChanneled, bRuneDeck, bChanneled }) {
  const kernel = world()
    .rune(runeDeck("A", aRuneDeck), { owner: "A" })
    .rune(runeDeck("B", bRuneDeck), { owner: "B" })
    .build();
  for (const [player, amount] of [["A", aChanneled], ["B", bChanneled]]) {
    if (amount > 0) {
      assert.equal(kernel.perform({ type: "channel-rune", player, amount }).status, "done");
    }
  }
  return kernel;
}

/** Evaluate the trigger condition through the real interpreter. */
function evaluateCondition(condition, kernel) {
  const outcome = resolveChainBody(
    [
      {
        id: "gate",
        op: "condition.predicate",
        args: { condition: { kind: "constant", value: condition } }
      }
    ],
    kernel
  );
  assert.equal(outcome.status, "executed");
  return outcome.results[0].result.linkedValues.value;
}

test("ven-005-166 Forsaken Baccai: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ven-005-166 Forsaken Baccai: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /exists|存在/);
  assert.match(program.judgeReason, /beginning-start/);
  assert.match(program.judgeReason, /TriggerSpecValidationError/);
  assert.match(program.judgeReason, /EVENT_PATTERN_TYPES/);
  assert.match(program.judgeReason, /matchesTriggerEvent/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ven-005-166 Forsaken Baccai: beginning-start trigger with the rune-count condition (383.2.a.1)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 315.2.a.1: the Beginning Step's start settles game effects; "your" is the
  // ability controller's turn.
  assert.equal(ability.trigger.at, "beginning-start");
  assert.deepEqual(ability.trigger.filter, { event: "beginning-start", player: "self" });
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.optional, false);

  // 383.2.a.1: "If you control fewer runes than an opponent" is the trigger condition.
  const condition = ability.trigger.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "lt");
  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.subject, "runes");
  assert.deepEqual(condition.left.filter, { type: "rune", controller: "self", zone: "rune-zone" });
  assert.equal(condition.right.kind, "count");
  assert.deepEqual(condition.right.filter, {
    type: "rune",
    controller: "opponent",
    zone: "rune-zone"
  });
});

test("ven-005-166 Forsaken Baccai: '+1 Might this turn' is a temporary arithmetic-layer modification", () => {
  assert.equal(grant.op, "continuous.might");
  // 143.2.a / 475-477: the Might change settles in the arithmetic layer this turn.
  assert.deepEqual(grant.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(grant.args.duration, { kind: "constant", value: "end-of-turn" });
  // 053.1 / 355.10.g: "me" is the ability host, not a target.
  assert.deepEqual(grant.args.objects, { kind: "constant", value: { kind: "source" } });
  assert.equal(grant.targets, undefined);
  assert.equal(grant.picks, undefined);
  assert.equal(grant.linkedTo, undefined);
  // 702/703: never a Buff counter.
  assert.notEqual(grant.op, "effect.buff");
});

test("ven-005-166 Forsaken Baccai golden: the fewer-runes condition really evaluates (133.5.a.1 / 431.1)", () => {
  const condition = substitutePlayers(ability.trigger.condition, "A", "B");

  // Two own runes against three: "fewer runes than an opponent" holds.
  const behind = runeZoneWorld({ aRuneDeck: 2, aChanneled: 2, bRuneDeck: 3, bChanneled: 3 });
  assert.equal(evaluateCondition(condition, behind), true);
  assert.equal(behind.query({ type: "rune", controller: "A", zone: "rune-zone" }).length, 2);
  assert.equal(behind.query({ type: "rune", controller: "B", zone: "rune-zone" }).length, 3);

  // Both at two: a tie is not "fewer".
  const tied = runeZoneWorld({ aRuneDeck: 2, aChanneled: 2, bRuneDeck: 2, bChanneled: 2 });
  assert.equal(evaluateCondition(condition, tied), false);
});

test("ven-005-166 Forsaken Baccai golden: runes still in the Rune Deck are not 'controlled' (431.1)", () => {
  const condition = substitutePlayers(ability.trigger.condition, "A", "B");
  // Three own runes stay in the Rune Deck (none channeled): the Rune Zone is
  // empty while the opponent has one, so the condition still holds.
  const unchanneled = runeZoneWorld({ aRuneDeck: 3, aChanneled: 0, bRuneDeck: 1, bChanneled: 1 });
  assert.equal(unchanneled.query({ type: "rune", controller: "A", zone: "rune-zone" }).length, 0);
  assert.equal(evaluateCondition(condition, unchanneled), true);
});

test("ven-005-166 Forsaken Baccai golden: the body registers +1 Might on its host until turn end", () => {
  // The reference kernel uses the source snapshot to anchor { kind: source }.
  const sourceWorld = world().unit("baccai", { controller: "A", owner: "A", might: 2 }).build();
  const context = sourceWorld.clone({ sourceSnapshot: sourceWorld.getObject("baccai") });
  const outcome = resolveChainBody([grant], context);
  assert.equal(outcome.status, "executed");
  assert.equal(context.continuousEffects.length, 1);
  assert.equal(context.continuousEffects[0].effect.effect.kind, "continuous.might");
  assert.equal(context.continuousEffects[0].effect.effect.amount, 1);
  assert.deepEqual(context.continuousEffects[0].duration, { type: "end-of-turn" });
});

/** 2026-10-18 negative evidence: trigger vocabulary and relative-player binding. */
test("ven-005-166 Forsaken Baccai evidence: the authored beginning-start filter is rejected by the trigger vocabulary", () => {
  const registry = new ProgramRegistry([executableView]);
  const f = fixture({ cards: [{ id: "baccai", cardId: CARD_ID, types: ["unit"], might: 2 }] });
  const registrations = triggerRegistrations(registry, f.kernel.getObject("baccai"));
  assert.deepEqual(
    registrations.map(registration => [registration.spec.at, registration.spec.filter]),
    [["beginning-start", { event: "beginning-start", player: "self" }]]
  );
  // 315.2.a.1: beginning-start is a timing point id, and the EventPattern
  // vocabulary only accepts event class names, so the production registration
  // cannot subscribe this card.
  assert.throws(
    () => registerProgramTriggers(registry, f.engine, f.kernel.getObject("baccai")),
    /trigger\.filter\.event/
  );
  // An empty filter would register, but it also subscribes to the opponent's
  // Beginning Phase, losing the "your" limitation.
  assert.equal(matchesTriggerEvent({}, { timingPoint: "beginning-start", player: "B" }, "A"), true);
});

test("ven-005-166 Forsaken Baccai evidence: symbolic self/opponent rune counts need an absolute player binding", () => {
  // 383.2.a.1 / 133.5.a.1 / 431.1: the trigger condition goes through the kernel
  // test() path, where the symbolic selectors are never normalised.
  const authored = substitutePlayers(ability.trigger.condition, "self", "opponent");
  const kernel = runeZoneWorld({ aRuneDeck: 1, aChanneled: 1, bRuneDeck: 2, bChanneled: 2 });
  assert.equal(kernel.test(authored), false, "symbolic self/opponent never match literal player ids");
  assert.equal(kernel.test(substitutePlayers(ability.trigger.condition, "A", "B")), true, "an absolute binding satisfies the same gate");
});

test.todo(
  "ven-005-166 Forsaken Baccai: 'fewer runes than an opponent' in modes with three or more players " +
    "needs an existential quantifier over opponents; Condition/Expr can only compare two count " +
    "expressions, so the program records the two-player comparison (contract change request)"
);

test.todo(
  "ven-005-166 Forsaken Baccai: beginning-start trigger registration needs the authored " +
    "{ event: beginning-start } spelling accepted by EVENT_PATTERN_TYPES plus source-relative " +
    "self/opponent rune count binding in the trigger condition path (383.2.a.1)"
);

