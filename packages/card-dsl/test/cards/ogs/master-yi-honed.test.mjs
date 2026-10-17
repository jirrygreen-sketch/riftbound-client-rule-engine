import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import ganking from "../../../../engine-core/dist/effects/keywords/Ganking.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { ContinuousEffectRegistry } from "../../../../engine-core/dist/layers/duration.js";
import { movement } from "../../../../engine-core/dist/layers/rules/query.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { bindReplacement } from "../../../../engine-core/dist/replacement/index.js";
import { createDuelBoard, placeDuelUnit, selectDuelBattlefields } from "../../../../engine-core/dist/duel/battlefields.js";
import { moveDuelUnitsStandard } from "../../../../engine-core/dist/duel/movement.js";
import program from "../../../dist/cards/ogs/master-yi-honed.js";

const CANONICAL =
  "card.hash-65cd9565fff10c8779998a9b1ca3843ab54b34a3cc338af891157cfbf9ec1761";
const SOURCE_TEXT = "[Ganking] (I can move from battlefield to battlefield.)\nI enter ready.";

const [gankingKeyword, replacement] = program.abilities;

/** A real ChainEngine harness (engine-core/test/replacement/enter.test.mjs shape). */
function fixture() {
  const kernel = world()
    .player("A", { energy: 20, power: ["Body"] })
    .player("B", { energy: 20 })
    .hand("master-yi", { cardId: CANONICAL, types: ["unit"], energy: 7, power: ["Body"], might: 6 })
    .hand("other-unit", { types: ["unit"], energy: 2, power: [], might: 2 })
    .build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => {
      kernel.restore(checkpoint.state);
      kernel.copyLinkedFrom(checkpoint.links);
    },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => {
      throw new Error(`Unexpected choice: ${request.id}`);
    },
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint })
  });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"],
    turnPlayer: "A",
    phase: "main",
    host,
    cleanup: () => false
  });
  return { engine, kernel };
}

function resolveAll(engine) {
  engine.advance();
  let guard = 0;
  while (engine.items.length) {
    if (++guard > 50) throw new Error("Nonterminating test chain");
    engine.pass(engine.priority);
  }
}

function play(f, id, draftId) {
  f.engine.execute({
    id: draftId,
    controller: "A",
    source: f.kernel.getObject(id),
    kind: "unit",
    speed: "normal",
    body: []
  });
  resolveAll(f.engine);
}

function lifecycleOn(f) {
  return createProgramBinding({ cardPrograms: [program] }).attachLifecycle(f.engine, (error, source) => {
    // other-unit is in the fixture without a program; the production lifecycle
    // fails closed for it and the card keeps the default entry. The card under
    // test (master-yi) must never hit this path.
    if (source.ref.id === "master-yi") {
      throw new Error("Lifecycle binding failed for master-yi: " + error);
    }
  });
}

/** Real duel factory for CR 144 Standard Move tests (duel-standard-move.test.mjs shape). */
function duelScene() {
  const board = createDuelBoard(selectDuelBattlefields([
    { playerId: "alice", battlefields: [
      { instanceId: "a-1", cardId: "printing-x" }, { instanceId: "a-2", cardId: "printing-y" },
      { instanceId: "a-3", cardId: "printing-z" },
    ] },
    { playerId: "bob", battlefields: [
      { instanceId: "b-1", cardId: "printing-x" }, { instanceId: "b-2", cardId: "printing-y" },
      { instanceId: "b-3", cardId: "printing-z" },
    ] },
  ], () => 0));
  const base = playerId => board.bases.find(entry => entry.ownerPlayerId === playerId).locationId;
  return { board, f1: board.battlefields[0].locationId, f2: board.battlefields[1].locationId, baseA: base("alice") };
}
const readinessFor = (board, opts = {}) => {
  const ganking = opts.ganking || [];
  const exhausted = opts.exhausted || [];
  return board.units.map(unit => ({
    objectId: unit.objectId, readied: !exhausted.includes(unit.objectId),
    hasGanking: ganking.includes(unit.objectId),
}));
};
const mainTiming = actor => ({
  phase: "main", stateOpen: true, turnPlayerId: actor, priorityPlayerId: actor,
});
const moveRequest = (actor, unitUIDs, destinationLocationId) => ({
  actor, unitUIDs, destinationLocationId, timing: mainTiming(actor),
});

test("ogs-009-024 Master Yi, Honed: program validates as judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /battlefield-to-battlefield/);
  assert.match(program.judgeReason, /Contract change request/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ogs-009-024 Master Yi, Honed: [Ganking] keyword plus an enter-ready replacement", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(gankingKeyword, { kind: "keyword", keyword: "ganking" });

  assert.equal(replacement.kind, "replacement");
  // The filter describes the replaced event: this unit entering exhausted
  // (CR 370.1.b, 143.4, 359.2.c).
  assert.deepEqual(replacement.replaces, {
    event: "object-enters-board",
    filter: { self: true, exhausted: true }
  });
  assert.equal(replacement.condition, undefined);
  assert.equal(replacement.with.length, 1);
  const [withInstruction] = replacement.with;
  assert.equal(withInstruction.id, "master-yi-honed.enter-ready");
  assert.equal(withInstruction.op, "effect.ready");
  // RIFT-260's replacement planner resolves the body selector; "self" must be
  // an explicit source selector (the empty args form is rejected at bind time).
  assert.deepEqual(withInstruction.args, {
    objects: { kind: "constant", value: { kind: "source" } }
  });
});

test("ogs-009-024 Master Yi, Honed: the declared keyword resolves to the merged Ganking KeywordDef", () => {
  const registered = keywordDefinitionsById.get("Ganking");
  assert.ok(registered, "effects/keywords/registry.generated.ts must exist and be imported");
  assert.equal(registered, ganking);
  assert.equal(gankingKeyword.keyword, registered.keyword.toLowerCase());
  // 810.2: multiple Ganking instances are redundant.
  assert.equal(registered.stacking, "single");
  assert.ok(registered.ruleRefs.includes("810.1.c"));
  assert.ok(registered.ruleRefs.includes("144.4.c.1"));
});

test("ogs-009-024 Master Yi, Honed: the Ganking expansion registers a battlefield-to-battlefield Standard Move permission", () => {
  const [expansion] = ganking.expand({ host: { canonicalCardId: CANONICAL } });
  assert.equal(expansion.kind, "static");
  assert.equal(expansion.effect.kind, "continuous.movement");
  // 810.1.b/810.1.c: the permission adds the Battlefield-to-Battlefield route
  // to the unit's own Standard Move; it never moves anything by itself.
  // The instruction form records the permission in the object shape that the
  // merged layers/rules/query.ts movement() consumer reads.
  const body = [{
    id: "master-yi-honed.ganking-permission",
    op: "continuous.movement",
    args: {
      permission: { kind: "constant", value: expansion.effect.permission },
      source: { kind: "constant", value: expansion.effect.source },
      destination: { kind: "constant", value: expansion.effect.destination },
      move: { kind: "constant", value: expansion.effect.move },
      addsPermission: { kind: "constant", value: expansion.effect.addsPermission },
      appliesTo: { kind: "constant", value: { objectId: "master-yi" } }
    }
  }];
  const base = world().unit("master-yi", { zone: "board" }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("master-yi") });
  const outcome = resolveChainBody(body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  assert.equal(kernel.continuousEffects[0].effect.layer, "ability");

  // The merged query reads the recorded permission back for this unit.
  const registry = new ContinuousEffectRegistry();
  for (const entry of kernel.continuousEffects) registry.register(entry.effect, entry.duration, 1);
  const query = movement(registry, kernel.ref("master-yi"), kernel.getObject("master-yi"), "A");
  assert.equal(query.battlefieldToBattlefield, true);
  assert.equal(query.canGank, true);
  assert.deepEqual(query.permissions.map(permission => permission.routes), [["battlefield-to-battlefield"]]);
});

test("ogs-009-024 Master Yi, Honed golden: the merged replacement binding rewrites the entry; the unit enters ready without a ready trigger", () => {
  // The card is judge-required overall (the Ganking half is blocked), so the
  // production ProgramRegistry refuses the whole card program. This golden
  // binds the card's own replacement ability through the same production
  // entry-pipeline path the lifecycle uses for an executable card
  // (engine-core bindReplacement over engine.pipeline, see platewyrm-egg).
  const f = fixture();
  bindReplacement(
    { replaces: replacement.replaces, with: replacement.with },
    f.kernel.ref("master-yi"),
    {
      host: {
        object: ref => f.kernel.getObject(ref.id),
        objects: () => f.kernel.objects,
        context: (snapshot, controller) => bindResolveContext(f.kernel, { source: snapshot, controller })
      },
      pipeline: f.engine.pipeline
    }
  );

  f.engine.execute({
    id: "play-master-yi",
    controller: "A",
    source: f.kernel.getObject("master-yi"),
    kind: "unit",
    speed: "normal",
    body: []
  });
  resolveAll(f.engine);

  assert.equal(f.kernel.getObject("master-yi").zone, "board");
  assert.equal(f.kernel.getObject("master-yi").exhausted, false);
  // 805.6.a: the entry is rewritten, not exhausted-then-readied, so no
  // becomes-ready timing occurs on Board.
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "object-readied").length, 0);
});

test("ogs-009-024 Master Yi, Honed golden: another unit still enters exhausted, and cancel releases the registration", () => {
  // Self-anchored filter: a different unit is never rewritten (CR 370.1.b).
  const f = fixture();
  const bound = bindReplacement(
    { replaces: replacement.replaces, with: replacement.with },
    f.kernel.ref("master-yi"),
    {
      host: {
        object: ref => f.kernel.getObject(ref.id),
        objects: () => f.kernel.objects,
        context: (snapshot, controller) => bindResolveContext(f.kernel, { source: snapshot, controller })
      },
      pipeline: f.engine.pipeline
    }
  );

  f.engine.execute({
    id: "play-other",
    controller: "A",
    source: f.kernel.getObject("other-unit"),
    kind: "unit",
    speed: "normal",
    body: []
  });
  resolveAll(f.engine);
  assert.equal(f.kernel.getObject("other-unit").exhausted, true);

  // cancel() stops the registration from matching, so a later entry by the
  // same host takes the default exhausted path on this same engine.
  bound.cancel();
  f.engine.execute({
    id: "play-master-yi",
    controller: "A",
    source: f.kernel.getObject("master-yi"),
    kind: "unit",
    speed: "normal",
    body: []
  });
  resolveAll(f.engine);
  assert.equal(f.kernel.getObject("master-yi").zone, "board");
  assert.equal(f.kernel.getObject("master-yi").exhausted, true);
});

test("ogs-009-024 Master Yi, Honed: the with-body readies the source through the merged primitive", () => {
  // The replacement's body is planned to a real ready GameAction by the binder
  // above; this isolation check runs the same instruction through the
  // interpreter and asserts it readies the source unit, never a Board entry.
  const kernel = world().unit("master-yi", { exhausted: true, might: 6 }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("master-yi") });
  const outcome = runAbilityBody(replacement.with, scoped);
  assert.equal(outcome.status, "executed");
  assert.equal(scoped.getObject("master-yi").exhausted, false);
  assert.deepEqual(outcome.results.map(result => result.op), ["effect.ready"]);
});

test("ogs-009-024 Master Yi, Honed golden: the registered Ganking permission (instruction form) drives moveDuelUnitsStandard (CR 810.1.b/810.1.c, 144.4.c.1)", () => {
  // The keyword-expansion route is judge-required: Ganking expands to a string
  // permission, but layers/rules/query.ts movement() consumes a {routes} object,
  // so the lifecycle-registered keyword entry yields canGank:false (gap noted in
  // judgeReason + contract change request). This golden proves the consumption
  // side: a continuous.movement instruction records the same battlefield-to-
  // battlefield permission in the object shape and moveDuelUnitsStandard
  // consumes it through the real registry without a trusted hasGanking callback.
  const kernel = world().unit("master-yi", { zone: "board", might: 6 }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("master-yi") });
  const body = [{
    id: "master-yi-honed.ganking-permission",
    op: "continuous.movement",
    args: {
      permission: { kind: "constant", value: "battlefield-to-battlefield" },
      source: { kind: "constant", value: "battlefield" },
      destination: { kind: "constant", value: "battlefield" },
      move: { kind: "constant", value: "standard" },
      addsPermission: { kind: "constant", value: true },
      appliesTo: { kind: "constant", value: { objectId: "master-yi" } }
    }
  }];
  const outcome = resolveChainBody(body, scoped);
  assert.equal(outcome.status, "executed");
  const registry = new ContinuousEffectRegistry();
  for (const entry of scoped.continuousEffects) registry.register(entry.effect, entry.duration, 1);

  const entries = registry.list();
  assert.equal(entries.length, 1);
  // The instruction normalizes the registered layer kind to "movement"; the
  // query's effectsOfKind matches both the bare and continuous-prefixed names.
  assert.equal(entries[0].effect.effect.kind, "movement");
  assert.equal(entries[0].effect.filter.objectId, "master-yi");
  const ref = kernel.ref("master-yi");
  const object = kernel.getObject("master-yi");
  const query = movement(registry, ref, object, "alice");
  assert.equal(query.battlefieldToBattlefield, true);
  assert.equal(query.canGank, true);

  const scene = duelScene();
  const current = placeDuelUnit(scene.board, { objectId: "master-yi", controllerPlayerId: "alice", locationId: scene.f1 });
  const readiness = readinessFor(current);
  const result = moveDuelUnitsStandard(current, readiness, moveRequest("alice", ["master-yi"], scene.f2), {
    registry,
    refForUnit: () => ref,
    objectForUnit: () => object,
  });
  assert.equal(result.board.units.find(unit => unit.objectId === "master-yi").locationId, scene.f2);
  assert.equal(result.readiness.find(unit => unit.objectId === "master-yi").readied, false);
});

test("ogs-009-024 Master Yi, Honed golden: a unit without the Ganking static is refused the battlefield-to-battlefield route (CR 144.4.c)", () => {
  const scene = duelScene();
  const current = placeDuelUnit(scene.board, { objectId: "plain-unit", controllerPlayerId: "alice", locationId: scene.f1 });
  assert.throws(
    () => moveDuelUnitsStandard(current, readinessFor(current), moveRequest("alice", ["plain-unit"], scene.f2), {
      registry: new ContinuousEffectRegistry(),
    }),
    /needs Ganking/
  );
});
