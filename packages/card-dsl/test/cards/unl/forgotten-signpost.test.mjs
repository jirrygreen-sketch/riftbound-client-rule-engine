import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/forgotten-signpost.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import { buildCostPlan, payCostPlan } from "../../../../engine-core/dist/cost/index.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-a6a251b556aa4fc7a6c80ebb32af7c401203008d9b475d8097cfe1f9b416ed90";
const SOURCE_TEXT =
  "[Action][>] Exhaust a unit you control, :rb_exhaust:: Move a different unit you control " +
  "to the location of the unit you exhausted to pay for this ability.";

const [ability] = program.abilities;
const [moveInstruction] = ability.body;
const targetSpec = moveInstruction.targets[0];

test("unl-045-219 Forgotten Signpost: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /355\.4/);
  assert.match(program.judgeReason, /RIFT-89|RIFT-90/);
});

test("unl-045-219 Forgotten Signpost: identity, ruleset, status and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.sourceText, SOURCE_TEXT);
  // The generated registry indexes the program by this exact identity.
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("unl-045-219 Forgotten Signpost: [Action] activated ability whose cost is exhaust-unit + exhaust-self", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "activated");
  // 813.1.d: the printed "[Action][>]" is the ability's own speed permission.
  assert.equal(ability.timing, "action");

  // 377.1 / 404.1.a: everything before the ":" is the cost.
  assert.deepEqual(ability.cost.payments.map((payment) => payment.kind), ["exhaust", "exhaust"]);
  const [exhaustUnit, exhaustSelf] = ability.cost.payments;
  // 355.10.c / 355.10.c.1: "Exhaust a unit you control" is a cost within instructions, so
  // the paid object is a non-target choice, never a TargetSpec.
  assert.equal(exhaustUnit.choice.id, "forgotten-signpost.exhausted-unit");
  assert.deepEqual(exhaustUnit.choice.filter, {
    type: "unit",
    controller: "controller",
    zone: "board"
  });
  assert.deepEqual(
    [exhaustUnit.choice.min, exhaustUnit.choice.max, exhaustUnit.choice.selection],
    [1, 1, "one"]
  );
  assert.deepEqual(exhaustUnit.amount, { kind: "constant", value: 1 });
  // 415.3.a / 415.5: ", :rb_exhaust:" is the second cost, the source itself.
  assert.deepEqual(exhaustSelf, { kind: "exhaust", object: "self" });
});

test("unl-045-219 Forgotten Signpost: the moved unit is a target and the destination is the cost choice", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(moveInstruction.id, "forgotten-signpost.move-unit");
  assert.equal(moveInstruction.op, "effect.move");
  // 355.10 / 355.9.a.1: "unit" means a Board object and the player chooses it.
  assert.deepEqual(moveInstruction.args.objects, {
    kind: "constant",
    value: { target: "forgotten-signpost.moved-unit" }
  });
  assert.deepEqual(moveInstruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(targetSpec, {
    id: "forgotten-signpost.moved-unit",
    filter: { type: "unit", controller: "controller", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
  // CR 355.4's destination is the location of the unit paid for in the cost; the program
  // records that relationship rather than naming a fixed base or battlefield.
  assert.deepEqual(moveInstruction.args.to, {
    kind: "constant",
    value: {
      kind: "location-of",
      object: { kind: "cost-choice", id: "forgotten-signpost.exhausted-unit" }
    }
  });
  assert.equal(moveInstruction.linkedTo, undefined);
  assert.equal(moveInstruction.targets.length, 1);
});

test("unl-045-219 Forgotten Signpost golden: the Move effect relocates the chosen unit through the interpreter", () => {
  // The destination value is the one unresolved input (it comes from the exhaust cost
  // choice). Supplying a concrete location exercises the card's own objects/target/amount
  // through the merged primitive with the reference kernel.
  const destination = { type: "battlefield", id: "battlefield-2" };
  const kernel = world()
    .unit("signpost", {
      types: ["gear"],
      might: null,
      zone: "board",
      location: { type: "base", player: "A" }
    })
    .unit("moved", { zone: "board", location: { type: "base", player: "A" }, exhausted: true })
    .unit("stays", { zone: "board", location: { type: "battlefield", id: "battlefield-2" } })
    .build();
  const movedRef = kernel.ref("moved");
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("signpost") });
  context.setTargets(targetSpec.id, [movedRef]);

  const run = runInstruction(
    move,
    {
      objects: moveInstruction.args.objects,
      amount: moveInstruction.args.amount,
      to: { kind: "constant", value: destination }
    },
    { world: context, targets: { [targetSpec.id]: [movedRef] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.moved.count, 1);
  assert.deepEqual(context.getObject("moved").location, destination);
  // An effect Move is not the Standard Move: no exhaust cost is charged and statuses are
  // preserved (CR 144 / 451.1).
  assert.equal(context.getObject("moved").exhausted, true);
  // Only the chosen unit moved; the other battlefield's occupant is untouched.
  assert.deepEqual(context.getObject("stays").location, { type: "battlefield", id: "battlefield-2" });
  assert.deepEqual(run.events.map((event) => event.action), ["move-location"]);
});

test("unl-045-219 Forgotten Signpost golden: a unit that already left the board makes the Move impossible", () => {
  const destination = { type: "battlefield", id: "battlefield-2" };
  const kernel = world()
    .unit("signpost", {
      types: ["gear"],
      might: null,
      zone: "board",
      location: { type: "base", player: "A" }
    })
    .unit("moved", { zone: "board", location: { type: "base", player: "A" } })
    .build();
  const stale = kernel.ref("moved");
  kernel.perform({ type: "move-zone", object: stale, to: "hand" });
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("signpost") });
  context.setTargets(targetSpec.id, [stale]);

  const run = runInstruction(
    move,
    {
      objects: moveInstruction.args.objects,
      amount: moveInstruction.args.amount,
      to: { kind: "constant", value: destination }
    },
    { world: context, targets: { [targetSpec.id]: [stale] } }
  );

  // 359.3.e.2/e.5: the only target has left the Board, so the instruction is ignored
  // rather than relocating a different unit.
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(context.getObject("moved").zone, "hand");
  assert.deepEqual(run.events, []);
});

test("unl-045-219 Forgotten Signpost golden: the exhaust cost half is paid by the merged cost plan", () => {
  const kernel = world()
    .unit("signpost", {
      types: ["gear"],
      might: null,
      zone: "board",
      location: { type: "base", player: "A" }
    })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("signpost") });

  // "…, :rb_exhaust:" (the source) is the part of the printed cost that the merged cost
  // pipeline can already name statically; the unit choice is the unresolved half.
  const plan = buildCostPlan(context, {
    id: "forgotten-signpost:exhaust-self",
    cost: { kind: "activated", payments: [{ kind: "exhaust", object: "self" }] }
  });
  assert.equal(plan.total.actions.length, 1);
  assert.equal(plan.total.actions[0].action.type, "exhaust");
  const receipt = payCostPlan(context, plan);
  assert.equal(receipt.paid, true);
  assert.equal(context.getObject("signpost").exhausted, true);
  assert.equal(receipt.events.filter((event) => event.action === "exhaust").length, 1);
});

test.todo(
  "unl-045-219 Forgotten Signpost: express \"to the location of the unit you exhausted\" (CR 355.4) — " +
    "needs a LocationRef/ObjectSelector that reads a cost-choice object's location (RIFT-90)"
);
test.todo(
  "unl-045-219 Forgotten Signpost: let the cost choice enumerate the controller's runtime Board units " +
    "(the frozen options are static) and wire the program -> activation -> chain registration (contract 3.5 / RIFT-89)"
);
