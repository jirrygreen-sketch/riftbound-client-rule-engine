import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/arena-bar.js";

// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { AwaitChoice } = await import(new URL("effects/contract.js", ENGINE));
const { bindResolveContext, createActionPipelineHost } = await import(new URL("events/action-adapter.js", ENGINE));
const { ChainEngine } = await import(new URL("chain/engine.js", ENGINE));
const { world } = await import(new URL("effects/testing/index.js", ENGINE));

const [ability] = program.abilities;

/** A real ChainEngine over the reference kernel, as the merged chain tests do. */
function fixture() {
  const kernel = world()
    .player("A", { energy: 20 })
    .player("B", { energy: 20 })
    .unit("arena-bar", {
      types: ["gear"],
      might: null,
      energy: 3,
      power: null,
      zone: "board",
      location: { type: "base", player: "A" }
    })
    .unit("exhausted-ally", { exhausted: true, might: 2, buffs: 0 })
    .unit("ready-ally", { exhausted: false, might: 2, buffs: 0 })
    .build();
  const requests = [];
  const decide = (request) => {
    requests.push(request);
    // "Buff an exhausted friendly unit": only one legal unit, so lock it.
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
      source: kernel.getObject("arena-bar"),
      kind: "activated",
      speed: "action",
      cost: { id: `${id}:cost`, cost: ability.cost },
      body: ability.body
    });
    while (engine.items.length) engine.pass(engine.priority);
  };
  return { engine, kernel, requests, activate };
}

test("arena-bar: passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
});

test("arena-bar: identity, ruleset, status and printed text", () => {
  assert.equal(program.canonicalCardId, "card.hash-37383a14ededcbaee2260e042ca4d77c596e88247ee1ca23ff0256f8eb8e3982");
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(
    program.sourceText,
    ":rb_exhaust:: Buff an exhausted friendly unit. (If it doesn't have a buff, it gets a +1 :rb_might: buff.)"
  );
});

test("arena-bar: one action-speed activated ability whose whole cost is the exhaust symbol", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "activated");
  assert.equal(ability.timing, "action");
  assert.equal(ability.restriction, undefined);
  // ":rb_exhaust:" — the cost "Exhaust this" (CR 415.5), paid against the host.
  assert.deepEqual(ability.cost, { kind: "activated", payments: [{ kind: "exhaust" }] });
});

test("arena-bar: body is one effect.buff targeting exactly one exhausted friendly unit", () => {
  assert.equal(ability.body.length, 1);
  const [instruction] = ability.body;
  assert.equal(instruction.id, "buff-exhausted-friendly-unit");
  assert.equal(instruction.op, "effect.buff");
  assert.deepEqual(instruction.args.mode, { kind: "constant", value: "buff" });
  assert.deepEqual(instruction.args.target, { kind: "constant", value: "exhausted-friendly-unit" });
  assert.equal(instruction.linkedTo, undefined);
  assert.equal(instruction.picks, undefined);
  assert.equal(instruction.targets.length, 1);
  const [target] = instruction.targets;
  // The target is the ability controller's own unit (355.10.a.2) restricted to
  // the exhausted state (355.9.b).
  assert.deepEqual(target.filter, { type: "unit", controller: "self", states: "exhausted" });
  assert.equal(target.min, 1);
  assert.equal(target.max, 1);
  assert.equal(target.selection, "one");
});

test("arena-bar golden: activating exhausts the gear, pays the cost and buffs the exhausted friendly unit", () => {
  const { kernel, requests, activate } = fixture();
  activate("arena-bar:activate");

  // The exhaust cost was paid against the source gear (415.4/415.5).
  assert.equal(kernel.getObject("arena-bar").exhausted, true);
  // The Buff landed on the exhausted friendly unit only (427.1.b, 355.9.b).
  assert.equal(kernel.getObject("exhausted-ally").buffs, 1);
  assert.equal(kernel.getObject("ready-ally").buffs, 0);
  // Real action order: pay, exhaust the source, then place the Buff.
  assert.deepEqual(
    kernel.events.map((event) => event.action).filter(Boolean),
    ["pay", "exhaust", "buff"]
  );
  // The Finalize TargetPlan asked for the one legal, still-legal target.
  assert.equal(requests.length, 1);
  assert.equal(requests[0].type, "select-objects");
  assert.equal(requests[0].id, "target:exhausted-friendly-unit");
  assert.deepEqual(requests[0].options.map((ref) => ref.id), ["exhausted-ally"]);
});

test("arena-bar golden: a unit that already has a Buff is not buffed again (CR 427.1.b.1)", () => {
  const { kernel, activate } = fixture();
  assert.equal(kernel.perform({ type: "buff", object: kernel.ref("exhausted-ally"), amount: 1 }).status, "done");
  assert.equal(kernel.getObject("exhausted-ally").buffs, 1);

  activate("arena-bar:activate");
  // The gear still exhausted and paid; the second Buff simply was not placed.
  assert.equal(kernel.getObject("arena-bar").exhausted, true);
  assert.equal(kernel.getObject("exhausted-ally").buffs, 1);
});

test("arena-bar golden: an exhausted source cannot pay the exhaust cost again (CR 415.4/415.1.b)", () => {
  const { engine, kernel, activate } = fixture();
  activate("arena-bar:activate");
  assert.equal(kernel.getObject("arena-bar").exhausted, true);

  assert.throws(
    () => engine.execute({
      id: "arena-bar:activate-again",
      controller: "A",
      source: kernel.getObject("arena-bar"),
      kind: "activated",
      speed: "action",
      cost: { id: "arena-bar:cost-again", cost: ability.cost },
      body: ability.body
    }),
    (error) => error.name === "CostPlanError" && error.reason === "cannot-pay-cost"
  );
  assert.equal(kernel.getObject("exhausted-ally").buffs, 1);
});

test("arena-bar golden: with no exhausted friendly unit the activation is not legal (CR 403.3)", () => {
  const { engine, kernel } = fixture();
  assert.equal(kernel.perform({ type: "ready", object: kernel.ref("exhausted-ally") }).status, "done");

  assert.throws(
    () => engine.execute({
      id: "arena-bar:no-target",
      controller: "A",
      source: kernel.getObject("arena-bar"),
      kind: "activated",
      speed: "action",
      cost: { id: "arena-bar:cost-no-target", cost: ability.cost },
      body: ability.body
    }),
    (error) => error.name === "TargetSelectionError" && error.code === "no-legal-targets"
  );
  // Finalize failed before any payment, so the source is untouched (203.3).
  assert.equal(kernel.getObject("arena-bar").exhausted, false);
});
