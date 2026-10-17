import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/affectionate-poro.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-7147fd68039b666d195da6d7372d88c419ee1487989e3243510c28f11248e3f3";
const SOURCE_TEXT =
  "When a combat that I was in ends, if I haven't been dealt damage this turn, draw 1.";

const [ability] = program.abilities;
const [drawOne] = ability.body;

const poroWorld = (deck) => {
  const builder = world().unit("poro", { controller: "A", might: 3 });
  if (deck.length > 0) builder.deck(deck);
  const base = builder.build();
  return base.clone({ controller: "A", sourceSnapshot: base.getObject("poro") });
};

test("ven-024-166 Affectionate Poro: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ven-024-166 Affectionate Poro: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /combat-end/);
  assert.match(program.judgeReason, /468\.7/);
  assert.match(program.judgeReason, /combatRole/);
  assert.match(program.judgeReason, /HistoryQuery/);
});

test("ven-024-166 Affectionate Poro: one combat-end trigger filtered to self", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  // 468.7 / 468.7.b: the closed combat-end timing point carries combat-end
  // effects; EVENT_PATTERN_TYPES spells the discriminant "combat-ended".
  assert.equal(ability.trigger.at, "combat-end");
  assert.deepEqual(ability.trigger.filter, {
    event: "combat-ended",
    filter: { source: "self" }
  });
  assert.equal(ability.trigger.once, undefined);
});

test("ven-024-166 Affectionate Poro: the damage clause is a descriptive trigger condition", () => {
  // "if I haven't been dealt damage this turn" needs a turn-scoped, object-filtered
  // "if I haven't been dealt damage this turn" needs a turn-scoped, object-filtered
  // damage-event count. HistoryQuery already has objectFilter/exclude, but the
  // than being written as an always-true condition that would fire every combat.
  assert.deepEqual(ability.trigger.condition, {
    kind: "expression",
    value: { kind: "constant", value: "not-dealt-damage-this-turn" }
  });
});

test("ven-024-166 Affectionate Poro: the body is one unlinked effect.draw of exactly 1", () => {
  assert.deepEqual(ability.body.map((instruction) => instruction.id), ["affectionate-poro.draw-1"]);
  assert.equal(drawOne.op, "effect.draw");
  assert.deepEqual(drawOne.args.amount, { kind: "constant", value: 1 });
  assert.equal(drawOne.targets, undefined);
  assert.equal(drawOne.picks, undefined);
  assert.equal(drawOne.linkedTo, undefined);
  assert.equal(drawOne.condition, undefined);
});

test("ven-024-166 Affectionate Poro: the strict trigger validator rejects the unmerged discriminant", () => {
  // events/trigger-spec.ts has no combat-end discriminant (it spells the event
  // "combat-ended"), and the timing point itself has no emitter in the merged
  // combat pipeline; the golden records that instead of registering a fake spec.
  const validation = validateTriggerSpec({
    at: "combat-end",
    filter: { event: "combat-ended", filter: { source: "self" } }
  });
  assert.equal(validation.ok, false);
  const codes = new Set(validation.issues.map((issue) => issue.code));
  assert.ok(codes.size > 0, JSON.stringify([...codes]));
});

test("ven-024-166 golden: the trigger body really draws 1 through the interpreter", () => {
  const kernel = poroWorld(["top-card", "second-card"]);
  const outcome = resolveChainBody(ability.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["affectionate-poro.draw-1", "executed"]
  ]);
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.equal(outcome.linkedValues["affectionate-poro.draw-1.drawn"], 1);
});

test("ven-024-166 golden: an empty deck draws nothing and does not invent a card", () => {
  const kernel = poroWorld([]);
  const outcome = resolveChainBody(ability.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("A").handSize, 0);
  assert.equal(outcome.linkedValues["affectionate-poro.draw-1.drawn"], 0);
});

test.todo(
  "ven-024-166 Affectionate Poro: 'a combat that I was in' needs the Attacker/Defender " +
    "designation (CR 323.2 / 466.2.c.3 / 468.7.a) — contract 3.8's ObjectSnapshot.combatRole " +
    "is not in engine-core's effects/contract.ts yet"
);

test.todo(
  "ven-024-166 Affectionate Poro: the combat-end timing point has no emitter, so the trigger never " +
    "reaches the chain (CR 468.7.b, RIFT-120 and the engine batch 4–5 combat transaction)"
);

test.todo(
  "ven-024-166 Affectionate Poro: 'if I haven't been dealt damage this turn' needs a turn-scoped " +
    "damage-event predicate (HistoryQuery already has objectFilter/exclude, but card-side " +
    "Condition/Requirement cannot express history count predicates)"
);
