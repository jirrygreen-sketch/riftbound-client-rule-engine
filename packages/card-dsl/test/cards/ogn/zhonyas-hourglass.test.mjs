import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/zhonyas-hourglass.js";

// card-dsl has no dependency edge on engine-core, so golden execution loads
// the built engine through its workspace layout.
const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { runInstruction } = await import(new URL("effects/testing/run-instruction.js", ENGINE));
const { world } = await import(new URL("effects/testing/index.js", ENGINE));
const { resolveChainBody } = await import(new URL("chain/interpreter-adapter.js", ENGINE));
const { default: kill } = await import(new URL("effects/instructions/effect.kill.js", ENGINE));
const { default: move } = await import(new URL("effects/instructions/effect.move.js", ENGINE));
const { AwaitChoice } = await import(new URL("effects/contract.js", ENGINE));
const { bindResolveContext, createActionPipelineHost } = await import(new URL("events/action-adapter.js", ENGINE));
const { ChainEngine } = await import(new URL("chain/engine.js", ENGINE));

const [hidden, replacement] = program.abilities;
const [killThis, recall, exhaust] = replacement.with;
const literal = (value) => ({ kind: "constant", value });

test("zhonyas-hourglass: passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
});

test("zhonyas-hourglass: identity, ruleset, status and printed text", () => {
  assert.equal(program.canonicalCardId, "card.hash-876fbb11303be19701acffe6831c8d2c74d73130b38f29962ed2cef06bc76387");
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // The reason must name the missing primitive and the missing rule basis.
  assert.match(program.judgeReason, /Recall/);
  assert.match(program.judgeReason, /effect\.move/);
  assert.match(program.judgeReason, /369\.1/);
  assert.equal(
    program.sourceText,
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
      "The next time a friendly unit would die, kill this instead. Recall that unit exhausted. (Send it to base. This isn't a move.)"
  );
});

test("zhonyas-hourglass: [Hidden] keyword plus one replacement ability", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(hidden, { kind: "keyword", keyword: "hidden" });
  assert.equal(replacement.kind, "replacement");
  // "The next time a friendly unit would die" — the intercepted event is the
  // death of a unit the controller controls (369.1 / 370.1.a.1).
  assert.deepEqual(replacement.replaces, { event: "object-killed", filter: { type: "unit", controller: "self" } });
  assert.equal(replacement.condition, undefined);
});

test("zhonyas-hourglass: replacement body is kill-this, recall-that-unit, exhaust-that-unit", () => {
  assert.deepEqual(replacement.with.map((instruction) => instruction.id), [
    "kill-this",
    "recall-dying-unit",
    "exhaust-dying-unit"
  ]);

  // "kill this instead" — the replacement kills the source gear itself.
  assert.equal(killThis.op, "effect.kill");
  assert.deepEqual(killThis.args, { self: literal(true) });
  assert.equal(killThis.targets, undefined);

  // "Recall that unit" — 457/458: a Recall is not a Move, so the instruction
  // asks for mode "recall" and names the intercepted unit (355.10.c).
  assert.equal(recall.op, "effect.move");
  assert.deepEqual(recall.args.mode, literal("recall"));
  assert.deepEqual(recall.args.to, literal("controller-base"));
  assert.deepEqual(recall.args.objects, literal({ target: "dying-unit" }));
  assert.deepEqual(recall.targets, [
    { id: "dying-unit", filter: { type: "unit", controller: "self" }, min: 1, max: 1, selection: "one" }
  ]);

  // "Recall that unit exhausted" states the 460.1 exception: the recall sets
  // the status, and "that unit" is the same referent as the recall.
  assert.equal(exhaust.op, "effect.exhaust");
  assert.deepEqual(exhaust.args, { target: literal("dying-unit") });
  assert.equal(exhaust.targets, undefined);
});

test("zhonyas-hourglass golden: the kill-this half executes through effect.kill self", () => {
  const kernel = world()
    .unit("zhonyas-hourglass", { types: ["gear"], zone: "board", location: { type: "base", player: "A" } })
    .unit("friendly-unit", { zone: "board", location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("zhonyas-hourglass") });

  const run = runInstruction(kill, { self: true }, { world: context });
  assert.equal(run.result.status, "executed");
  assert.equal(context.getObject("zhonyas-hourglass").zone, "trash");
  // The intercepted unit is untouched: this half only kills the gear.
  assert.equal(context.getObject("friendly-unit").zone, "board");
  assert.deepEqual(run.linked.killed.map((ref) => ref.id), ["zhonyas-hourglass"]);
});

test("zhonyas-hourglass golden: the recall half is blocked, never approximated as a Move", () => {
  const kernel = world()
    .player("A", { energy: 20 })
    .player("B", { energy: 20 })
    .unit("zhonyas-hourglass", { types: ["gear"], zone: "board", location: { type: "base", player: "A" } })
    .unit("friendly-unit", { zone: "board", location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const requests = [];
  const decide = (request) => {
    requests.push(request);
    if (request.type === "select-objects") return [...request.options];
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (checkpoint) => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    choose: decide,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose: decide }),
    testTrigger: (registration) => kernel.test(registration.spec.condition)
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  // The replacement body's recall half, run as the real chain body so the
  // Finalize TargetPlan resolves the card's own "dying-unit" specification.
  engine.execute({
    id: "zhonyas-hourglass:recall",
    controller: "A",
    source: kernel.getObject("zhonyas-hourglass"),
    kind: "activated",
    speed: "action",
    body: [recall]
  });
  while (engine.items.length) engine.pass(engine.priority);

  // Finalize resolved "that unit" through the card's own target spec.
  assert.equal(requests.length, 1);
  assert.equal(requests[0].id, "target:dying-unit");
  assert.deepEqual(requests[0].options.map((ref) => ref.id), ["friendly-unit"]);
  // effect.move refuses mode "recall": no substitute Move was submitted, and
  // the printed "exhausted" status was not applied either.
  assert.equal(kernel.events.some((event) => event.action === "move-location"), false);
  assert.deepEqual(kernel.getObject("friendly-unit").location, { type: "battlefield", id: "battlefield-1" });
  assert.equal(kernel.getObject("friendly-unit").exhausted, false);

  // Isolated primitive receipt: the block is reported, not silently dropped.
  const run = runInstruction(
    move,
    { objects: recall.args.objects, to: recall.args.to, mode: recall.args.mode },
    { world: kernel, targets: { "dying-unit": [kernel.ref("friendly-unit")] } }
  );
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.match(run.linked.moved.blockedReason, /Recall/);
});

test.todo(
  "zhonyas-hourglass: card-level replacement registration (intercept a friendly unit's death, bind 'that unit' into the replacement body, and honor the printed 'the next time' one-shot lifetime) needs the engine replacement/chain owner (RIFT-120) to consume CardProgram replaces/with."
);

test.todo(
  "zhonyas-hourglass: a real Recall (457–460) plus the printed 'exhausted' status exception (460.1) needs a recall GameAction distinct from move-location; effect.move deliberately blocks the approximation."
);
