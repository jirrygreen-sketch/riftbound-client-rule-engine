import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/lecturing-yordle.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import tank from "../../../../engine-core/dist/effects/keywords/Tank.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-d5bee8c48f53404d08ff88d8472305114b39bc2f137cfb3e59c46e99340d0119";

// The program registry refuses judge-required programs, so the merged binding is
// exercised with the same IR under an executable status (sfd/honest-broker precedent).
// The shipped status and judgeReason are asserted separately and this override never
// describes the card as executable.
const executableIr = { ...program, status: "executable", judgeReason: undefined };

test("Lecturing Yordle program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Tank/);
  assert.match(program.judgeReason, /815/);
  assert.match(program.judgeReason, /continuous\.combat/);
  assert.match(program.judgeReason, /combat 分配消费方/);
  assert.match(program.judgeReason, /keywordPriority=proven-none/);
  assert.equal(
    program.sourceText,
    "[Tank] (I must be assigned combat damage first.)\nWhen you play me, draw 1."
  );
});

test("Lecturing Yordle: the declared [Tank] keyword matches the merged KeywordDef and its continuous.combat shape", () => {
  const registered = keywordDefinitionsById.get("Tank");
  assert.ok(registered, "effects/keywords/Tank.ts must be in the generated registry");
  assert.equal(program.abilities[0].keyword, registered.keyword.toLowerCase());
  assert.equal(registered.valued, false);
  assert.equal(registered.stacking, "single");
  const [expansion] = tank.expand({ host: { canonicalCardId: program.canonicalCardId } });
  assert.equal(expansion.kind, "static");
  assert.equal(expansion.effect.kind, "continuous.combat");
  assert.equal(expansion.effect.mode, "damage-assignment");
  assert.equal(expansion.effect.priority, "first");
  assert.equal(expansion.effect.damage, "lethal");
});

test("Lecturing Yordle structure: Tank keyword plus a mandatory self card-played draw", () => {
  assert.equal(program.abilities.length, 2);
  const [tank, triggered] = program.abilities;
  assert.deepEqual(tank, { kind: "keyword", keyword: "tank" });

  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.optional, false);
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, {
    event: "card-played",
    filter: { role: "self" }
  });

  assert.equal(triggered.body.length, 1);
  const [instruction] = triggered.body;
  assert.equal(instruction.id, "lecturing-yordle.draw-1");
  assert.equal(instruction.op, "effect.draw");
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.linkedTo, undefined);
});

test("Lecturing Yordle golden: the Draw 1 body draws exactly one card for the controller", () => {
  const kernel = world().deck(["top-card", "next-card"]).build();
  const instruction = program.abilities[1].body[0];
  const run = runInstruction(draw, { amount: instruction.args.amount }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(run.linked.drawnTo, "A");
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
});

test("Lecturing Yordle golden: an empty Main Deck draws as much as possible without inventing cards", () => {
  const kernel = world().build();
  const instruction = program.abilities[1].body[0];
  const run = runInstruction(draw, { amount: instruction.args.amount }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 0);
  assert.equal(kernel.player("A").handSize, 0);
});

test.todo(
  "Lecturing Yordle [Tank] (815): the unit must be assigned lethal damage before any other unit with the same " +
    "controller that does not have Tank, during the Combat Damage step (815.1.b / 815.1.c.2); the Tank KeywordDef " +
    "expands to a static continuous.combat requirement, but continuous.combat has no combat consumer " +
    "(combat/base-combat-allocation.ts binds no assignment priority)"
);

/** The real ChainEngine over the reference kernel plus the merged card-program binding. */
function fixture() {
  const kernel = world()
    .player("A", { energy: 20 })
    .player("B", { energy: 20 })
    .hand("lecturing-yordle", {
      cardId: program.canonicalCardId,
      types: ["unit"],
      energy: 3,
      power: [],
      might: 2,
      owner: "A"
    })
    // An array adds a top-to-bottom block, so "top-card" is really the top card.
    .deck(["top-card", "next-card"], { owner: "A" })
    .build();
  const decide = (request) => {
    if (request.type === "select-objects" && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    throw new Error(`Unexpected choice: ${request.id}`);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (checkpoint) => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    choose: decide,
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint, choose: decide }),
    testTrigger: (registration) => kernel.test(registration.spec.condition)
  });
  const binding = createProgramBinding({ cardPrograms: [executableIr] });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host,
    cleanup: () => false, describePlay: binding.describePlay
  });
  binding.attachLifecycle(engine);
  return { kernel, engine, binding };
}

const drain = (engine) => {
  let guard = 0;
  while (engine.items.length) {
    if (++guard > 50) throw new Error("Nonterminating test chain");
    engine.pass(engine.priority);
  }
};

test("Lecturing Yordle golden: playing me really fires the Play Effect and draws exactly 1 (383.4.a.2, 414.1)", () => {
  const { kernel, engine, binding } = fixture();
  const draft = binding.describePlay(
    { type: "play", object: kernel.ref("lecturing-yordle"), player: "A" },
    kernel.getObject("lecturing-yordle")
  );
  engine.execute({ ...draft, location: { type: "base", player: "A" } });
  engine.advance();
  drain(engine);

  // The unit really resolved onto the Board.  Competition for a board slot was not
  // required by the printed text, so "[Tank] (I must be assigned combat damage first.)"
  // (815.1.b) remains the judged part; the draw half is real here.
  assert.equal(kernel.getObject("lecturing-yordle").zone, "board");
  // "When you play me, draw 1" (383.4.a.2 / 414.1) drew exactly the top card.
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["top-card"]);
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
  const fired = engine.pipeline.events.map((event) => event.timingPoint);
  assert.equal(fired.includes("card-played"), true);
  assert.equal(fired.includes("card-drawn"), true);
  // The Play Effect entered the chain as its own item after the permanent resolved.
  assert.equal(
    engine.trace.some((entry) => entry.step === "pending" && entry.item.startsWith("trigger:")),
    true
  );
});

test("Lecturing Yordle: the card-played trigger registers from the CardProgram through the merged binding (RIFT-257)", () => {
  const { kernel, engine } = fixture();
  // Describe the play before executing it so the permanent reaches the Board via the real
  // resolver; the lifecycle hook registers the printed card-played trigger on entry.
  const source = kernel.getObject("lecturing-yordle");
  const registrations = [...engine.pipeline.checkpoint().triggers.values()]
    .filter((registration) => registration.source.cardId === program.canonicalCardId);
  assert.deepEqual(registrations, []);
  // Bind explicitly for the on-Board incarnation, as the lifecycle does on entry.
  const boardSource = { ...source, zone: "board", location: { type: "base", player: "A" } };
  const binding = createProgramBinding({ cardPrograms: [executableIr] });
  const ids = binding.registerProgramTriggers(engine, boardSource);
  assert.deepEqual(ids, ["program:lecturing-yordle:1:1"]);
  const [registration] = [...engine.pipeline.checkpoint().triggers.values()]
    .filter((entry) => entry.id === ids[0]);
  assert.equal(registration.spec.at, "card-played");
  assert.deepEqual(registration.spec.filter, { event: "card-played", object: { objectId: "lecturing-yordle" } });
  assert.deepEqual(registration.activeZones, ["board"]);
});
