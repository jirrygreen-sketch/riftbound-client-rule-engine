import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/seal-of-insight.js";

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
    .unit("seal-of-insight", {
      types: ["gear"],
      might: null,
      energy: 0,
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
      source: kernel.getObject("seal-of-insight"),
      kind: "add",
      speed: "reaction",
      cost: { id: `${id}:cost`, cost: ability.cost },
      body: ability.body
    });
    while (engine.items.length) engine.pass(engine.priority);
  };
  return { engine, kernel, activate };
}

test("seal-of-insight: passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
});

test("seal-of-insight: identity, ruleset, status and printed text", () => {
  assert.equal(program.canonicalCardId, "card.hash-a41c686d3553081cc015c66b8ebd61f0bfebe21c4b5ceee94b4addbab1166722");
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(
    program.sourceText,
    ":rb_exhaust:: [Reaction] — [Add] :rb_rune_mind:. (Abilities that add resources can't be reacted to.)"
  );
});

test("seal-of-insight: [Reaction] keyword plus one reaction-timed activated ability", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(reaction, { kind: "keyword", keyword: "reaction" });
  assert.equal(ability.kind, "activated");
  assert.equal(ability.timing, "reaction");
  assert.deepEqual(ability.cost, { kind: "activated", payments: [{ kind: "exhaust" }] });
});

test("seal-of-insight: body adds exactly one Mind Power and never energy", () => {
  assert.equal(ability.body.length, 1);
  const [instruction] = ability.body;
  assert.equal(instruction.id, "add-mind-power");
  assert.equal(instruction.op, "effect.resources");
  assert.deepEqual(instruction.args, { power: { kind: "constant", value: ["Mind"] } });
  assert.equal(instruction.args.energy, undefined);
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.picks, undefined);
  assert.equal(instruction.linkedTo, undefined);
});

test("seal-of-insight golden: the Add ability exhausts the gear and adds one Mind Power", () => {
  const { kernel, activate } = fixture();
  activate("seal-of-insight:activate");

  assert.equal(kernel.getObject("seal-of-insight").exhausted, true);
  assert.deepEqual(kernel.player("A").power, ["Mind"]);
  assert.equal(kernel.player("A").energy, 20);
  assert.deepEqual(
    kernel.events.map((event) => event.action).filter(Boolean),
    ["pay", "exhaust", "gain-power"]
  );
});

test("seal-of-insight golden: a prevented Power gain does not become Energy or a different domain (CR 163.2.a)", () => {
  const { kernel, activate } = fixture();
  kernel.addReplacement((action) => action.type === "gain-power" ? "prevented" : null);
  activate("seal-of-insight:activate");

  assert.equal(kernel.getObject("seal-of-insight").exhausted, true);
  assert.deepEqual(kernel.player("A").power, []);
  assert.equal(kernel.player("A").energy, 20);
});

test("seal-of-insight golden: an exhausted source cannot pay the exhaust cost (CR 415.4/415.1.b)", () => {
  const { engine, kernel, activate } = fixture();
  activate("seal-of-insight:activate");

  assert.throws(
    () => engine.execute({
      id: "seal-of-insight:activate-again",
      controller: "A",
      source: kernel.getObject("seal-of-insight"),
      kind: "add",
      speed: "reaction",
      cost: { id: "seal-of-insight:cost-again", cost: ability.cost },
      body: ability.body
    }),
    (error) => error.name === "CostPlanError" && error.reason === "cannot-pay-cost"
  );
  assert.deepEqual(kernel.player("A").power, ["Mind"]);
});
