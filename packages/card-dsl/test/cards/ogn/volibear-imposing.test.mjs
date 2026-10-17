import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/volibear-imposing.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-b57666e4f1117003af3567a39c4c880bafc5ff8b149545385d26dfe3ad0db3c4";

const [shield, tank, moveTrigger] = program.abilities;
const drawInstruction = moveTrigger.body[0];

test("ogn-158-298 Volibear, Imposing: program validates and keeps identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "[Shield 3] (+3 :rb_might: while I'm a defender.)\n" +
      "[Tank] (I must be assigned combat damage first.)\n" +
      "When an opponent moves to a battlefield other than mine, draw 1. (Bases are not battlefield.)"
  );
});

test("ogn-158-298 Volibear, Imposing: judgeReason cites Tank, the move timing and the location comparison", () => {
  assert.match(program.judgeReason, /Tank/);
  assert.match(program.judgeReason, /815/);
  assert.match(program.judgeReason, /object-moved/);
  assert.match(program.judgeReason, /base-combat-allocation/);
});

test("ogn-158-298 Volibear, Imposing: Shield 3 and Tank stay keyword declarations", () => {
  assert.equal(program.abilities.length, 3);
  assert.deepEqual(shield, { kind: "keyword", keyword: "shield", value: 3 });
  assert.deepEqual(tank, { kind: "keyword", keyword: "tank" });
  assert.equal(program.abilities.filter(ability => ability.kind === "static").length, 0);
});

test("ogn-158-298 Volibear, Imposing: the move trigger draws 1 and marks the missing location comparison", () => {
  assert.equal(moveTrigger.kind, "triggered");
  assert.equal(moveTrigger.trigger.at, "object-moved");
  assert.deepEqual(moveTrigger.trigger.filter, {
    event: "object-moved",
    filter: { type: "unit", controller: "opponent", movedToOtherThanSourceLocation: true }
  });
  assert.equal(moveTrigger.trigger.once, undefined);
  assert.equal(moveTrigger.optional, false);
  assert.equal(moveTrigger.body.length, 1);
  assert.equal(drawInstruction.id, "volibear.draw-1");
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(drawInstruction.targets, undefined);
  assert.equal(drawInstruction.picks, undefined);
});

test("ogn-158-298 Volibear, Imposing: the draw body executes through the merged effect.draw primitive (414.3)", () => {
  const kernel = world().deck(["c1", "c2"]).build();
  const run = runInstruction(draw, drawInstruction.args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.result.linkedValues.drawn, 1);
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
});

test("ogn-158-298 Volibear, Imposing: the merged Tank KeywordDef expands, but its static effect has no consumer (815)", () => {
  // RIFT-264 merged the Tank KeywordDef; the card still stays judge-required
  // because its expansion (static continuous.combat) is blocked: the layer
  // engine has no branch for that kind and the combat damage assignment binds
  // no priority requirement (combat/base-combat-allocation.ts).
  assert.equal(keywordDefinitionsById.has("Tank"), true);
  const tankDef = keywordDefinitionsById.get("Tank");
  assert.equal(tankDef.valued, false);
  assert.equal(tankDef.stacking, "single");
  const [tankExpansion] = tankDef.expand({ host: { canonicalCardId: CANONICAL } });
  assert.equal(tankExpansion.kind, "static");
  assert.equal(tankExpansion.effect.kind, "continuous.combat");

  assert.equal(keywordDefinitionsById.has("Shield"), true);
  const shieldDef = keywordDefinitionsById.get("Shield");
  assert.equal(shieldDef.valued, true);
  assert.equal(shieldDef.stacking, "sum");
  const [expanded] = shieldDef.expand({ value: 3, host: { canonicalCardId: CANONICAL } });
  assert.deepEqual(expanded.effect.amount, { kind: "constant", value: 3 });
  assert.equal(expanded.effect.kind, "continuous.might");
  assert.deepEqual(expanded.condition.right, { kind: "constant", value: "defender" });
});

test.todo(
  "ogn-158-298 Volibear, Imposing: [Tank] (CR v1.5 815) has its KeywordDef (RIFT-264), but the " +
    "static continuous.combat expansion needs a layer/combat consumer and the damage assignment must " +
    "enforce its priority; combat/base-combat-allocation.ts currently binds no assignment-priority " +
    "requirement and continuous.combat is blocked in effects/instructions."
);
test.todo(
  "ogn-158-298 Volibear, Imposing: 'When an opponent moves to a battlefield other than mine, draw 1.' " +
    "needs the movement flow to emit object-moved (CR v1.5 421.1/449.1; events/action-adapter.ts already " +
    "derives it from move-location, but zones/movement does not wire into the pipeline) and a " +
    "trigger-condition form that compares the event's destination against the source's current location."
);
test.todo(
  "ogn-158-298 Volibear, Imposing: the card's triggered abilities need the CardProgram -> " +
    "TriggerRegistration binding (RIFT-257); events/pipeline.registerTrigger is only called by trusted " +
    "kernel adapters today."
);
