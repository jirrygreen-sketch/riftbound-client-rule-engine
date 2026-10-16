import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/detonate.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name. `resolveChainBody` is the production
// card-body entry point (chain/engine.ts resolves chain item bodies with it), so
// the primitive arg Exprs are consumed exactly as the chain consumes them.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-63b9de4f44f858cfa58a8855dfcdf972520d0d14e9a614865b2987d56f1381ab";

const [play] = program.abilities;
const [kill, draw] = play.body;
const gearSpec = kill.targets[0];

const runBody = (kernel) => resolveChainBody(play.body, kernel);

test("sfd-005-221 Detonate: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, "Kill a gear. Its controller draws 2.");
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-005-221 Detonate: no speed keyword, printed cost, kill then linked draw", () => {
  // The printed ability line has no [Action]/[Reaction]/[Hidden] keyword, so no
  // speed keyword is declared; the spell keeps its default timing (159.2).
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 1 },
    power: { kind: "constant", value: 1 }
  });

  // "Kill a gear": one targeted Board gear (355.5/355.7/355.9.a.1/355.10.a),
  // performed by the merged active-kill primitive (429.1/429.6).
  assert.equal(kill.id, "detonate.kill-gear");
  assert.equal(kill.op, "effect.kill");
  assert.deepEqual(kill.args, { target: { kind: "constant", value: "detonate.gear" } });
  assert.equal(kill.linkedTo, undefined);
  assert.equal(kill.targets.length, 1);
  assert.equal(gearSpec.id, "detonate.gear");
  assert.deepEqual(gearSpec.filter, { type: "gear", zone: "board" });
  assert.equal(gearSpec.min, 1);
  assert.equal(gearSpec.max, 1);
  assert.equal(gearSpec.selection, "one");

  // "Its controller draws 2": linked to the kill (359.3.e.14) with the drawer
  // read from the killed gear's controller (359.3.e.13 look-back).
  assert.equal(draw.id, "detonate.controller-draws");
  assert.equal(draw.op, "effect.draw");
  assert.equal(draw.linkedTo, "detonate.kill-gear");
  assert.deepEqual(draw.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(draw.args.player, {
    kind: "object-property",
    object: { target: "detonate.gear" },
    property: "controller"
  });
  assert.equal(draw.targets, undefined);
});

test("sfd-005-221 Detonate golden: the killed gear's controller draws 2", () => {
  const kernel = world()
    .deck(["b-top", "b-second"], { owner: "B" })
    .unit("enemy-gear", { types: ["gear"], owner: "B", controller: "B" })
    .build();
  kernel.setTargets(gearSpec.id, [kernel.ref("enemy-gear")]);

  const outcome = runBody(kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      ["detonate.kill-gear", "executed"],
      ["detonate.controller-draws", "executed"]
    ]
  );
  assert.equal(kernel.getObject("enemy-gear").zone, "trash");
  assert.equal(kernel.player("B").handSize, 2);
  assert.equal(kernel.player("A").handSize, 0);
  assert.deepEqual(outcome.events.map((event) => event.action), ["kill", "draw"]);
});

test("sfd-005-221 Detonate golden: a friendly gear is also a legal target (355.9.b)", () => {
  const kernel = world()
    .deck(["a-top", "a-second"], { owner: "A" })
    .unit("own-gear", { types: ["gear"], owner: "A", controller: "A" })
    .build();
  kernel.setTargets(gearSpec.id, [kernel.ref("own-gear")]);

  const outcome = runBody(kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(kernel.getObject("own-gear").zone, "trash");
  // "Its controller" is the gear's controller, so the caster draws from their
  // own deck here (190.6.d is not used; the reference is explicit).
  assert.equal(kernel.player("A").handSize, 2);
  assert.equal(kernel.player("B").handSize, 0);
  assert.deepEqual(outcome.events.map((event) => event.action), ["kill", "draw"]);
});

test("sfd-005-221 Detonate golden: a replaced kill still lets the linked draw resolve (359.3.e.14.b)", () => {
  const kernel = world()
    .deck(["b-top", "b-second"], { owner: "B" })
    .unit("enemy-gear", { types: ["gear"], owner: "B", controller: "B" })
    .build();
  kernel.addReplacement((action) => (action.type === "kill" ? "replaced" : null));
  kernel.setTargets(gearSpec.id, [kernel.ref("enemy-gear")]);

  const outcome = runBody(kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason ?? ""]),
    [
      ["detonate.kill-gear", "negated", "replaced"],
      ["detonate.controller-draws", "executed", ""]
    ]
  );
  assert.equal(kernel.getObject("enemy-gear").zone, "board");
  assert.equal(kernel.player("B").handSize, 2);
});

test("sfd-005-221 Detonate golden: a lost target ignores the kill and the linked draw (359.3.e.14.a)", () => {
  const kernel = world()
    .deck(["b-top", "b-second"], { owner: "B" })
    .unit("leaving-gear", { types: ["gear"], owner: "B", controller: "B" })
    .build();
  const stale = kernel.ref("leaving-gear");
  // The gear changes zones after Finalize but before resolution (359.3.e).
  kernel.perform({ type: "move-zone", object: stale, to: "hand" });
  kernel.setTargets(gearSpec.id, [stale]);

  const outcome = runBody(kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason ?? ""]),
    [
      ["detonate.kill-gear", "ignored", "mistargeted"],
      ["detonate.controller-draws", "ignored", "linked-ignored"]
    ]
  );
  assert.equal(kernel.player("B").handSize, 1);
  assert.equal(kernel.player("A").handSize, 0);
});

test.todo(
  "sfd-005-221 Detonate: Finalize-time target locking, the became-target trigger for the chosen " +
    "gear, and cost payment (1 Energy + 1 Fury power) belong to the chain/target/cost workstreams " +
    "(RIFT-89 / RIFT-90) — the card body itself executes through the merged primitives above."
);
