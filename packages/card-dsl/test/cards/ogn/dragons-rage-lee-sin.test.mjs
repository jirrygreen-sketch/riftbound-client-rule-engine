import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import dragonsRage from "../../../dist/cards/ogn/dragons-rage-lee-sin.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-5db2b31990da2ad96271bf74f4d78f1ae9ef9c614ec7bcec1735b3cc17f301ae";
const BASE = player => ({ type: "base", player });
const BATTLEFIELD = id => ({ type: "battlefield", id });

const [play] = dragonsRage.abilities;
const [moveInstruction, damageMoved, damageOther] = play.body;
const movedSpec = moveInstruction.targets[0];
const otherSpec = damageMoved.targets[0];

test("Dragon's Rage program is structurally valid EffectIR v2 data", () => {
  const result = validateCardProgram(dragonsRage);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Dragon's Rage identity, ruleset, status, printed text and judgeReason", () => {
  assert.equal(dragonsRage.canonicalCardId, CANONICAL);
  assert.equal(dragonsRage.rulesetVersion, "core-1.5");
  assert.equal(dragonsRage.status, "judge-required");
  assert.equal(
    dragonsRage.sourceText,
    "Move an enemy unit. Then choose another enemy unit at its destination. " +
      "They deal damage equal to their Mights to each other."
  );
  // The judgeReason must name the missing reflexive trigger, the missing Move
  // Destination form and the target/legality ordering, with rule numbers.
  assert.match(dragonsRage.judgeReason, /trigger\.reflexive/);
  assert.match(dragonsRage.judgeReason, /388\.1/);
  assert.match(dragonsRage.judgeReason, /389\.1/);
  assert.match(dragonsRage.judgeReason, /355\.5\.b/);
  assert.match(dragonsRage.judgeReason, /355\.4/);
  assert.match(dragonsRage.judgeReason, /effect\.move/);
  assert.equal(cardRegistryById.get(dragonsRage.canonicalCardId), dragonsRage);
});

test("Dragon's Rage has no printed [Action]/[Reaction] keyword", () => {
  assert.equal(dragonsRage.abilities.length, 1);
  assert.equal(
    dragonsRage.abilities.some(ability => ability.kind === "keyword"),
    false
  );
  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
});

test("Dragon's Rage structure: the Move, then both directions of the mutual damage", () => {
  assert.equal(play.body.length, 3);

  // "Move an enemy unit" — one enemy target; the Destination is a Finalize-time
  // runtime choice the frozen IR can only mark (355.4.a).
  assert.equal(moveInstruction.id, "move-enemy-unit");
  assert.equal(moveInstruction.op, "effect.move");
  assert.deepEqual(moveInstruction.args.objects, { kind: "constant", value: { target: "moved-unit" } });
  assert.deepEqual(moveInstruction.args.to, {
    kind: "constant",
    value: {
      kind: "choose",
      id: "dragons-rage.destination",
      options: ["runtime:valid-move-destination"]
    }
  });
  assert.deepEqual(movedSpec, {
    id: "moved-unit",
    filter: { type: "unit", controller: "opponent" },
    min: 1,
    max: 1,
    selection: "one"
  });

  // "another enemy unit at its destination": the second unit is anchored to the
  // moved unit and excludes it.
  assert.equal(damageMoved.id, "damage-moved-unit");
  assert.equal(damageMoved.op, "effect.damage");
  assert.equal(damageMoved.linkedTo, "move-enemy-unit");
  assert.deepEqual(damageMoved.args.amount, {
    kind: "object-property",
    object: { target: "moved-unit" },
    property: "might"
  });
  assert.deepEqual(damageMoved.args.source, {
    kind: "object-property",
    object: { target: "moved-unit" },
    property: "ref"
  });
  assert.deepEqual(damageMoved.args.target, { kind: "constant", value: "other-unit-there" });
  assert.deepEqual(otherSpec, {
    id: "other-unit-there",
    filter: {
      type: "unit",
      controller: "opponent",
      sameLocationAs: { target: "moved-unit" },
      exclude: { target: "moved-unit" }
    },
    min: 1,
    max: 1,
    selection: "one"
  });

  // "to each other": the second Deal reverses source and target.
  assert.equal(damageOther.id, "damage-other-unit");
  assert.equal(damageOther.op, "effect.damage");
  assert.equal(damageOther.linkedTo, "damage-moved-unit");
  assert.deepEqual(damageOther.args.amount, {
    kind: "object-property",
    object: { target: "other-unit-there" },
    property: "might"
  });
  assert.deepEqual(damageOther.args.source, {
    kind: "object-property",
    object: { target: "other-unit-there" },
    property: "ref"
  });
  assert.deepEqual(damageOther.args.target, { kind: "constant", value: "moved-unit" });
  assert.equal(damageOther.targets, undefined);
});

test("Dragon's Rage fails closed: the placeholder Destination is rejected by effect.move", () => {
  // The card must not silently accept an invented Location: effect.move only
  // takes a real LocationRef, the literal "controller-base" or a static option
  // list (CR 355.4.a has no IR form yet).
  const kernel = world().battlefield("enemy", { owner: "B", location: BATTLEFIELD("bf1") }).build();
  assert.throws(
    () =>
      runInstruction(move, moveInstruction.args, {
        world: kernel,
        targets: { "moved-unit": [kernel.ref("enemy")] }
      }),
    /effect\.move to must be a location, controller-base, or location choice/
  );
  assert.deepEqual(kernel.getObject("enemy").location, BATTLEFIELD("bf1"));
});

test("Dragon's Rage golden: the Move half drives the real primitive with a Finalize destination", () => {
  const kernel = world().battlefield("enemy", { owner: "B", location: BATTLEFIELD("bf1") }).build();
  const before = kernel.getObject("enemy");
  const run = runInstruction(
    move,
    { objects: moveInstruction.args.objects, to: { kind: "constant", value: BASE("B") } },
    { world: kernel, targets: { "moved-unit": [kernel.ref("enemy")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.events.map(event => event.action), ["move-location"]);
  assert.deepEqual(kernel.getObject("enemy"), { ...before, location: BASE("B") });
  assert.equal(kernel.getObject("enemy").zone, "board");
});

test("Dragon's Rage golden: the mutual damage reads both Might values and attributes each source", () => {
  // The two Deals of "They deal damage equal to their Mights to each other":
  // without the reflexive Pending Item these are executed here with the same
  // amounts, sources and targets the card declares, after a real Move.
  const kernel = world()
    .unit("moved", { owner: "B", might: 3, location: BATTLEFIELD("bf2") })
    .unit("other", { owner: "B", might: 2, location: BATTLEFIELD("bf2") })
    .build();
  const movedRef = kernel.ref("moved");
  const otherRef = kernel.ref("other");

  const first = runInstruction(
    damage,
    {
      amount: { kind: "object-property", object: movedRef, property: "might" },
      source: { kind: "constant", value: movedRef },
      target: "other-unit-there"
    },
    { world: kernel, targets: { "other-unit-there": [otherRef] } }
  );
  assert.equal(first.result.status, "executed");
  assert.equal(kernel.getObject("other").damage, 3);

  const second = runInstruction(
    damage,
    {
      amount: { kind: "object-property", object: otherRef, property: "might" },
      source: { kind: "constant", value: otherRef },
      target: "moved-unit"
    },
    { world: kernel, targets: { "moved-unit": [movedRef] } }
  );
  assert.equal(second.result.status, "executed");
  assert.equal(kernel.getObject("moved").damage, 2);

  // Both Deal actions are non-combat damage and each carries its own source
  // (CR 418.1.d keeps them as separate marked damage actions).
  const damageActions = kernel.stateForTest().history
    .map(entry => entry.action)
    .filter(action => action.type === "damage");
  assert.deepEqual(damageActions.map(action => [action.source, action.target, action.amount, action.combat]), [
    [movedRef, otherRef, 3, false],
    [otherRef, movedRef, 2, false]
  ]);
});

test.todo(
  "Dragon's Rage reflexive trigger: after the Move, create a Pending Item that chooses another enemy " +
    "unit at the moved unit destination and resolves the mutual damage (388.1 / 388.2 / 389.1 / 389.2, " +
    "355.5.b) — needs the trigger.reflexive primitive and the pending-item " +
    "target legality rules"
);

test.todo(
  "Dragon's Rage Move Destination: enumerate the runtime-legal Locations at Finalize and offer the " +
    "choice to the controller (355.4 / 355.4.a / 449.2 / 451.1) — needs the target.location primitive and " +
    "the Move pipeline (contract 7.2 batch 5 Turn/Combat)"
);

test.todo(
  "Dragon's Rage data: the local deck-catalog snapshot still prints the pre-errata wording without the " +
    "'Then do this:' boundary reported by S-ORIGINS; the authoritative text must be refreshed before this " +
    "program can claim the errata structure (data issue, not a primitive)"
);

