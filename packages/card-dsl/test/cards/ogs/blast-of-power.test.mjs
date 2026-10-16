import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogs/blast-of-power.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
// card-dsl has no dependency edge on engine-core, so the chain-level evidence
// loads the built engine through its workspace layout instead of the package name.
import { AwaitChoice } from "../../../../engine-core/dist/effects/contract.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";

const CANONICAL_ID = "card.hash-4e761253721b822594d16215714c20c98ba8e0ef48a65272bcea3a3f02252ac7";
const SOURCE_TEXT = "[Action] (Play on your turn or in showdowns.)\nKill a unit at a battlefield.";

const [speed, play] = program.abilities;
const [killed] = play.body;

test("ogs-012-024 Blast of Power: program passes validateCardProgram and is executable", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.status, "executable");
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("ogs-012-024 Blast of Power: [Action] keyword plus the printed 6 energy + 1 Order power cost", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(speed, { kind: "keyword", keyword: "action" });
  assert.equal(play.kind, "play");
  // Catalog printed cost: 6 energy and 1 Power; the Power is printed as a
  // single-domain requirement, so the value stays a scalar (not a domain list).
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 6 },
    power: { kind: "constant", value: 1 }
  });
});

test("ogs-012-024 Blast of Power: one targeted kill restricted to battleground units", () => {
  assert.equal(play.body.length, 1);
  assert.equal(killed.id, "blast-of-power.kill");
  assert.equal(killed.op, "effect.kill");
  // "Kill a unit at a battlefield" targets the unit (355.9.a.1, 355.10.b); the
  // location is a targeting restriction, not a battlefield target.
  assert.deepEqual(killed.args.target, { kind: "constant", value: "battlefield-unit" });
  assert.equal(killed.linkedTo, undefined);
  assert.equal(killed.targets.length, 1);
  const [spec] = killed.targets;
  assert.equal(spec.id, "battlefield-unit");
  assert.deepEqual(spec.filter, { type: "unit", location: "battlefield" });
  assert.equal(spec.min, 1);
  assert.equal(spec.max, 1);
  assert.equal(spec.selection, "one");
});

test("ogs-012-024 Blast of Power: the recorded restriction matches battlefield units only", () => {
  const base = {
    ref: { id: "x", zoneEntryId: 1 },
    cardId: "card:x",
    name: "x",
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    might: 1,
    energy: null,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  };
  assert.equal(matchesObjectFilter(killed.targets[0].filter, { ...base, location: { type: "battlefield", id: "bf-1" } }), true);
  assert.equal(matchesObjectFilter(killed.targets[0].filter, { ...base, location: { type: "base", player: "A" } }), false);
});

test("ogs-012-024 Blast of Power golden: effect.kill sends the battleground unit to the trash", () => {
  const kernel = world()
    .unit("bf-unit", { owner: "B", might: 3, location: { type: "battlefield", id: "bf-1" } })
    .base("base-unit", { owner: "B", might: 3 })
    .build();
  const run = runInstruction(
    kill,
    { target: "battlefield-unit" },
    { world: kernel, targets: { "battlefield-unit": [kernel.ref("bf-unit")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("bf-unit").zone, "trash");
  assert.equal(kernel.getObject("base-unit").zone, "board");
  assert.deepEqual(run.linked.killed.map((ref) => ref.id), ["bf-unit"]);
  assert.deepEqual(run.events.map((event) => event.action), ["kill"]);
});

test("ogs-012-024 Blast of Power golden: a stale reference (unit left the Board) is mistargeted", () => {
  const kernel = world().unit("bf-unit", { owner: "B", might: 3 }).build();
  const stale = kernel.ref("bf-unit");
  assert.equal(kernel.perform({ type: "return-to-hand", object: stale }).status, "done");
  const run = runInstruction(
    kill,
    { target: "battlefield-unit" },
    { world: kernel, targets: { "battlefield-unit": [stale] } }
  );
  // Contract 3.4 / 3.6 primitive rule 2: every target reference is gone -> ignored.
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
  assert.deepEqual(run.events, []);
  assert.equal(kernel.getObject("bf-unit").zone, "hand");
});

test.todo(
  "Blast of Power: enforce the printed [Action] Showdown timing permission through the keyword registry " +
    "(依赖 RIFT-89 continuous.timing 接线) and exclude Pending chain items from the target choice (RIFT-90)"
);

test.todo(
  "Blast of Power death pipeline: 429.5 attribution and the object-killed timing point (Deathknell, " +
    "replacement effects) are emitted by the engine, not by this card"
);

function blastOfPowerChain(kernel, selected) {
  const source = kernel.getObject("blast-of-power");
  const requests = [];
  const decide = (request) => {
    requests.push(request);
    if (request.type === "select-objects" && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
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
    id: "blast-of-power",
    controller: "A",
    source,
    kind: "spell",
    speed: "action",
    body: play.body,
    cost: { id: "blast-of-power:cost", cost: { kind: "printed" } },
    ...(selected === undefined ? {} : {
      targets: [{ requirement: killed.targets[0], options: { selected } }]
    })
  });
  return { engine, requests };
}

test("ogs-012-024 Blast of Power golden: the production chain charges 6 energy + 1 Order power and kills", () => {
  const kernel = world()
    .player("A", { energy: 20, power: ["Order"] })
    .player("B", { energy: 20 })
    .hand("blast-of-power", { name: "Blast of Power", types: ["spell"], energy: 6, power: ["Order"] })
    .unit("bf-unit", { owner: "B", might: 3, location: { type: "battlefield", id: "bf-1" } })
    .base("base-unit", { owner: "B", might: 3 })
    .build();
  const { engine } = blastOfPowerChain(kernel, [kernel.ref("bf-unit")]);
  while (engine.items.length) engine.pass(engine.priority);

  assert.equal(kernel.getObject("bf-unit").zone, "trash");
  assert.equal(kernel.getObject("base-unit").zone, "board");
  assert.equal(kernel.player("A").energy, 14);
  assert.equal(kernel.getObject("blast-of-power").zone, "trash");
});

test("ogs-012-024 Blast of Power golden: a unit recalled to Base in response is no longer killable", () => {
  const kernel = world()
    .player("A", { energy: 20, power: ["Order"] })
    .player("B", { energy: 20 })
    .hand("blast-of-power", { name: "Blast of Power", types: ["spell"], energy: 6, power: ["Order"] })
    .unit("bf-unit", { owner: "B", might: 3, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const { engine } = blastOfPowerChain(kernel, [kernel.ref("bf-unit")]);
  // The spell is on the chain and its target is locked; the unit leaves the
  // battlefield before resolution (355.11.b, 359.3.e.12).
  assert.equal(engine.commit({ type: "move-location", object: kernel.ref("bf-unit"), to: { type: "base", player: "B" } }).status, "done");
  engine.advance();
  while (engine.items.length) engine.pass(engine.priority);

  // The kill fails: the unit is still on the Board but no longer matches "at a
  // battlefield", so it is not killed and no substitute target is chosen.
  assert.equal(kernel.getObject("bf-unit").zone, "board");
  assert.deepEqual(kernel.getObject("bf-unit").location, { type: "base", player: "B" });
  assert.equal(kernel.getObject("blast-of-power").zone, "trash");
  assert.ok(!kernel.events.some((event) => event.action === "kill"));
});
