import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogs/flash.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
// card-dsl has no dependency edge on engine-core, so the chain-level evidence
// loads the built engine through its workspace layout instead of the package name.
import { AwaitChoice } from "../../../../engine-core/dist/effects/contract.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID = "card.hash-f3577cb543db90ce388e8461dd0e5f65b7d5b2f9ae4c4e497b104f4dc72539dd";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\nMove up to 2 friendly units to base.";

const [speed, play] = program.abilities;
const [moved] = play.body;
const targetSpec = moved.targets[0];

test("ogs-011-024 Flash: program passes validateCardProgram and is executable", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.status, "executable");
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("ogs-011-024 Flash: [Reaction] keyword plus one printed-cost play ability", () => {
  assert.equal(program.abilities.length, 2);
  // [Reaction] (813) is a speed keyword; the registry owns its expansion.
  assert.deepEqual(speed, { kind: "keyword", keyword: "reaction" });
  assert.equal(play.kind, "play");
  // Catalog printed cost: 2 energy, no printed Power.
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 }
  });
});

test("ogs-011-024 Flash: up-to-two friendly units targeted, moved to the controller's Base", () => {
  assert.equal(play.body.length, 1);
  assert.equal(moved.id, "flash.move");
  assert.equal(moved.op, "effect.move");
  assert.deepEqual(moved.args.objects, { kind: "constant", value: { target: "flash.friendly-units" } });
  // 107.1.c: each unit's Base is its controller's Base.
  assert.deepEqual(moved.args.to, { kind: "constant", value: "controller-base" });
  assert.deepEqual(moved.args.amount, { kind: "constant", value: 2 });
  assert.equal(moved.linkedTo, undefined);

  // 355.12: performing a game action on some number of objects makes every
  // chosen unit a target, chosen independently of the action.
  // 355.13: "up to 2" may choose zero, so min 0 with selection "up-to".
  assert.equal(moved.targets.length, 1);
  assert.equal(targetSpec.id, "flash.friendly-units");
  assert.deepEqual(targetSpec.filter, { type: "unit", controller: "self" });
  assert.equal(targetSpec.min, 0);
  assert.equal(targetSpec.max, 2);
  assert.equal(targetSpec.selection, "up-to");
});

test("ogs-011-024 Flash golden: both chosen units move to Base and keep their state", () => {
  const kernel = world()
    .unit("one", { owner: "A", might: 2, exhausted: true, location: { type: "battlefield", id: "bf-1" } })
    .unit("two", { owner: "A", might: 3, damage: 2, location: { type: "battlefield", id: "bf-2" } })
    .unit("enemy", { owner: "B", might: 4, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const run = runInstruction(
    move,
    { objects: moved.args.objects, to: moved.args.to, amount: moved.args.amount },
    { world: kernel, targets: { "flash.friendly-units": [kernel.ref("one"), kernel.ref("two")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.moved.count, 2);
  assert.deepEqual(kernel.getObject("one").location, { type: "base", player: "A" });
  assert.deepEqual(kernel.getObject("two").location, { type: "base", player: "A" });
  // An effect Move is not the Standard Move (no ready/exhaust) and not a Recall
  // (457-460): statuses and damage stay as they are.
  assert.equal(kernel.getObject("one").exhausted, true);
  assert.equal(kernel.getObject("two").damage, 2);
  assert.equal(kernel.getObject("two").exhausted, false);
  assert.deepEqual(kernel.getObject("enemy").location, { type: "battlefield", id: "bf-1" });
  assert.deepEqual(run.events.map((event) => event.action), ["move-location", "move-location"]);
});

test("ogs-011-024 Flash golden: only the still-legal member of a mistargeted group moves", () => {
  const kernel = world()
    .unit("staying", { owner: "A", location: { type: "battlefield", id: "bf-1" } })
    .unit("leaving", { owner: "A", location: { type: "battlefield", id: "bf-2" } })
    .build();
  const stale = kernel.ref("leaving");
  assert.equal(kernel.perform({ type: "return-to-hand", object: stale }).status, "done");
  const run = runInstruction(
    move,
    { objects: moved.args.objects, to: moved.args.to, amount: moved.args.amount },
    { world: kernel, targets: { "flash.friendly-units": [kernel.ref("staying"), stale] } }
  );
  // 359.3.e.12 / contract 3.6 rule 2: the dead reference drops out, the rest move.
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.moved.objects.map((ref) => ref.id), ["staying"]);
  assert.deepEqual(kernel.getObject("staying").location, { type: "base", player: "A" });
});

test("ogs-011-024 Flash golden: choosing zero units moves nothing and does not negate", () => {
  const kernel = world().unit("one", { owner: "A", location: { type: "battlefield", id: "bf-1" } }).build();
  const run = runInstruction(
    move,
    { objects: moved.args.objects, to: moved.args.to, amount: moved.args.amount },
    // 355.13: zero targets is a legal play of an "up to" effect.
    { world: kernel, targets: { "flash.friendly-units": [] } }
  );
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
  assert.deepEqual(run.events, []);
  assert.deepEqual(kernel.getObject("one").location, { type: "battlefield", id: "bf-1" });
});

test.todo(
  "Flash: admit the printed [Reaction] Closed State/Showdown timing through the keyword registry " +
    "(依赖 RIFT-89 continuous.timing 接线)"
);

test.todo(
  "Flash move pipeline obligations: destination restrictions, Contested status, and Move-triggered " +
    "Showdown/Combat staging (449.2, 452-454) belong to the turn/combat modules, not to this card"
);

test("ogs-011-024 Flash golden: the production chain locks both friendly-unit targets and moves them", () => {
  const kernel = world()
    .player("A", { energy: 20 })
    .player("B", { energy: 20 })
    .hand("flash", { name: "Flash", types: ["spell"], energy: 2, power: null })
    .unit("one", { owner: "A", might: 2, exhausted: true, location: { type: "battlefield", id: "bf-1" } })
    .unit("two", { owner: "A", might: 3, damage: 2, location: { type: "battlefield", id: "bf-2" } })
    .unit("enemy", { owner: "B", might: 4, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const source = kernel.getObject("flash");
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
    context: (sourceSnapshot, controller, timingPoint) => bindResolveContext(kernel, {
      source: sourceSnapshot, controller, timingPoint, choose: decide
    }),
    testTrigger: (registration) => kernel.test(registration.spec.condition)
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });

  engine.execute({
    id: "flash",
    controller: "A",
    source,
    kind: "spell",
    speed: "reaction",
    body: play.body,
    cost: { id: "flash:cost", cost: { kind: "printed" } }
  });
  while (engine.items.length) engine.pass(engine.priority);

  // The Finalize target system ran the card's own "up-to 2 friendly units"
  // requirement against the real query, then the body moved both units to Base.
  const targetRequest = requests.find((request) => request.id === "target:flash.friendly-units");
  assert.ok(targetRequest, "the Finalize target choice must run for the card's TargetSpec");
  assert.equal(targetRequest.min, 0);
  assert.equal(targetRequest.max, 2);
  assert.deepEqual(targetRequest.options.map((ref) => ref.id).sort(), ["one", "two"]);
  assert.deepEqual(kernel.getObject("one").location, { type: "base", player: "A" });
  assert.deepEqual(kernel.getObject("two").location, { type: "base", player: "A" });
  assert.deepEqual(kernel.getObject("enemy").location, { type: "battlefield", id: "bf-1" });
  assert.equal(kernel.getObject("one").exhausted, true);
  assert.equal(kernel.getObject("two").damage, 2);
  assert.equal(kernel.player("A").energy, 18);
  assert.equal(kernel.getObject("flash").zone, "trash");
});

test("ogs-011-024 Flash golden: with no friendly unit, choosing zero resolves without moving anything", () => {
  const kernel = world()
    .player("A", { energy: 20 })
    .player("B", { energy: 20 })
    .hand("flash", { name: "Flash", types: ["spell"], energy: 2, power: null })
    .unit("enemy", { owner: "B", might: 4, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const source = kernel.getObject("flash");
  const requests = [];
  const decide = (request) => {
    requests.push(request);
    if (request.type === "select-objects") return [];
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (checkpoint) => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    choose: decide,
    context: (sourceSnapshot, controller, timingPoint) => bindResolveContext(kernel, {
      source: sourceSnapshot, controller, timingPoint, choose: decide
    }),
    testTrigger: (registration) => kernel.test(registration.spec.condition)
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });

  engine.execute({
    id: "flash",
    controller: "A",
    source,
    kind: "spell",
    speed: "reaction",
    body: play.body,
    cost: { id: "flash:cost", cost: { kind: "printed" } }
  });
  while (engine.items.length) engine.pass(engine.priority);

  // 355.13: "up to" may choose zero, so the spell is still legal with no
  // candidate and no substitute target is invented.
  const targetRequest = requests.find((request) => request.id === "target:flash.friendly-units");
  assert.ok(targetRequest);
  assert.equal(targetRequest.min, 0);
  assert.equal(targetRequest.max, 0);
  assert.deepEqual(targetRequest.options, []);
  assert.deepEqual(kernel.getObject("enemy").location, { type: "battlefield", id: "bf-1" });
  assert.equal(kernel.player("A").energy, 18);
  assert.equal(kernel.getObject("flash").zone, "trash");
});
