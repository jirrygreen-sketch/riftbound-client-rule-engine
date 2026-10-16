import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/seal-of-focus.js";

const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { AwaitChoice } = await import(new URL("effects/contract.js", ENGINE));
const { bindResolveContext, createActionPipelineHost } = await import(new URL("events/action-adapter.js", ENGINE));
const { ChainEngine } = await import(new URL("chain/engine.js", ENGINE));
const { world } = await import(new URL("effects/testing/index.js", ENGINE));

const [seal, ability] = program.abilities;

function fixture() {
  const kernel = world()
    .player("A", { energy: 20 })
    .player("B", { energy: 20 })
    .unit("seal-of-focus", {
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
      source: kernel.getObject("seal-of-focus"),
      kind: "add",
      speed: "reaction",
      cost: { id: `${id}:cost`, cost: ability.cost },
      body: ability.body
    });
    while (engine.items.length) engine.pass(engine.priority);
  };
  return { engine, kernel, activate };
}

test("seal-of-focus: passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
});

test("seal-of-focus: identity, ruleset, status and printed text", () => {
  assert.equal(program.canonicalCardId, "card.hash-70378362a6ae7f5743042bfaa2d0a3ae223efaa8532f19d9aaad4ee8f6c47a1f");
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(
    program.sourceText,
    ":rb_exhaust:: [Reaction] — [Add] :rb_rune_calm:. (Abilities that add resources can't be reacted to.)"
  );
});

test("seal-of-focus: [Reaction] keyword plus one reaction-timed activated ability", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(seal, { kind: "keyword", keyword: "reaction" });
  assert.equal(ability.kind, "activated");
  // 813.1.c.2: Reaction permits activation in a Closed State, which the chain
  // engine reads from the ability's own speed.
  assert.equal(ability.timing, "reaction");
  assert.deepEqual(ability.cost, { kind: "activated", payments: [{ kind: "exhaust" }] });
});

test("seal-of-focus: body adds exactly one Calm Power and never energy", () => {
  assert.equal(ability.body.length, 1);
  const [instruction] = ability.body;
  assert.equal(instruction.id, "add-calm-power");
  assert.equal(instruction.op, "effect.resources");
  assert.deepEqual(instruction.args, { power: { kind: "constant", value: ["Calm"] } });
  assert.equal(instruction.args.energy, undefined);
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.picks, undefined);
  assert.equal(instruction.linkedTo, undefined);
});

test("seal-of-focus golden: the Add ability exhausts the gear and adds one Calm Power", () => {
  const { kernel, activate } = fixture();
  activate("seal-of-focus:activate");

  assert.equal(kernel.getObject("seal-of-focus").exhausted, true);
  assert.deepEqual(kernel.player("A").power, ["Calm"]);
  assert.equal(kernel.player("A").energy, 20);
  assert.deepEqual(
    kernel.events.map((event) => event.action).filter(Boolean),
    ["pay", "exhaust", "gain-power"]
  );
  // 430.2/430.2.a: the Add ability finalized and resolved immediately, so the
  // chain is empty and Priority was never handed to the opponent.
  assert.equal(kernel.events.filter((event) => event.action === "gain-power").length, 1);
});

test("seal-of-focus golden: an exhausted source cannot pay the exhaust cost (CR 415.4/415.1.b)", () => {
  const { engine, kernel, activate } = fixture();
  activate("seal-of-focus:activate");
  assert.equal(kernel.getObject("seal-of-focus").exhausted, true);

  assert.throws(
    () => engine.execute({
      id: "seal-of-focus:activate-again",
      controller: "A",
      source: kernel.getObject("seal-of-focus"),
      kind: "add",
      speed: "reaction",
      cost: { id: "seal-of-focus:cost-again", cost: ability.cost },
      body: ability.body
    }),
    (error) => error.name === "CostPlanError" && error.reason === "cannot-pay-cost"
  );
  assert.deepEqual(kernel.player("A").power, ["Calm"]);
});
