import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/seal-of-discord.js";

// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { AwaitChoice } = await import(new URL("effects/contract.js", ENGINE));
const { bindResolveContext, createActionPipelineHost } = await import(new URL("events/action-adapter.js", ENGINE));
const { ChainEngine } = await import(new URL("chain/engine.js", ENGINE));
const { world } = await import(new URL("effects/testing/index.js", ENGINE));

const [reaction, ability] = program.abilities;

/** Real chain fixture: Seal of Discord on the board, both players stocked. */
function fixture() {
  const kernel = world()
    .player("A", { energy: 20 })
    .player("B", { energy: 20 })
    .base("seal-of-discord", {
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
  // CR 430.2 / 430.2.a: an activated Add ability finalizes and resolves
  // immediately without passing Priority or Focus, so the Add chain item is
  // submitted through the chain's own Add kind (the merged Reaction Add gate
  // is 430.3's `activateAddDuringPayment`).
  const activate = (id) => {
    engine.execute({
      id,
      controller: "A",
      source: kernel.getObject("seal-of-discord"),
      kind: "add",
      speed: "reaction",
      cost: { id: `${id}:cost`, cost: ability.cost },
      body: ability.body
    });
    while (engine.items.length) engine.pass(engine.priority);
  };
  return { engine, kernel, activate };
}

test("seal-of-discord: passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
});

test("seal-of-discord: identity, ruleset, status and printed text", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-00db977a8e2688acd3c32aa05d515415a821d541bbe0196f8247bb9e69b4433f"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(
    program.sourceText,
    ":rb_exhaust:: [Reaction] — [Add] :rb_rune_chaos:. (Abilities that add resources can't be reacted to.)"
  );
});

test("seal-of-discord: [Reaction] keyword plus one reaction-timed activated ability", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(reaction, { kind: "keyword", keyword: "reaction" });
  assert.equal(ability.kind, "activated");
  assert.equal(ability.timing, "reaction");
  // CR 415.4 / 415.5: the leading :rb_exhaust: symbol is the cost "Exhaust this".
  assert.deepEqual(ability.cost, { kind: "activated", payments: [{ kind: "exhaust" }] });
});

test("seal-of-discord: the body adds exactly one Chaos Power and never Energy", () => {
  assert.equal(ability.body.length, 1);
  const [instruction] = ability.body;
  assert.equal(instruction.id, "seal-of-discord.add-chaos");
  assert.equal(instruction.op, "effect.resources");
  assert.deepEqual(instruction.args.power, { kind: "constant", value: ["Chaos"] });
  assert.equal(instruction.args.energy, undefined);
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.picks, undefined);
  assert.equal(instruction.linkedTo, undefined);
  assert.equal(instruction.condition, undefined);
});

test("seal-of-discord golden: the Add ability exhausts the gear and adds one Chaos Power", () => {
  const { kernel, activate } = fixture();
  activate("seal-of-discord:activate");

  assert.equal(kernel.getObject("seal-of-discord").exhausted, true);
  assert.deepEqual(kernel.player("A").power, ["Chaos"]);
  assert.equal(kernel.player("A").energy, 20);
  assert.deepEqual(
    kernel.events.map((event) => event.action).filter(Boolean),
    ["pay", "exhaust", "gain-power"]
  );
});

test("seal-of-discord golden: a prevented Power gain does not become Energy or another domain", () => {
  const { kernel, activate } = fixture();
  kernel.addReplacement((action) => action.type === "gain-power" ? "prevented" : null);
  activate("seal-of-discord:activate");

  assert.equal(kernel.getObject("seal-of-discord").exhausted, true);
  assert.deepEqual(kernel.player("A").power, []);
  assert.equal(kernel.player("A").energy, 20);
});

test("seal-of-discord golden: an exhausted source cannot pay the exhaust cost (CR 415.4 / 415.1.b)", () => {
  const { engine, kernel, activate } = fixture();
  activate("seal-of-discord:activate");

  assert.throws(
    () => engine.execute({
      id: "seal-of-discord:activate-again",
      controller: "A",
      source: kernel.getObject("seal-of-discord"),
      kind: "add",
      speed: "reaction",
      cost: { id: "seal-of-discord:cost-again", cost: ability.cost },
      body: ability.body
    }),
    (error) => error.name === "CostPlanError" && error.reason === "cannot-pay-cost"
  );
  assert.deepEqual(kernel.player("A").power, ["Chaos"]);
});

test.todo(
  "seal-of-discord: 430.2 immediate finalize with Priority/Focus suspended and the 430.3 " +
    "Add-Reaction window during cost payment (chain Add path is merged; the turn/priority owner that " +
    "drives it from a real game state is RIFT-120 follow-up wiring)"
);
