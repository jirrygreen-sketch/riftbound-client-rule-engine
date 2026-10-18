import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/volibear-imposing.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { getTimingPoint } from "../../../../engine-core/dist/events/timing-points.js";
import { assertTriggerSpec, validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { createDuelBoard, placeDuelUnit, selectDuelBattlefields } from "../../../../engine-core/dist/duel/battlefields.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import { moveDuelUnitsStandard } from "../../../../engine-core/dist/zones/movement.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { evaluateExtendedExpression } from "../../../../engine-core/dist/effects/interpreter/expr-ext/index.js";

const CANONICAL = "card.hash-b57666e4f1117003af3567a39c4c880bafc5ff8b149545385d26dfe3ad0db3c4";

const [shield, tank, moveTrigger] = program.abilities;
const drawInstruction = moveTrigger.body[0];

/** Two-player board with one unit on one of the shared battlefields. */
function duelBoard(unitId, controller) {
  const seats = ["A", "B"].map(playerId => ({
    playerId,
    battlefields: [1, 2, 3].map(index => ({ instanceId: `${playerId}-${index}`, cardId: `field-${index}` }))
  }));
  const empty = createDuelBoard(selectDuelBattlefields(seats, () => 0));
  const [origin, destination] = empty.battlefields.map(field => field.locationId);
  const board = placeDuelUnit(empty, { objectId: unitId, controllerPlayerId: controller, locationId: origin });
  return { board, origin, destination };
}

test("ogn-158-298 Volibear, Imposing: program validates and keeps identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
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

test("ogn-158-298 Volibear, Imposing: judgeReason names the current keyword and movement gaps", () => {
  // Re-verified 2026-10-17: every named gap is a still-current dependency.
  assert.match(program.judgeReason, /Tank/);
  assert.match(program.judgeReason, /815/);
  assert.match(program.judgeReason, /object-moved/);
  assert.match(program.judgeReason, /base-combat-allocation/);
  assert.match(program.judgeReason, /Shield/);
  assert.match(program.judgeReason, /814\.1\.c/);
  assert.match(program.judgeReason, /designation/);
  assert.match(program.judgeReason, /combatRole/);
  assert.match(program.judgeReason, /evaluateCondition/);
  assert.match(program.judgeReason, /movedToOtherThanSourceLocation/);
  assert.match(program.judgeReason, /EVENT_PATTERN_TYPES/);
  assert.match(program.judgeReason, /requiresMoveTriggers/);
  assert.match(program.judgeReason, /standard-move-executor-v2/);
  assert.match(program.judgeReason, /cardplay-unit-v2/);
  assert.match(program.judgeReason, /toLocationId/);
  assert.match(program.judgeReason, /458\.1/);
  // RIFT-257 (program binding) and RIFT-359 (condition predicates) are merged
  // and must not be reported as current gaps anymore.
  assert.doesNotMatch(program.judgeReason, /RIFT-257|RIFT-264|RIFT-359/);
});

test("ogn-158-298 Volibear, Imposing: the merged designation extension reads the actual Shield host's combatRole", () => {
  const [expanded] = keywordDefinitionsById.get("Shield").expand({ value: shield.value, host: { canonicalCardId: CANONICAL } });
  for (const controller of ["A", "B"]) {
    for (const combatRole of ["defender", "attacker", null]) {
      const base = world().unit("volibear", { owner: controller, combatRole, might: 10 }).build();
      const kernel = base.clone({ controller, sourceSnapshot: base.getObject("volibear") });
      const actual = evaluateExtendedExpression(expanded.condition.left, {
        context: kernel, host: kernel.ref("volibear"), linked: key => kernel.linked(key),
        canLookBack: () => true, isIgnored: () => false
      });
      assert.equal(actual, combatRole);
      assert.equal(actual === expanded.condition.right.value, combatRole === "defender");
    }
  }
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
  assert.deepEqual(run.events.map(event => event.action), ["draw"]);
});

test("ogn-158-298 Volibear, Imposing: the original draw body draws the top card for either controller", () => {
  for (const controller of ["A", "B"]) {
    const opponent = controller === "A" ? "B" : "A";
    const kernel = world()
      .unit("volibear", { cardId: CANONICAL, owner: controller, might: 10 })
      .deck(["top", "second"], { owner: controller })
      .deck("opponent-top", { owner: opponent })
      .build();
    const scoped = kernel.clone({ controller, sourceSnapshot: kernel.getObject("volibear") });

    const outcome = resolveChainBody(moveTrigger.body, scoped);

    assert.equal(outcome.status, "executed");
    assert.equal(outcome.results.length, 1);
    assert.equal(outcome.results[0].id, drawInstruction.id);
    assert.equal(outcome.results[0].result.status, "executed");
    assert.equal(outcome.linkedValues["volibear.draw-1.drawn"], 1);
    assert.equal(outcome.linkedValues["volibear.draw-1.drawnTo"], controller);
    assert.deepEqual(outcome.events.map(event => event.action), ["draw"]);
    assert.equal(scoped.getObject("top").zone, "hand");
    assert.equal(scoped.getObject("second").zone, "deck");
    assert.equal(scoped.player(controller).handSize, 1);
    assert.equal(scoped.player(controller).deckSize, 1);
    assert.equal(scoped.player(opponent).handSize, 0);
    assert.equal(scoped.player(opponent).deckSize, 1);
  }
});

test("ogn-158-298 Volibear, Imposing: committed move-location emits object-moved with the opponent's destination", () => {
  const f = fixture({ cards: [{ id: "mover", owner: "B", types: ["unit"], might: 2 }] });
  f.engine.commit({
    type: "move-zone",
    object: f.kernel.ref("mover"),
    to: "board",
    location: { type: "base", player: "B" }
  });
  f.engine.advance();
  const ref = f.kernel.ref("mover");
  const destination = { type: "battlefield", id: "battlefield-2" };

  const outcome = f.engine.commit({ type: "move-location", object: ref, to: destination });

  assert.equal(outcome.status, "done");
  assert.deepEqual(f.kernel.getObject("mover").location, destination);
  assert.deepEqual(f.kernel.ref("mover"), ref);
  const events = f.engine.pipeline.events.filter(event => event.timingPoint === moveTrigger.trigger.at);
  assert.equal(events.length, 1);
  assert.equal(events[0].object.ref.id, "mover");
  assert.equal(events[0].object.controller, "B");
  assert.equal(events[0].player, "B");
  assert.deepEqual(events[0].object.location, destination);
});

test("ogn-158-298 Volibear, Imposing boundary: object-moved is missing from the closed event vocabulary and the declared movement payload (449.2/458.1)", () => {
  // 383.1/449.2: the trigger needs the object-moved timing point plus its origin
  // and destination identity. The closed EVENT_PATTERN_TYPES list ends at
  // final-point, so assertTriggerSpec rejects the trigger before registration,
  // and the committed-emission fields declared in timing-points.ts are absent.
  const timing = getTimingPoint("object-moved");
  for (const field of ["fromKind", "fromLocationId", "toKind", "toLocationId"]) {
    assert.ok(timing.payloadFields.includes(field), field);
  }
  const validation = validateTriggerSpec({
    at: "object-moved",
    filter: { event: "object-moved", object: { objectId: "mover" } }
  });
  assert.equal(validation.ok, false);
  assert.deepEqual(
    validation.issues.map(issue => [issue.path, issue.code]),
    [["trigger.filter.event", "invalid-event-type"]]
  );
  assert.throws(
    () => assertTriggerSpec({ at: "object-moved", filter: { event: "object-moved", object: { objectId: "mover" } } }),
    error => error.name === "TriggerSpecValidationError" &&
      error.issues.some(issue => issue.code === "invalid-event-type" && issue.path === "trigger.filter.event")
  );

  // A real committed move-location emits the timing point but the emission
  // carries only the post-move snapshot, never the declared movement payload.
  const f = fixture({ cards: [{ id: "mover", owner: "B", types: ["unit"], might: 2 }] });
  f.engine.commit({
    type: "move-zone",
    object: f.kernel.ref("mover"),
    to: "board",
    location: { type: "base", player: "B" }
  });
  f.engine.advance();
  const emitted = f.engine.pipeline.events.filter(event => event.timingPoint === "object-moved");
  assert.equal(emitted.length, 0);
  f.engine.commit({ type: "move-location", object: f.kernel.ref("mover"), to: { type: "battlefield", id: "battlefield-2" } });
  const move = f.engine.pipeline.events.filter(event => event.timingPoint === "object-moved");
  assert.equal(move.length, 1);
  for (const field of ["fromKind", "fromLocationId", "toKind", "toLocationId", "details"]) {
    assert.equal(move[0][field], undefined, field);
  }

  // The placeholder comparator is rejected by the production filter translator
  // before assertTriggerSpec is even reached.
  const source = world()
    .object("volibear", { cardId: CANONICAL, types: ["unit"], controller: "B", owner: "B", might: 10 })
    .build()
    .getObject("volibear");
  assert.throws(
    () => triggerRegistrations(
      new ProgramRegistry([{ ...program, status: "executable", judgeReason: undefined }]),
      source
    ),
    error => error.name === "ProgramBindingError" && /Unsupported filter field movedToOtherThanSourceLocation/.test(error.message)
  );
});

test("ogn-158-298 Volibear, Imposing boundary: production Standard Move never publishes object-moved to the pipeline (449.1/449.2)", () => {
  // zones/movement.ts performs the Move, and duel/standard-move-executor-v2.ts
  // hands the group to a trigger handler, but neither touches the EventPipeline;
  // only a directly committed move-location reaches events/action-adapter.ts.
  const f = fixture({ cards: [{ id: "mover", owner: "B", controller: "B", types: ["unit"], might: 2 }] });
  const before = f.engine.pipeline.events.length;

  const { board, origin, destination } = duelBoard("mover", "B");
  const moved = moveDuelUnitsStandard(
    board,
    [{ objectId: "mover", readied: true, hasGanking: true }],
    {
      actor: "B",
      unitUIDs: ["mover"],
      destinationLocationId: destination,
      timing: { phase: "main", stateOpen: true, turnPlayerId: "B", priorityPlayerId: "B" }
    }
  );
  assert.equal(moved.group.requiresMoveTriggers, true);
  assert.deepEqual(moved.group.events, [
    { objectId: "mover", actor: "B", fromLocationId: origin, toLocationId: destination }
  ]);
  // The Standard Move path returns the obligation instead of emitting; the
  // host pipeline (and therefore this CardProgram's trigger) sees nothing.
  assert.equal(f.engine.pipeline.events.length, before);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "object-moved").length, 0);
});

test("ogn-158-298 Volibear, Imposing: Tank and Shield expand through the registered KeywordDefs (815/814)", () => {
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

test("ogn-158-298 Volibear, Imposing: movement timing declares origin, destination and cause (421/449)", () => {
  const timing = getTimingPoint(moveTrigger.trigger.at);
  assert.equal(timing.id, "object-moved");
  assert.equal(timing.payloadType, "movement");
  for (const field of ["controllerId", "fromKind", "fromLocationId", "toKind", "toLocationId", "cause"]) {
    assert.ok(timing.payloadFields.includes(field), field);
  }
});

test("ogn-158-298 Volibear, Imposing: committed moves capture controller and each destination; entering a zone is distinct (448.2/449.2)", () => {
  for (const controller of ["A", "B"]) {
    const owner = controller === "A" ? "B" : "A";
    const f = fixture({ cards: [{ id: "mover", owner, controller, types: ["unit"], might: 2 }] });
    const base = { type: "base", player: controller };
    const battlefield = { type: "battlefield", id: "battlefield-2" };
    assert.equal(f.engine.commit({ type: "move-zone", object: f.kernel.ref("mover"), to: "board", location: base }).status, "done");
    f.engine.advance();
    assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === moveTrigger.trigger.at).length, 0);
    const ref = f.kernel.ref("mover");

    assert.equal(f.engine.commit({ type: "move-location", object: ref, to: battlefield }).status, "done");
    assert.equal(f.engine.commit({ type: "move-location", object: ref, to: base }).status, "done");

    const events = f.engine.pipeline.events.filter(event => event.timingPoint === moveTrigger.trigger.at);
    assert.equal(events.length, 2);
    assert.deepEqual(events.map(event => event.object.location), [battlefield, base]);
    for (const event of events) {
      assert.deepEqual(event.object.ref, ref);
      assert.equal(event.object.controller, controller);
      assert.equal(event.object.owner, owner);
      assert.equal(event.player, controller);
      assert.equal(event.object.zone, "board");
    }
    assert.deepEqual(f.kernel.getObject("mover").location, base);
    assert.deepEqual(f.kernel.ref("mover"), ref);
  }
});

test.todo(
  "ogn-158-298 Volibear, Imposing: [Tank] needs continuous.combat's damage-assignment/priority:first " +
    "to require lethal damage before non-Tank allies (CR v1.5 815.1.b/815.1.c.2); " +
    "combat/base-combat-allocation.ts does not consume that priority."
);
test.todo(
  "ogn-158-298 Volibear, Imposing: 'When an opponent moves to a battlefield other than mine, draw 1.' " +
    "needs object-moved in the closed EVENT_PATTERN_TYPES vocabulary, movement payload fields on the real emission, " +
    "a destination-vs-source-location comparison predicate, and the production Standard Move " +
    "(duel/standard-move-executor-v2.ts -> duel/cardplay-unit-v2.ts) publishing the timing wave " +
    "(CR v1.5 383.1/421.1/449.1/449.2); bases and Recall (458.1) must not trigger it."
);
test.todo(
  "ogn-158-298 Volibear, Imposing: [Shield 3] must add 3 Might only while defending (CR v1.5 " +
    "814.1.c/814.1.d.1); keywords/Shield.ts reads designation, ObjectSnapshot exposes only " +
    "combatRole; the merged designation extension must reach the production programs/statics " +
    "condition evaluator and the atomic combat-role producer must be connected."
);
