import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/whiteflame-protector.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import continuousMight from "../../../../engine-core/dist/effects/instructions/continuous.might.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { registerProgramTriggers } from "../../../../engine-core/dist/programs/triggers.js";

const CANONICAL =
  "card.hash-b9737e97366888566c3b22952ffcbbb0194dfeed8bd919f0e724f6d93433206e";
const SOURCE_TEXT = "When you play me, give a unit +8 :rb_might: this turn.";
const [triggered] = program.abilities;
const [instruction] = triggered.body;
const targetId = "whiteflame-protector.unit";

test("ogn-082-298 Whiteflame Protector: program validates and is executable", () => {
  const validation = validateCardProgram(program);
  assert.equal(validation.ok, true, JSON.stringify(validation.issues));
  assert.deepEqual(validation.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("ogn-082-298 Whiteflame Protector: one mandatory self card-played trigger", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(triggered.kind, "triggered");
  assert.deepEqual(triggered.trigger, {
    at: "card-played",
    filter: { event: "card-played", filter: { source: "self" } }
  });
  assert.equal(triggered.optional, false);
  assert.equal(instruction.id, "grant-might");
  assert.equal(instruction.op, "continuous.might");
  assert.deepEqual(instruction.args.objects, {
    kind: "constant",
    value: { kind: "target", id: targetId }
  });
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 8 });
  assert.deepEqual(instruction.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(instruction.targets, [{
    id: targetId,
    filter: { type: "unit", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  }]);
});

test("ogn-082-298 Whiteflame Protector: the targeted Might instruction registers a temporary layer effect", () => {
  const kernel = world()
    .unit("protector", { might: 4, owner: "A", controller: "A" })
    .unit("target", { might: 2, owner: "B", controller: "B" })
    .build();
  const run = runInstruction(
    continuousMight,
    instruction.args,
    { world: kernel, targets: { [targetId]: [kernel.ref("target")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  assert.equal(kernel.continuousEffects[0].effect.effect.kind, "continuous.might");
  assert.equal(kernel.continuousEffects[0].duration.type, "end-of-turn");
  assert.equal(kernel.continuousEffects[0].effect.filter.objectId, "target");
});

function fixture() {
  const kernel = world()
    .player("A", { energy: 20 })
    .player("B", { energy: 20 })
    .unit("protector", { cardId: CANONICAL, owner: "A", controller: "A", might: 4, zone: "board" })
    .unit("target", { owner: "B", controller: "B", might: 2, zone: "board" })
    .build();
  const choose = request => {
    if (request.type === "select-objects") {
      const selected = request.options.filter(option => option.id === "target");
      if (selected.length >= request.min) return selected.slice(0, request.max);
    }
    if (request.type === "optional") return true;
    throw new Error(`Unexpected choice: ${request.id}`);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => {
      kernel.restore(checkpoint.state);
      kernel.copyLinkedFrom(checkpoint.links);
    },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint, choose }),
    testTrigger: registration => kernel.test(registration.spec.condition)
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
    if (++guard > 30) throw new Error("Nonterminating test chain");
    engine.pass(engine.priority);
  }
}

test("ogn-082-298 Whiteflame Protector: the production trigger binder resolves +8 on an enemy unit", () => {
  const { engine, kernel } = fixture();
  const registry = new ProgramRegistry([program]);
  registerProgramTriggers(registry, engine, kernel.getObject("protector"));

  engine.pipeline.emit({
    timingPoint: "card-played",
    object: kernel.getObject("protector"),
    player: "A"
  });
  resolveAll(engine);

  assert.equal(engine.layers.evaluate(kernel.ref("target")).might, 10);
  assert.equal(engine.layers.evaluate(kernel.ref("protector")).might, 4);

  engine.pipeline.emit({ timingPoint: "turn-end", player: "A" });
  assert.equal(engine.layers.evaluate(kernel.ref("target")).might, 2);
});

test("ogn-082-298 Whiteflame Protector: a stale target is ignored without changing state", () => {
  const kernel = world().unit("target", { might: 2 }).build();
  const stale = kernel.ref("target");
  kernel.perform({ type: "kill", object: stale });
  const run = runInstruction(
    continuousMight,
    instruction.args,
    { world: kernel, targets: { [targetId]: [stale] } }
  );
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
  assert.equal(kernel.continuousEffects.length, 0);
});
