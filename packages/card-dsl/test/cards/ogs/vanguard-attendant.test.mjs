import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import program from "../../../dist/cards/ogs/vanguard-attendant.js";

const CANONICAL =
  "card.hash-b6830324541a4a0e8a3b92c94688fa14073792584686e1c85aab70bbb747ff4a";

const [ability] = program.abilities;

/** A real ChainEngine harness (engine-core/test/replacement/enter.test.mjs shape). */
function fixture() {
  const kernel = world()
    .player("A", { energy: 20, power: ["Order"] })
    .player("B", { energy: 20 })
    .hand("vanguard-attendant", { cardId: CANONICAL, types: ["unit"], energy: 6, power: ["Order"], might: 5 })
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

test("ogs-016-024 Vanguard Attendant: program validates as executable", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, "I enter ready.");
});

test("ogs-016-024 Vanguard Attendant: one replacement ability for entering the board exhausted", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "replacement");
  assert.equal(ability.condition, undefined);
  // "I enter ready" replaces the exhausted entry of this unit itself
  // (CR 143.4, 359.2.c, 369.3).
  assert.deepEqual(ability.replaces, {
    event: "object-enters-board",
    filter: { self: true, exhausted: true }
  });
  assert.equal(ability.with.length, 1);
  const [instruction] = ability.with;
  assert.equal(instruction.id, "vanguard-attendant.enter-ready");
  assert.equal(instruction.op, "effect.ready");
  // RIFT-260's planner resolves this explicit source selector; the empty args
  // spelling is rejected at bind time ("requires an object selector").
  assert.deepEqual(instruction.args, {
    objects: { kind: "constant", value: { kind: "source" } }
  });
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.linkedTo, undefined);
});

test("ogs-016-024 Vanguard Attendant golden: the production lifecycle binds the entry replacement; the unit enters ready without a ready trigger", () => {
  const f = fixture();
  // A real ProgramRegistry over this card's executable program; attachLifecycle
  // is the merged RIFT-257 path that registers the card's replacement
  // abilities for every game object automatically (contract 3.5).
  const binding = createProgramBinding({ cardPrograms: [program] });
  const lifecycle = binding.attachLifecycle(f.engine);

  play(f, "vanguard-attendant", "play-vanguard");
  assert.equal(f.kernel.getObject("vanguard-attendant").zone, "board");
  assert.equal(f.kernel.getObject("vanguard-attendant").exhausted, false);
  // 805.6.a: the entry is rewritten, not exhausted-then-readied.
  assert.equal(
    f.engine.pipeline.events.filter(event => event.timingPoint === "object-readied").length,
    0
  );
  // The card's own ability IR is unchanged by the expansion pass.
  assert.deepEqual(binding.inspect(f.kernel.getObject("vanguard-attendant")).abilities, program.abilities);
  lifecycle.detach();
});

test("ogs-016-024 Vanguard Attendant golden: without the binding the unit takes the default exhausted entry", () => {
  const f = fixture();
  play(f, "vanguard-attendant", "play-vanguard");
  // 359.2.c: units enter the Board exhausted unless a replacement says otherwise.
  assert.equal(f.kernel.getObject("vanguard-attendant").exhausted, true);
});

test("ogs-016-024 Vanguard Attendant golden: a unit with a different identity keeps the default entry", () => {
  const f = fixture();
  const lifecycle = createProgramBinding({ cardPrograms: [program] }).attachLifecycle(f.engine);
  play(f, "other-unit", "play-other");
  assert.equal(f.kernel.getObject("other-unit").exhausted, true);
  lifecycle.detach();
});

test("ogs-016-024 Vanguard Attendant: the with-body readies the source through the merged primitive", () => {
  const kernel = world()
    .unit("vanguard-attendant", { exhausted: true, might: 5 })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("vanguard-attendant") });
  const outcome = runAbilityBody(ability.with, scoped);
  assert.equal(outcome.status, "executed");
  assert.equal(scoped.getObject("vanguard-attendant").exhausted, false);
  assert.deepEqual(outcome.events.map(event => event.action), ["ready"]);
  assert.equal(outcome.results[0].result.status, "executed");
});

test("ogs-016-024 Vanguard Attendant: an already-ready unit is not readied again (CR 416.1.b/416.1.c)", () => {
  const kernel = world().unit("vanguard-attendant", { exhausted: false }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("vanguard-attendant") });
  const outcome = runAbilityBody(ability.with, scoped);
  assert.equal(outcome.status, "executed");
  assert.equal(scoped.getObject("vanguard-attendant").exhausted, false);
  assert.equal(outcome.events.length, 0);
  // The interpreter qualifies linked values by instruction path.
  assert.deepEqual(
    outcome.linkedValues["vanguard-attendant.enter-ready.readied"],
    { count: 0, objects: [] }
  );
});

test("ogs-016-024 Vanguard Attendant: the production lifecycle, not a manual registration, grants the ready entry (RIFT-257)", () => {
  // The lifecycle handle is what registers the replacement: detaching it
  // returns a later entry of the same object to the default exhausted path.
  const f = fixture();
  const lifecycle = createProgramBinding({ cardPrograms: [program] }).attachLifecycle(f.engine);
  play(f, "vanguard-attendant", "play-vanguard-1");
  assert.equal(f.kernel.getObject("vanguard-attendant").exhausted, false);

  lifecycle.detach();
  f.engine.execute({
    id: "play-vanguard-2",
    controller: "A",
    source: f.kernel.getObject("other-unit"),
    kind: "unit",
    speed: "normal",
    body: []
  });
  resolveAll(f.engine);
  assert.equal(f.kernel.getObject("other-unit").zone, "board");
  assert.equal(f.kernel.getObject("other-unit").exhausted, true);
});
