import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/warwick-hunter.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
// The replacement binder is the published RIFT-260 interface (engine-core
// depends on card-dsl, so it is loaded through the workspace layout).
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { bindReplacement } = await import(new URL("replacement/index.js", engineCore));
const { ChainEngine } = await import(new URL("chain/engine.js", engineCore));
const { createActionPipelineHost, bindResolveContext } = await import(new URL("events/action-adapter.js", engineCore));

const CANONICAL = "card.hash-58c01b587562a4a6f91a4fbef216e0f343dcb9427be468ce7553f4ad7d72ade7";

const [entryReplacement, attackTrigger] = program.abilities;

test("ogn-159-298 Warwick, Hunter: program validates and keeps identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, "I enter ready.\nWhen I attack, kill all damaged enemy units here.");
});

test("ogn-159-298 Warwick, Hunter: judgeReason cites the set kill and the damaged predicate; the merged entry-replacement pipeline note stays in the source comment only", () => {
  // bindReplacement is a merged capability, so it is documented in the
  // program's source comment (see the header note) instead of judgeReason.
  const sourceText = fs.readFileSync(new URL('../../../src/cards/ogn/warwick-hunter.ts', import.meta.url), 'utf8');
  assert.match(sourceText, /bindReplacement/);
  assert.match(program.judgeReason, /effect\.kill/);
  assert.match(program.judgeReason, /damaged/);
  assert.match(program.judgeReason, /355\.10\.d/);
  assert.match(program.judgeReason, /combat-start-transaction/);
  assert.doesNotMatch(program.judgeReason, /RIFT-\d+/);
});

test("ogn-159-298 Warwick, Hunter: 'I enter ready.' is an entry replacement declared by replacement.enter (369.3 / 359.2.c)", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(entryReplacement.kind, "replacement");
  assert.deepEqual(entryReplacement.replaces, {
    event: "object-enters-board",
    filter: { self: true, exhausted: true }
  });
  assert.equal(entryReplacement.condition, undefined);
  assert.equal(entryReplacement.with.length, 1);
  const [body] = entryReplacement.with;
  assert.equal(body.id, "warwick.enter-ready");
  assert.equal(body.op, "replacement.enter");
  assert.deepEqual(body.args, {
    state: { kind: "constant", value: "ready" },
    zone: { kind: "constant", value: "board" }
  });
});

test("ogn-159-298 Warwick, Hunter: attack trigger kills the damaged enemy set — not a TargetSpec", () => {
  assert.equal(attackTrigger.kind, "triggered");
  assert.equal(attackTrigger.trigger.at, "attack-declared");
  assert.deepEqual(attackTrigger.trigger.filter, {
    event: "attack-declared",
    filter: { source: "self" }
  });
  assert.equal(attackTrigger.optional, false);
  assert.equal(attackTrigger.body.length, 1);

  const [instruction] = attackTrigger.body;
  assert.equal(instruction.id, "warwick.kill-damaged-enemy-units-here");
  assert.equal(instruction.op, "effect.kill");
  assert.deepEqual(instruction.args.target, {
    kind: "literal",
    value: "warwick.damaged-enemy-units-here"
  });
  // "all damaged enemy units here" is a programmatically selected set
  // (355.10.d), so the program carries no TargetSpec and no invented 'damaged'
  // filter key for it; the gap is named in judgeReason.
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.picks, undefined);
  assert.equal(instruction.linkedTo, undefined);
});

test("ogn-159-298 Warwick, Hunter golden: 'I enter ready.' rewrites the entry through the merged replacement binder (369.3 / 805.6.a)", () => {
  // Real execution through the published bindReplacement interface and a real
  // ChainEngine: the authored `replaces`/`with` pair is bound as-is, then the
  // unit is played. The unit lands ready and no object-readied timing is
  // emitted (805.6.a: it is not "becoming ready").
  const kernel = world()
    .player("A", { energy: 20 })
    .player("B", { energy: 20 })
    .hand("warwick", { energy: 3, power: [], types: ["unit"], might: 5 })
    .deck(["A:deck:1", "A:deck:2", "A:deck:3", "A:deck:4"])
    .build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => {
      kernel.restore(checkpoint.state);
      kernel.copyLinkedFrom(checkpoint.links);
    },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: () => { throw new Error("unexpected choice"); },
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint }),
    testTrigger: registration => kernel.test(registration.spec.condition)
  });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"],
    turnPlayer: "A",
    phase: "main",
    host,
    cleanup: () => false
  });

  bindReplacement(
    { replaces: entryReplacement.replaces, with: entryReplacement.with },
    kernel.ref("warwick"),
    {
      host: { object: ref => kernel.object(ref), objects: () => kernel.objects, context: () => kernel },
      pipeline: engine.pipeline
    }
  );

  engine.execute({
    id: "warwick-play",
    controller: "A",
    source: kernel.getObject("warwick"),
    kind: "unit",
    speed: "normal",
    body: []
  });
  let guard = 0;
  while (engine.items.length) {
    if (++guard > 50) throw new Error("Nonterminating test chain");
    engine.pass(engine.priority);
  }

  const entered = kernel.getObject("warwick");
  assert.equal(entered.zone, "board");
  assert.equal(entered.exhausted, false);
  assert.equal(
    engine.pipeline.events.some(event => event.timingPoint === "object-readied"),
    false
  );
});

test("ogn-159-298 Warwick, Hunter: only the damaged unit among the locked set is killed (429.1.a.1)", () => {
  const kernel = world()
    .unit("damaged-enemy", { owner: "B", location: { type: "battlefield", id: "bf-1" }, damage: 2 })
    .unit("clean-enemy", { owner: "B", location: { type: "battlefield", id: "bf-1" }, damage: 0 })
    .build();

  const run = runInstruction(
    kill,
    { target: "warwick.damaged-enemy-units-here", reason: "attack trigger" },
    { world: kernel, targets: { "warwick.damaged-enemy-units-here": [kernel.ref("damaged-enemy")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("damaged-enemy").zone, "trash");
  assert.equal(kernel.getObject("clean-enemy").zone, "board");
  assert.deepEqual(run.result.linkedValues.killed, [{ id: "damaged-enemy", zoneEntryId: 1 }]);
  // The reference kernel records the committed GameAction; zone-change timings
  // are derived by the event pipeline adapter, not by the primitive.
  assert.deepEqual(run.events.map(event => event.action), ["kill"]);
});

test("ogn-159-298 Warwick, Hunter: an empty damaged set makes the kill mistarget instead of a silent no-op", () => {
  const kernel = world().unit("clean-enemy", { owner: "B", damage: 0 }).build();
  const run = runInstruction(
    kill,
    { target: "warwick.damaged-enemy-units-here" },
    { world: kernel, targets: { "warwick.damaged-enemy-units-here": [] } }
  );

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.getObject("clean-enemy").zone, "board");
});

test.todo(
  "ogn-159-298 Warwick, Hunter: 'kill all damaged enemy units here' needs an untargeted set-kill form " +
    "(CR v1.5 355.10.d/355.10.d.1), a damage-marked ('damaged') filter predicate, a same-location " +
    "('here') anchor, and the 'attack-declared' emitter from the combat flow (combat/flow.ts still " +
    "throws combat-start-transaction)."
);
