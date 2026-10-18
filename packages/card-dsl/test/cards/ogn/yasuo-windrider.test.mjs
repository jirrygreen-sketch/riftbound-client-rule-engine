import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/yasuo-windrider.js";
import ganking from "../../../../engine-core/dist/effects/keywords/Ganking.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { registerProgramTriggers } from "../../../../engine-core/dist/programs/triggers.js";
import { ContinuousEffectRegistry } from "../../../../engine-core/dist/layers/duration.js";
import { movement as queryMovement } from "../../../../engine-core/dist/layers/rules/query.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-03848f0e530587876003913478c758509f6b05e8b89b33575cb4fd9da70f9cf1";
const SOURCE_TEXT =
  "[Ganking] (I can move from battlefield to battlefield.)\n" +
  "The third time I move in a turn, you score 1 point.";
const literal = value => ({ kind: "constant", value });

const [keyword, triggered] = program.abilities;
const [scoreInstruction] = triggered.body;

/** Yasuo on battlefield bf-1; effect.move actions relocating him are real Moves. */
function yasuoWorld() {
  const kernel = world().unit("yasuo", { location: { type: "battlefield", id: "bf-1" } }).build();
  return kernel.clone({
    source: kernel.ref("yasuo"),
    sourceSnapshot: kernel.getObject("yasuo")
  });
}

function moveYasuo(kernel, destination) {
  return runInstruction(
    move,
    { objects: literal({ target: "yasuo" }), to: literal({ type: "battlefield", id: destination }) },
    { world: kernel, targets: { yasuo: [kernel.ref("yasuo")] } }
  );
}

/** Real ChainEngine on the reference kernel, used for binding/rule-query probes. */
function yasuoEngine() {
  const kernel = world()
    .unit("yasuo", { cardId: CANONICAL, might: 4, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => { throw new Error(`unexpected choice ${request.id}`); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint })
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  return { kernel, engine };
}

test("ogn-205-298 Yasuo, Windrider: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /effect\.score/);
  assert.match(program.judgeReason, /470\.2/);
  // The pipeline already evaluates event predicates; the missing history
  // predicate must distinguish this turn's real Moves and simultaneous hits.
  assert.match(program.judgeReason, /EVENT_PATTERN_TYPES/);
  assert.match(program.judgeReason, /invalid-event-type/);
  assert.match(program.judgeReason, /condition\.history/);
  assert.match(program.judgeReason, /testTrigger/);
  assert.match(program.judgeReason, /Recall/);
  assert.match(program.judgeReason, /383\.1\.b/);
  assert.doesNotMatch(program.judgeReason, /RIFT-359/);
  assert.match(program.judgeReason, /Ganking/);
  assert.match(program.judgeReason, /The third time I move in a turn/);
  // The movement consumer exists; the remaining gaps are production assembly
  // (rules context + permission normalization) and the server's trusted
  // Ganking evaluator rejecting this card. RIFT-347 is merged, so the reason
  // must not present it as an outstanding dependency.
  assert.doesNotMatch(program.judgeReason, /RIFT-347/);
  assert.match(program.judgeReason, /canGank/);
  assert.match(program.judgeReason, /DuelMovementRuleContext/);
  assert.match(program.judgeReason, /standard-move-executor-v2/);
  assert.match(program.judgeReason, /authoritative-runtime-p4/);
  assert.match(program.judgeReason, /permission\.routes/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ogn-205-298 Yasuo, Windrider golden: Move history is specific to this object and excludes zone transitions", () => {
  const base = world()
    .unit("yasuo", { might: 4, location: { type: "battlefield", id: "bf-1" } })
    .unit("other-unit", { might: 3, location: { type: "battlefield", id: "bf-1" } })
    .hand("arrival", { types: ["unit"], might: 2 })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("yasuo") });
  assert.equal(kernel.perform({ type: "move-zone", object: kernel.ref("arrival"), to: "battlefield", location: { type: "battlefield", id: "bf-2" } }).status, "done");
  assert.equal(kernel.perform({ type: "move-location", object: kernel.ref("other-unit"), to: { type: "battlefield", id: "bf-2" } }).status, "done");
  for (const destination of ["bf-2", "bf-1", "bf-2"]) assert.equal(moveYasuo(kernel, destination).result.status, "executed");
  const outcome = runAbilityBody([{
    id: "yasuo-history", op: "condition.history",
    args: { query: literal({ action: "move-location", object: kernel.ref("yasuo"), scope: "turn" }), operator: literal("eq"), right: literal(3) }
  }], kernel);
  assert.equal(outcome.results[0].result.status, "executed");
  assert.deepEqual(outcome.results[0].result.linkedValues, { count: 3, value: true });
  assert.equal(kernel.history({ action: "move-location" }), 4);
  assert.equal(kernel.player("A").score, 0);
});

test("ogn-205-298 Yasuo, Windrider: Ganking keyword plus a third-move trigger that scores 1 point", () => {
  assert.equal(program.abilities.length, 2);
  // CR 810: Ganking is a passive ability keyword; the card only names it
  // (contract §5), the expansion lives in effects/keywords/Ganking.ts.
  assert.deepEqual(keyword, { kind: "keyword", keyword: "ganking" });
  assert.equal(keyword.value, undefined);

  assert.equal(triggered.kind, "triggered");
  // CR 383.1.b / 383.2.a: "the [Nth] time" is the trigger condition; 449.1
  // defines the Move that the object-moved timing point reports.
  assert.equal(triggered.trigger.at, "object-moved");
  assert.deepEqual(triggered.trigger.filter, { event: "object-moved", source: "self" });
  assert.equal(triggered.optional, false);
  assert.equal(triggered.trigger.once, undefined);

  // "The third time I move in a turn": count this object's Moves this turn.
  const condition = triggered.trigger.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "eq");
  assert.deepEqual(condition.right, literal(3));
  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.subject, "self-moves-this-turn");
  assert.deepEqual(condition.left.filter, {
    object: "self",
    action: "move-location",
    scope: "turn"
  });

  assert.equal(triggered.body.length, 1);
  // CR 470.2: card text "score X points" means Gaining Points, not the
  // battlefield Scoring process.
  assert.equal(scoreInstruction.id, "yasuo-windrider.score-1");
  assert.equal(scoreInstruction.op, "effect.score");
  assert.deepEqual(scoreInstruction.args.amount, literal(1));
  assert.equal(scoreInstruction.targets, undefined);
  assert.equal(scoreInstruction.picks, undefined);
  assert.equal(scoreInstruction.linkedTo, undefined);
  assert.equal(scoreInstruction.condition, undefined);
});

test("ogn-205-298 Yasuo, Windrider: the granted Ganking id matches the registered definition", () => {
  const definition = keywordDefinitionsById.get("Ganking");
  assert.ok(definition);
  assert.equal(definition, ganking);
  // 810.2: multiple Ganking instances are redundant.
  assert.equal(definition.stacking, "single");
  const [staticAbility] = definition.expand({ host: { canonicalCardId: CANONICAL } });
  assert.deepEqual(staticAbility.effect, {
    kind: "continuous.movement",
    permission: "battlefield-to-battlefield",
    source: "battlefield",
    destination: "battlefield",
    move: "standard",
    addsPermission: true
  });
});

test("ogn-205-298 Yasuo, Windrider: the optional rules bridge consumes normalized Ganking permission for a Standard Move", async () => {
  const { default: movement } = await import("../../../../engine-core/dist/effects/instructions/continuous.movement.js");
  const { ContinuousEffectRegistry } = await import("../../../../engine-core/dist/layers/duration.js");
  const { selectDuelBattlefields, createDuelBoard, placeDuelUnit } = await import("../../../../engine-core/dist/duel/battlefields.js");
  const { moveDuelUnitsStandard } = await import("../../../../engine-core/dist/zones/movement.js");
  const seats = ["A", "B"].map(playerId => ({
    playerId,
    battlefields: [1, 2, 3].map(index => ({ instanceId: `${playerId}-${index}`, cardId: `field-${index}` }))
  }));
  const empty = createDuelBoard(selectDuelBattlefields(seats, () => 0));
  const [origin, destination] = empty.battlefields.map(field => field.locationId);
  const board = placeDuelUnit(empty, { objectId: "yasuo", controllerPlayerId: "A", locationId: origin });
  const kernel = world()
    .unit("yasuo", {
      cardId: CANONICAL,
      location: { type: "battlefield", id: origin },
      might: 4
    })
    .build();
  const [staticAbility] = ganking.expand({ host: { canonicalCardId: CANONICAL } });
  const { kind, ...effectArgs } = staticAbility.effect;
  const registered = runInstruction(movement, Object.fromEntries(
    Object.entries(effectArgs).map(([key, value]) => [key, literal(value)])
  ), { world: kernel });
  assert.equal(registered.result.status, "executed");
  const registry = new ContinuousEffectRegistry();
  for (const entry of kernel.continuousEffects) registry.register(entry.effect, entry.duration);
  // The real primitive normalizes permission to permission.routes. Production
  // static binding still needs that normalization and registry assembly.
  const result = moveDuelUnitsStandard(
    board,
    [{ objectId: "yasuo", readied: true, hasGanking: false }],
    {
      actor: "A",
      unitUIDs: ["yasuo"],
      destinationLocationId: destination,
      timing: { phase: "main", stateOpen: true, turnPlayerId: "A", priorityPlayerId: "A" }
    },
    { registry }
  );

  assert.equal(result.board.units.find(unit => unit.objectId === "yasuo").locationId, destination);
  assert.deepEqual(result.readiness, [{ objectId: "yasuo", readied: false, hasGanking: false }]);
  assert.equal(result.group.exhaustedCount, 1);
  assert.deepEqual(result.group.events, [
    { objectId: "yasuo", actor: "A", fromLocationId: origin, toLocationId: destination }
  ]);
});

test("ogn-205-298 Yasuo, Windrider golden: 'you score 1 point' really gains 1 point (CR 470.2)", () => {
  const kernel = yasuoWorld();
  const outcome = runAbilityBody([scoreInstruction], kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.player("A").score, 1);
  assert.deepEqual(outcome.results[0].result.linkedValues.scored, [{ player: "A", amount: 1 }]);
  assert.deepEqual(outcome.events.map(event => event.action), ["score"]);
});

test("ogn-205-298 Yasuo, Windrider golden: the merged history query counts this unit's real Moves", () => {
  // The printed count ("the third time I move this turn") needs this unit's
  // move history. The merged condition.history instruction executes exactly
  // that query; the golden feeds it real effect.move actions (449 moves) and
  // reads the count.
  const kernel = yasuoWorld();
  const history = (operator, right) => ({
    id: "yasuo-windrider.count-moves",
    op: "condition.history",
    args: {
      query: literal({
        action: "move-location",
        object: kernel.ref("yasuo"),
        scope: "turn"
      }),
      ...(operator === undefined ? {} : { operator: literal(operator) }),
      ...(right === undefined ? {} : { right: literal(right) })
    }
  });

  assert.equal(moveYasuo(kernel, "bf-2").result.status, "executed");
  const afterOne = runAbilityBody([history(undefined, undefined)], kernel);
  assert.equal(afterOne.results[0].result.linkedValues.count, 1);

  assert.equal(moveYasuo(kernel, "bf-1").result.status, "executed");
  const afterTwo = runAbilityBody([history("eq", 3)], kernel);
  assert.equal(afterTwo.results[0].result.linkedValues.count, 2);
  assert.equal(afterTwo.results[0].result.linkedValues.value, false);

  assert.equal(moveYasuo(kernel, "bf-2").result.status, "executed");
  const afterThree = runAbilityBody([history("eq", 3)], kernel);
  assert.equal(afterThree.results[0].result.linkedValues.count, 3);
  assert.equal(afterThree.results[0].result.linkedValues.value, true);
});

test("ogn-205-298 Yasuo, Windrider boundary: the closed event vocabulary rejects object-moved before registration (383.1.b)", () => {
  // The trigger needs the object-moved timing point, but the closed
  // EVENT_PATTERN_TYPES list ends at final-point; assertTriggerSpec fails, so
  // the production lifecycle can never register this ability.
  const { kernel, engine } = yasuoEngine();
  const executable = { ...program, status: "executable", judgeReason: undefined };
  assert.throws(
    () => registerProgramTriggers(new ProgramRegistry([executable]), engine, kernel.getObject("yasuo")),
    error => error.name === "TriggerSpecValidationError" &&
      error.issues.some(issue => issue.code === "invalid-event-type" && issue.path === "trigger.filter.event")
  );
  // Nothing was registered, so a real committed Move cannot score the point.
  assert.deepEqual(kernel.events.filter(event => event.action === "score"), []);
});

test("ogn-205-298 Yasuo, Windrider boundary: the TriggerSpec count expression cannot read this turn's Move history (383.1.b)", () => {
  // The merged condition.history instruction does count real move-location
  // actions (previous golden), but the authored TriggerSpec condition is a
  // count expression, which resolves as a set query over current objects.
  // A unit on the board therefore counts 1 regardless of how often it moved.
  const kernel = yasuoWorld();
  const authored = triggered.trigger.condition;
  assert.equal(kernel.test(authored), false);
  assert.equal(
    runAbilityBody([{ id: "yasuo-windrider.count-moves", op: "condition.value", args: { value: authored.left } }], kernel)
      .results[0].result.linkedValues.value,
    1
  );
  assert.equal(moveYasuo(kernel, "bf-2").result.status, "executed");
  assert.equal(
    runAbilityBody([{ id: "yasuo-windrider.count-moves", op: "condition.value", args: { value: authored.left } }], kernel)
      .results[0].result.linkedValues.value,
    1
  );
  assert.equal(kernel.test(authored), false);

  // The real history instruction the card would need is a body op, not a
  // TriggerSpec condition, and only the reference kernel implements the query.
  const history = runAbilityBody([{
    id: "yasuo-windrider.count-moves",
    op: "condition.history",
    args: { query: literal({ action: "move-location", object: kernel.ref("yasuo"), scope: "turn" }), operator: literal("eq"), right: literal(3) }
  }], kernel);
  assert.equal(history.results[0].result.linkedValues.count, 1);
  assert.equal(history.results[0].result.linkedValues.value, false);
});

test("ogn-205-298 Yasuo, Windrider boundary: production Standard Move does not consume the Ganking permission (810.1.b/144.4.c)", () => {
  // The keyword expansion binds to the ability layer, but the registered
  // effect keeps the string permission while the rule query reads
  // permission.routes, and no production caller assembles DuelMovementRuleContext.
  const { kernel, engine } = yasuoEngine();
  createEngineStaticBinder(engine).bindStatic(
    ganking.expand({ host: { canonicalCardId: CANONICAL } })[0],
    kernel.getObject("yasuo")
  );
  const registration = engine.layers.registry.list()[0];
  assert.equal(registration.effect.layer, "ability");
  assert.deepEqual(registration.effect.effect.permission, "battlefield-to-battlefield");
  assert.equal(registration.effect.effect.permission.routes, undefined);

  // The rule query reads permission.routes, so the same registration that the
  // production binder created still reports canGank: false.
  const registry = new ContinuousEffectRegistry();
  for (const entry of engine.layers.registry.list()) registry.register(entry.effect, entry.duration);
  const view = queryMovement(registry, kernel.ref("yasuo"), kernel.getObject("yasuo"), "A");
  assert.equal(view.canGank, false);
  assert.equal(view.battlefieldToBattlefield, false);
  assert.deepEqual(view.permissions, []);
});

test.todo(
  "ogn-205-298 Yasuo, Windrider: the trigger condition 'the third time I move in a turn' (383.1.b) needs a " +
    "history predicate in the Condition vocabulary (the merged condition.history is an instruction op, not a " +
    "TriggerSpec condition) plus an exactly-once Nth-occurrence shape (383.1.b), and the trigger cannot even " +
    "register while object-moved is absent from EVENT_PATTERN_TYPES"
);

test.todo(
  "ogn-205-298 Yasuo, Windrider: [Ganking]'s expansion execution (810.1.c / 144.4.c Battlefield→Battlefield " +
    "Standard Move) — RIFT-347's optional rules bridge already consumes canGank, but production must assemble " +
    "DuelMovementRuleContext for duel/standard-move-executor-v2.ts, normalize the keyword's string permission " +
    "to permission.routes, and stop apps/game-server's authoritative-runtime-p4.ts trusted Ganking evaluator " +
    "from throwing 'unresolved movement keyword' for this card"
);
