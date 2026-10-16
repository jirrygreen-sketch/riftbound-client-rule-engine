import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/hunker-down.js";
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { resolveChainBody } = await import(new URL("chain/interpreter-adapter.js", engineCore));
const { runInstruction, world } = await import(new URL("effects/testing/index.js", engineCore));
const { default: ready } = await import(new URL("effects/instructions/effect.ready.js", engineCore));
const { default: draw } = await import(new URL("effects/instructions/effect.draw.js", engineCore));

const CANONICAL = "card.hash-2664ce34bf1adce071ce02ab9d89d11c45b42381e2728fbb02be19a2d83e1575";
const [keyword, play] = program.abilities;
const [readyUnit, cantMove, drawInstruction] = play.body;

test("rad-034-167 Hunker Down: program passes validateCardProgram and keeps the printing text", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(
    program.sourceText,
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
      "Ready a friendly unit. It can't move this turn. Draw 1."
  );
});

test("rad-034-167 Hunker Down: judge-required naming the missing movement restriction", () => {
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.movement/);
  assert.match(program.judgeReason, /continuous\.restrict/);
  assert.match(program.judgeReason, /RIFT-91/);
});

test("rad-034-167 Hunker Down: [Reaction], ready a friendly unit, the no-move clause, then an unlinked draw", () => {
  assert.deepEqual(keyword, { kind: "keyword", keyword: "reaction" });
  assert.deepEqual(play.body.map((instruction) => instruction.id), [
    "hunker-down.ready-unit",
    "hunker-down.cant-move",
    "hunker-down.draw"
  ]);

  // "Ready a friendly unit" — a target (the merged effect.ready documents
  // "Ready a friendly unit/gear/legend" as the target form).
  assert.equal(readyUnit.op, "effect.ready");
  assert.deepEqual(readyUnit.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "hunker-down.unit" }
  });
  assert.deepEqual(readyUnit.targets, [
    {
      id: "hunker-down.unit",
      filter: { type: "unit", zone: "board", controller: "self" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);

  // "It can't move this turn" — recorded with the layers movement shape; no
  // registered primitive consumes it yet (see judgeReason). It reuses the
  // readied object through a non-targeting pick of the ready result.
  assert.equal(cantMove.op, "continuous.movement");
  assert.deepEqual(cantMove.args.movement, {
    kind: "constant",
    value: { canMove: false, restriction: "hunker-down-cant-move" }
  });
  assert.deepEqual(cantMove.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.deepEqual(cantMove.picks, [
    {
      id: "hunker-down.readied-unit",
      options: [{ kind: "linked-value", instructionId: "hunker-down.ready-unit", key: "readied" }],
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(cantMove.linkedTo, "hunker-down.ready-unit");
  assert.equal(cantMove.targets, undefined);

  // "Draw 1." — a separate sentence, deliberately NOT linked to the ready so a
  // mistargeted ready still draws (359.3.e.14.b).
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args.amount, { kind: "constant", value: 1 });
  assert.equal(drawInstruction.linkedTo, undefined);
});

// The reference kernel compares a filter's `controller` literally, while the
// production chain normalizes the selector "self" against the ability's
// controller (chain/engine.ts). Golden execution substitutes the concrete player
// id for that one selector, and substitutes the ready target set directly; the
// program itself is unchanged.
const kernelBody = () => [
  { ...readyUnit, targets: undefined },
  drawInstruction
];

test("rad-029/rad-034 golden: readying an exhausted friendly unit then drawing 1", () => {
  const kernel = world()
    .deck(["deck-1", "deck-2"])
    .unit("ally", { owner: "A", exhausted: true })
    .build();
  kernel.setTargets("hunker-down.unit", [kernel.ref("ally")]);

  const outcome = resolveChainBody(kernelBody(), kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((result) => [result.id, result.result.status]),
    [
      ["hunker-down.ready-unit", "executed"],
      ["hunker-down.draw", "executed"]
    ]
  );
  // CR 416.1: the unit becomes ready.
  assert.equal(kernel.getObject("ally").exhausted, false);
  assert.deepEqual(outcome.linkedValues["hunker-down.ready-unit.readied"], {
    count: 1,
    objects: [{ id: "ally", zoneEntryId: 1 }]
  });
  // CR 414.1: the draw still happens (414).
  assert.equal(kernel.player("A").handSize, 1);
});

test("rad-034-167 Hunker Down golden: an already-ready unit is a legal no-op and the draw still happens", () => {
  const kernel = world()
    .deck(["deck-1", "deck-2"])
    .unit("ally", { owner: "A", exhausted: false })
    .build();
  kernel.setTargets("hunker-down.unit", [kernel.ref("ally")]);

  const outcome = resolveChainBody(kernelBody(), kernel);
  // CR 416.1.b/416.1.c: nothing additional happens, but the ability still ran.
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.linkedValues["hunker-down.ready-unit.readied"], {
    count: 0,
    objects: []
  });
  assert.equal(kernel.getObject("ally").exhausted, false);
  assert.equal(kernel.player("A").handSize, 1);
});

test("rad-034-167 Hunker Down boundary: a lost ready target still draws (359.3.e.14.b)", () => {
  const kernel = world()
    .deck(["deck-1", "deck-2"])
    .unit("ally", { owner: "A", exhausted: true })
    .build();
  const stale = kernel.ref("ally");
  kernel.perform({ type: "kill", object: stale });
  kernel.setTargets("hunker-down.unit", [stale]);

  const outcome = resolveChainBody(kernelBody(), kernel);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(
    outcome.results.map((result) => [result.id, result.result.status]),
    [
      ["hunker-down.ready-unit", "ignored"],
      ["hunker-down.draw", "executed"]
    ]
  );
  assert.equal(kernel.player("A").handSize, 1);
});

test("rad-034-167 Hunker Down golden: effect.ready alone reads the readied count", () => {
  const kernel = world().unit("ally", { owner: "A", exhausted: true }).build();
  const run = runInstruction(
    ready,
    { objects: readyUnit.args.objects.value, amount: 1 },
    { world: kernel, targets: { "hunker-down.unit": [kernel.ref("ally")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("ally").exhausted, false);
  assert.deepEqual(run.linked.readied, {
    count: 1,
    objects: [{ id: "ally", zoneEntryId: 1 }]
  });
  assert.deepEqual(run.events.map((event) => event.action), ["ready"]);
});

test("rad-034-167 Hunker Down golden: effect.draw alone moves the top card to hand (CR 414.1)", () => {
  const kernel = world().deck(["deck-1", "deck-2"]).build();
  const run = runInstruction(draw, { amount: drawInstruction.args.amount }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["deck-1"]);
});

test.todo(
  "rad-034-167 Hunker Down: 'It can't move this turn' needs a card-facing primitive that " +
    "registers a duration-bounded continuous.movement / continuous.restrict effect through " +
    "ctx.addContinuous; layers/ can evaluate that shape but no registered instruction op " +
    "produces it (RIFT-91 layers-continuous)"
);
test.todo(
  "rad-034-167 Hunker Down: full chain play (1 Energy, [Reaction] Closed-State window) needs " +
    "the Finalize cost plan adapter (RIFT-89) and chain admission (RIFT-84/RIFT-85)"
);
