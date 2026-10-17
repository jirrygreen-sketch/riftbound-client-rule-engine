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
    .hand("master-yi", { types: ["unit"], energy: 7, power: ["Body"], might: 6 })
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

function bindEnterReady(f, id = "master-yi") {
  return bindReplacement(
    // The program's own declared replacement, unchanged: only the real binder
    // turns it into a pipeline registration.
    { replaces: replacement.replaces, with: replacement.with },
    f.kernel.ref(id),
    {
      host: {
        object: ref => f.kernel.object(ref),
        objects: () => f.kernel.objects,
        context: (source, controller) => bindResolveContext(f.kernel, { source, controller })
      },
      pipeline: f.engine.pipeline
    }
  );
}

test("ogs-009-024 Master Yi, Honed: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ogs-009-024 Master Yi, Honed: judgeReason names the Standard Move gap and the RIFT-257 binding", () => {
  assert.match(program.judgeReason, /continuous\.movement/);
  assert.match(program.judgeReason, /Standard Move/);
  assert.match(program.judgeReason, /bindReplacement/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.doesNotMatch(program.judgeReason, /replacement\.enter 管线未合入/);
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
  assert.ok(registered, "effects/keywords/Ganking.ts must be in the generated registry");
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

test("ogs-009-024 Master Yi, Honed golden: the bound replacement enters ready without a ready trigger", () => {
  const f = fixture();
  bindEnterReady(f);

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
  assert.equal(
    f.engine.pipeline.events.filter(event => event.timingPoint === "object-readied").length,
    0
  );
});

test("ogs-009-024 Master Yi, Honed golden: another unit still enters exhausted, and cancel releases the registration", () => {
  const f = fixture();
  const bound = bindEnterReady(f);

  f.engine.execute({
    id: "play-other",
    controller: "A",
    source: f.kernel.getObject("other-unit"),
    kind: "unit",
    speed: "normal",
    body: []
  });
  resolveAll(f.engine);
  // The filter's self anchor (CR 370.1.b) keeps other units on the default
  // exhausted entry (359.2.c).
  assert.equal(f.kernel.getObject("other-unit").exhausted, true);

  // cancel() stops the registration from matching (the merged pipeline keeps
  // the entry but the local cancelled flag turns matching off), so a later
  // entry by the same host takes the default exhausted path.
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

test.todo(
  "ogs-009-024 Master Yi, Honed: Ganking's continuous.movement permission lets the unit make a " +
    "battlefield-to-battlefield Standard Move (CR 810.1.b/810.1.c, 144.4.c.1) — the merged Standard " +
    "Move path (combat/flow.ts move()) still blocks on the atomic Exhaust+Move transaction and takes " +
    "Ganking from a caller-supplied trusted evaluator, so no production executor reads the permission"
);

test.todo(
  "ogs-009-024 Master Yi, Honed: the card-program lifecycle binds this replacement ability into the " +
    "event pipeline's replacement registry (contract 3.5) — RIFT-257; the golden binds the same IR " +
    "directly through the merged bindReplacement to prove the declared shape executes"
);
