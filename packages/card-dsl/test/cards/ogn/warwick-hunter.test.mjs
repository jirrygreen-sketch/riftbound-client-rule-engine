import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/warwick-hunter.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

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

test("ogn-159-298 Warwick, Hunter: judgeReason cites the entry replacement, the set kill and the damaged predicate", () => {
  assert.match(program.judgeReason, /replacement\.enter/);
  assert.match(program.judgeReason, /effect\.kill/);
  assert.match(program.judgeReason, /damaged/);
  assert.match(program.judgeReason, /355\.10\.d/);
});

test("ogn-159-298 Warwick, Hunter: 'I enter ready.' is an entry replacement that readies the source (369.3 / 359.2.c)", () => {
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
  assert.equal(body.op, "effect.ready");
  assert.deepEqual(body.args, { objects: { kind: "constant", value: { kind: "source" } } });
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

test("ogn-159-298 Warwick, Hunter: 'I enter ready.' readies an exhausted source through the merged primitive", () => {
  const kernel = world().unit("warwick", { exhausted: true }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("warwick") });
  const run = runInstruction(
    ready,
    entryReplacement.with[0].args,
    { world: scoped }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(scoped.getObject("warwick").exhausted, false);
  assert.deepEqual(run.events.map(event => event.action), ["ready"]);
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
  "ogn-159-298 Warwick, Hunter: the board-entry replacement (369.3, contrast 359.2.c) needs the " +
    "replacement.enter pipeline that consumes a card's replacement ability, sharing the 805.6.a " +
    "no-becomes-ready semantics with the Accelerate expansion."
);
test.todo(
  "ogn-159-298 Warwick, Hunter: 'kill all damaged enemy units here' needs an untargeted set-kill form " +
    "(CR v1.5 355.10.d/355.10.d.1), a damage-marked ('damaged') filter predicate, a same-location " +
    "('here') anchor, and the 'attack-declared' emitter from the combat flow."
);
