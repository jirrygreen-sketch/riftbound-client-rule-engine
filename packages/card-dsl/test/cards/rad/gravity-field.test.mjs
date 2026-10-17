import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/gravity-field.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { default: draw } = await import(new URL("effects/instructions/effect.draw.js", ENGINE));
const { default: kill } = await import(new URL("effects/instructions/effect.kill.js", ENGINE));
const { default: restrict } = await import(new URL("effects/instructions/continuous.restrict.js", ENGINE));
const { keywordDefinitionsById } = await import(new URL("effects/keywords/registry.generated.js", ENGINE));
const { createContinuousEffectRegistry } = await import(new URL("layers/duration.js", ENGINE));
const { appliedCosts } = await import(new URL("layers/rules/query.js", ENGINE));
const { runInstruction, world } = await import(new URL("effects/testing/index.js", ENGINE));

const CARD_ID = "card.hash-d406d8dc66cee52b94dfb12d6f6e4fc13ed28937147e943fb4c4f4478b6bb58c";
const EXPECTED_SOURCE =
  "[Deploy] (Play this only to a battlefield. When an opponent holds here, kill this.)\n" +
  "Opponents must pay :rb_energy_1::rb_rune_rainbow: to move one or more units to this battlefield.\n" +
  "[Deathknell][>] Draw 1. (When I die, get the effect.)";

const [deploy, appliedCost, deathknell, triggered] = program.abilities;
const [drawInstruction] = triggered.body;

test("rad-062-167 Gravity Field: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Deploy/);
  assert.match(program.judgeReason, /204\.4/);
  assert.match(program.judgeReason, /trigger\.leave/);
  assert.match(program.judgeReason, /RIFT-257/);
});

test("rad-062-167 Gravity Field: identity, ruleset and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.sourceText, EXPECTED_SOURCE);
});

test("rad-062-167 Gravity Field: Deploy + applied-cost declaration + Deathknell draw body", () => {
  assert.equal(program.abilities.length, 4);
  assert.deepEqual(deploy, { kind: "keyword", keyword: "deploy" });

  // 204.4: the applied cost is declared in the merged continuous.restrict shape
  // (mode "applied-cost") with its action and printed content.
  assert.equal(appliedCost.kind, "static");
  assert.equal(appliedCost.effect.kind, "continuous.restrict");
  assert.equal(appliedCost.effect.mode, "applied-cost");
  assert.equal(appliedCost.effect.action, "move");
  assert.deepEqual(appliedCost.effect.cost, {
    energy: 1,
    power: ["rainbow"],
    payers: "opponent"
  });

  assert.deepEqual(deathknell, { kind: "keyword", keyword: "deathknell" });
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "object-killed");
  assert.deepEqual(triggered.trigger.filter, { self: true });
  assert.equal(triggered.optional, false);
  assert.equal(triggered.body.length, 1);
  assert.equal(drawInstruction.id, "gravity-field.draw-1");
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args.amount, { kind: "constant", value: 1 });
  assert.equal(drawInstruction.targets, undefined);
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.equal(drawInstruction.condition, undefined);
});

test("rad-062-167 Gravity Field: the merged Deploy KeywordDef expands the printed clauses", () => {
  const definition = keywordDefinitionsById.get("Deploy");
  assert.ok(definition, "effects/keywords/Deploy.ts must be registered (RIFT-267)");

  const expansion = definition.expand({ host: { canonicalCardId: CARD_ID } });
  assert.deepEqual(
    expansion.map((ability) => ability.kind),
    ["static", "triggered"]
  );
  // 830.1.b: the location permission is a continuous.location ability-layer
  // effect, and the "opponent holds here" clause is an object-killed... no: a
  // hold trigger that kills the host with the merged effect.kill primitive.
  assert.equal(expansion[0].effect.kind, "continuous.location");
  assert.deepEqual(expansion[1].trigger, {
    at: "hold",
    filter: { event: "hold", here: true, player: "opponent" }
  });
  assert.deepEqual(
    expansion[1].body.map((instruction) => [instruction.id, instruction.op]),
    [["deploy.kill-self", "effect.kill"]]
  );
});

test("rad-062-167 Gravity Field golden: the applied cost really registers and reads back by action", () => {
  const kernel = world()
    .unit("gravity-field", { types: ["gear"], owner: "A", controller: "A" })
    .build();
  const run = runInstruction(
    restrict,
    {
      // runInstruction's schema parses literal values, so pass the card's own
      // declared shapes (the card data stores them as open literals already).
      mode: { kind: "constant", value: appliedCost.effect.mode },
      action: { kind: "constant", value: appliedCost.effect.action },
      cost: { kind: "constant", value: appliedCost.effect.cost }
    },
    { world: kernel }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  assert.deepEqual(kernel.continuousEffects[0].effect.effect, {
    kind: "applied-cost",
    actions: ["move"],
    cost: { energy: 1, power: ["rainbow"], payers: "opponent" }
  });

  const registry = createContinuousEffectRegistry();
  for (const entry of kernel.continuousEffects) registry.register(entry.effect, entry.duration);
  const queried = appliedCosts(registry, "move");
  assert.equal(queried.length, 1);
  assert.deepEqual(queried[0].actions, ["move"]);
  assert.deepEqual(queried[0].cost, { energy: 1, power: ["rainbow"], payers: "opponent" });
  // The modification is scoped to the associated action only.
  assert.deepEqual(appliedCosts(registry, "play"), []);
});

test("rad-062-167 Gravity Field golden: the merged Deploy kill body really kills the host (830.1.b)", () => {
  const kernel = world()
    .unit("gravity-field", { types: ["gear"], owner: "A", controller: "A" })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("gravity-field") });
  const definition = keywordDefinitionsById.get("Deploy");
  const [, holdTrigger] = definition.expand({ host: { canonicalCardId: CARD_ID } });

  const run = runInstruction(
    kill,
    { self: true },
    { world: scoped }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(scoped.getObject("gravity-field").zone, "trash");
  assert.deepEqual(run.events.map((event) => event.action), ["kill"]);
  // The merged expansion's body is exactly the instruction that just ran.
  assert.deepEqual(holdTrigger.body.map((instruction) => instruction.op), ["effect.kill"]);
});

test("rad-062-167 Gravity Field golden: the Draw 1 body really draws one card through the reference kernel", () => {
  const kernel = world().deck(["top", "second"]).build();
  const run = runInstruction(
    draw,
    { amount: drawInstruction.args.amount },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.deepEqual(run.events.map((event) => event.action), ["draw"]);
});

test("rad-062-167 Gravity Field: the merged Deathknell expansion declares its trigger.leave body", () => {
  const definition = keywordDefinitionsById.get("Deathknell");
  assert.ok(definition, "effects/keywords/Deathknell.ts must be registered (RIFT-82)");
  const expansion = definition.expand({ host: { canonicalCardId: CARD_ID } });
  assert.equal(expansion.length, 1);
  assert.equal(expansion[0].kind, "triggered");
  assert.equal(expansion[0].trigger.at, "object-killed");
  // The expansion body is the registered keyword's own declared shape (RIFT-82);
  // the goldens above run only the primitives that are really merged today.
  assert.deepEqual(expansion[0].body.map((step) => step.op), ["trigger.leave"]);
});

test.todo(
  "rad-062-167 Gravity Field: Deploy's continuous.location permission and cleanup recall exemption " +
    "(CR 830.1.b) need a consumer — nothing turns the CardProgram keyword ability into a registered " +
    "layer effect (RIFT-257) and Finalize never reads playLocations()"
);
test.todo(
  "rad-062-167 Gravity Field: the applied cost (CR 204.4/204.4.b) must be charged when a unit is " +
    "moved to this battlefield — the move cost plan still has no applied-cost consumer and rainbow " +
    "Power payment belongs to cost.pay (RIFT-261)"
);
test.todo(
  "rad-062-167 Gravity Field: the Deathknell expansion needs trigger.leave plus the program -> " +
    "keyword -> timing/chain wiring (contract 3.5, RIFT-257) before 'Draw 1' can fire on death"
);
