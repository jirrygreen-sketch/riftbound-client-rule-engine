import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/tryndamere-barbarian.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";

const CARD_ID = "card.hash-6ba12b26451c240435ee3952db1009ed8f8cb3d1db061aef3df6e51c359883aa";

test("ogn-034-298 Tryndamere, Barbarian: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.status, "judge-required");
  // The score clause is merged; the remaining gaps are the
  // excess-damage statistic and the conquering-unit event payload.
  assert.match(program.judgeReason, /excess damage/);
  assert.match(program.judgeReason, /战斗伤害分配统计/);
  assert.doesNotMatch(program.judgeReason, /RIFT-31\/33/);
});

test("ogn-034-298 Tryndamere, Barbarian: identity, ruleset and exact source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(
    program.sourceText,
    "When I conquer after an attack, if you assigned 5 or more excess damage to enemy units, you score 1 point."
  );
});

test("ogn-034-298 Tryndamere, Barbarian: self conquer trigger whose condition counts 5+ excess damage assigned this attack", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "conquer");
  // The closed discriminant is "conquered" (EVENT_NAMES maps it to conquer);
  // source:self binds the conquering unit's actual object id.
  assert.deepEqual(ability.trigger.filter, { event: "conquered", source: "self" });
  assert.equal(ability.optional, false);

  // "if you assigned 5 or more excess damage to enemy units" immediately
  // follows the trigger condition, so it is part of the condition (383.2.a.1),
  // not an instruction in the body.
  const condition = ability.trigger.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.subject, "excess-damage-assigned-this-combat");
  assert.deepEqual(condition.left.filter, { targetController: "opponent", scope: "this-attack" });
  assert.deepEqual(condition.right, { kind: "constant", value: 5 });

  assert.equal(ability.body.length, 1);
  const [instruction] = ability.body;
  assert.equal(instruction.id, "tryndamere-barbarian.score-1");
  assert.equal(instruction.op, "effect.score");
  assert.deepEqual(instruction.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(instruction.linkedTo, undefined);
});

test("ogn-034-298 Tryndamere, Barbarian golden: the score clause gains 1 point through effect.score (470.2)", () => {
  const kernel = world().unit("tryndamere", { might: 8 }).build();
  const source = kernel.clone({ sourceSnapshot: kernel.getObject("tryndamere") });

  const outcome = runAbilityBody(program.abilities[0].body, source);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [["tryndamere-barbarian.score-1", "executed"]]
  );
  // 194.1.c / 470.1: gaining points, distinct from Battlefield Scoring.
  assert.equal(source.player("A").score, 1);
  assert.deepEqual(outcome.events.map((event) => event.action), ["score"]);
  assert.deepEqual(outcome.linkedValues["tryndamere-barbarian.score-1.scored"], [
    { player: "A", amount: 1 }
  ]);
});

test("ogn-034-298 Tryndamere, Barbarian: the conquer filter binds the actual host for either controller", () => {
  for (const controller of ["A", "B"]) {
    const kernel = world()
      .unit("tryndamere", { owner: controller, cardId: CARD_ID, might: 8 })
      .unit("other-unit", { owner: controller, might: 3 })
      .build();
    const source = kernel.getObject("tryndamere");
    const filter = translateTriggerFilter(program.abilities[0].trigger.filter, source.ref.id, "conquer");
    assert.deepEqual(filter, { event: "conquered", object: { objectId: source.ref.id } });
    assert.equal(validateTriggerSpec({ ...program.abilities[0].trigger, filter }).ok, true);
    assert.equal(matchesTriggerEvent(filter, { timingPoint: "conquer", object: source, player: controller }, controller), true);
    assert.equal(matchesTriggerEvent(filter, { timingPoint: "conquer", object: kernel.getObject("other-unit"), player: controller }, controller), false);
  }
});

test.todo(
  "ogn-034-298 Tryndamere, Barbarian: the 'assigned 5 or more excess damage' trigger condition needs " +
    "the combat-damage assignment statistic (CR 467.2.c.4) exposed on the conquer event or through " +
    "HistoryQuery, and the score payload must carry the conquering unit for the " +
    "383.4.c.2.a unit-identity binding."
);
