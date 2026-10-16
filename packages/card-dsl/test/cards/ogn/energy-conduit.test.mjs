import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/energy-conduit.js";

const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { AwaitChoice } = await import(new URL("effects/contract.js", ENGINE));
const { bindResolveContext, createActionPipelineHost } = await import(new URL("events/action-adapter.js", ENGINE));
const { ChainEngine } = await import(new URL("chain/engine.js", ENGINE));
const { world } = await import(new URL("effects/testing/index.js", ENGINE));

const [reaction, ability] = program.abilities;

function fixture() {
  const kernel = world()
    .player("A", { energy: 20 })
    .player("B", { energy: 20 })
    .unit("energy-conduit", {
      types: ["gear"],
      might: null,
      energy: 3,
      power: null,
      zone: "board",
      location: { type: "base", player: "A" }
    })
    .build();
  const decide = (request) => { throw new AwaitChoice(request); };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (checkpoint) => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    choose: decide,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose: decide }),
    testTrigger: (registration) => kernel.test(registration.spec.condition)
  });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"],
    turnPlayer: "A",
    phase: "main",
    host,
    cleanup: () => false
  });
  const activate = (id) => {
    engine.execute({
      id,
      controller: "A",
      source: kernel.getObject("energy-conduit"),
      kind: "add",
      speed: "reaction",
      cost: { id: `${id}:cost`, cost: ability.cost },
      body: ability.body
    });
    while (engine.items.length) engine.pass(engine.priority);
  };
  return { engine, kernel, activate };
}

test("energy-conduit: passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
});

test("energy-conduit: identity, ruleset, status and printed text", () => {
  assert.equal(program.canonicalCardId, "card.hash-473f0936b54f6477d3322f55f1fe879abf504bfae19635447ff433313c86bb17");
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(
    program.sourceText,
    ":rb_exhaust:: [Reaction] — [Add] :rb_energy_1:. (Abilities that add resources can't be reacted to.)"
  );
});

test("energy-conduit: [Reaction] keyword plus one reaction-timed activated ability", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(reaction, { kind: "keyword", keyword: "reaction" });
  assert.equal(ability.kind, "activated");
  assert.equal(ability.timing, "reaction");
  assert.deepEqual(ability.cost, { kind: "activated", payments: [{ kind: "exhaust" }] });
});

test("energy-conduit: body adds exactly one Energy and never Power", () => {
  assert.equal(ability.body.length, 1);
  const [instruction] = ability.body;
  assert.equal(instruction.id, "add-energy-1");
  assert.equal(instruction.op, "effect.resources");
  assert.deepEqual(instruction.args, { energy: { kind: "constant", value: 1 } });
  assert.equal(instruction.args.power, undefined);
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.picks, undefined);
  assert.equal(instruction.linkedTo, undefined);
});

test("energy-conduit golden: the Add ability exhausts the gear and adds 1 Energy", () => {
  const { kernel, activate } = fixture();
  activate("energy-conduit:activate");

  assert.equal(kernel.getObject("energy-conduit").exhausted, true);
  assert.equal(kernel.player("A").energy, 21);
  assert.deepEqual(kernel.player("A").power, []);
  assert.deepEqual(
    kernel.events.map((event) => event.action).filter(Boolean),
    ["pay", "exhaust", "gain-energy"]
  );
});

test("energy-conduit golden: a replaced gain still reports the actual addition (CR 359.2.c)", () => {
  const { kernel, activate } = fixture();
  kernel.addReplacement((action) => action.type === "gain-energy" ? "prevented" : null);
  activate("energy-conduit:activate");

  // The exhaust cost is a cost, not the prevented effect: it still happened,
  // and the actual Energy addition is 0 (never the requested 1).
  assert.equal(kernel.getObject("energy-conduit").exhausted, true);
  assert.equal(kernel.player("A").energy, 20);
});

test("energy-conduit golden: an exhausted source cannot pay the exhaust cost (CR 415.4/415.1.b)", () => {
  const { engine, kernel, activate } = fixture();
  activate("energy-conduit:activate");

  assert.throws(
    () => engine.execute({
      id: "energy-conduit:activate-again",
      controller: "A",
      source: kernel.getObject("energy-conduit"),
      kind: "add",
      speed: "reaction",
      cost: { id: "energy-conduit:cost-again", cost: ability.cost },
      body: ability.body
    }),
    (error) => error.name === "CostPlanError" && error.reason === "cannot-pay-cost"
  );
  assert.equal(kernel.player("A").energy, 21);
});
