import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import charm from "../../../dist/cards/ogn/charm.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-cb202ce740ea23b09a039a51724a26f05a05cbd44cb1fb5692f72a7c406b4201";
const battlefield = { type: "battlefield", id: "battlefield-1" };
const baseOf = player => ({ type: "base", player });

const [play] = charm.abilities;
const [moveInstruction] = play.body;

test("Charm program is structurally valid EffectIR v2 data", () => {
  const result = validateCardProgram(charm);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Charm identity, ruleset, status and printed text", () => {
  assert.equal(charm.canonicalCardId, CANONICAL);
  assert.equal(charm.rulesetVersion, "core-1.5");
  assert.equal(charm.status, "judge-required");
  assert.equal(charm.sourceText, "Move an enemy unit.");
  // The judgeReason must name the missing Move Destination expression and the
  // pipeline dependency instead of a vague "pending".
  assert.match(charm.judgeReason, /Destination/);
  assert.match(charm.judgeReason, /355\.4/);
  assert.match(charm.judgeReason, /effect\.move/);
  // The generated registry indexes this program by canonicalCardId.
  assert.equal(cardRegistryById.get(charm.canonicalCardId), charm);
});

test("Charm has no [Action]/[Reaction] keyword on this printing", () => {
  assert.equal(charm.abilities.length, 1);
  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.equal(
    charm.abilities.some(ability => ability.kind === "keyword"),
    false
  );
});

test("Charm body: one effect.move over a single enemy unit target", () => {
  assert.equal(play.body.length, 1);
  assert.equal(moveInstruction.id, "move-enemy-unit");
  assert.equal(moveInstruction.op, "effect.move");
  assert.deepEqual(moveInstruction.args.objects, {
    kind: "constant",
    value: { target: "enemy-unit" }
  });
  // "Move an enemy unit" — one target on the board, not a pick.
  assert.equal(moveInstruction.picks, undefined);
  assert.equal(moveInstruction.targets.length, 1);
  assert.deepEqual(moveInstruction.targets[0], {
    id: "enemy-unit",
    filter: { type: "unit", controller: "opponent" },
    min: 1,
    max: 1,
    selection: "one"
  });
  // The Destination is a Finalize-time runtime choice (CR 355.4.a); the static
  // IR can only mark it, it cannot enumerate the legal locations.
  assert.deepEqual(moveInstruction.args.to, {
    kind: "constant",
    value: {
      kind: "choose",
      id: "charm.destination",
      options: ["runtime:valid-move-destination"]
    }
  });
});

test("Charm golden: the enemy-unit half moves through the merged effect.move", () => {
  // The production caller owns the Finalize destination choice (355.4.a); the
  // golden run therefore executes the card's own objects/target expressions
  // with the destination that caller must supply, and asserts the real Move.
  const kernel = world()
    .battlefield("enemy-unit", { owner: "B", location: battlefield })
    .build();
  const before = kernel.getObject("enemy-unit");
  const run = runInstruction(
    move,
    { objects: moveInstruction.args.objects, to: { kind: "constant", value: baseOf("B") } },
    { world: kernel, targets: { "enemy-unit": [kernel.ref("enemy-unit")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.events.map(event => event.action), ["move-location"]);
  assert.deepEqual(kernel.getObject("enemy-unit"), { ...before, location: baseOf("B") });
  assert.deepEqual(run.linked.moved, {
    count: 1,
    objects: [before.ref],
    movements: [{ object: before.ref, from: battlefield, to: baseOf("B") }]
  });
  // A Move does not change zone (448.2) and keeps the object's statuses.
  assert.equal(kernel.getObject("enemy-unit").zone, "board");
});

test("Charm golden: a stale target is ignored when the unit already left the board", () => {
  const kernel = world().battlefield("enemy-unit", { owner: "B" }).build();
  const stale = kernel.ref("enemy-unit");
  kernel.perform({ type: "kill", object: stale });
  const run = runInstruction(
    move,
    { objects: moveInstruction.args.objects, to: { kind: "constant", value: baseOf("B") } },
    { world: kernel, targets: { "enemy-unit": [stale] } }
  );

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
});

test("Charm fails closed: the placeholder Destination is rejected by effect.move, never guessed", () => {
  // The card's own args must NOT be silently accepted with some substitute
  // destination: effect.move only takes a real LocationRef, "controller-base",
  // or a static list of LocationRefs (CR 355.4.a's runtime choice has no IR
  // form yet), so executing the card's literal args throws instead of moving
  // the unit to an invented Destination.
  const kernel = world().battlefield("enemy-unit", { owner: "B" }).build();
  assert.throws(
    () =>
      runInstruction(move, moveInstruction.args, {
        world: kernel,
        targets: { "enemy-unit": [kernel.ref("enemy-unit")] }
      }),
    /effect\.move to must be a location, controller-base, or location choice/
  );
  assert.deepEqual(kernel.getObject("enemy-unit").location, battlefield);
});

test.todo(
  "Charm Destination: enumerate the runtime-legal Move Destinations at Finalize and offer the " +
    "choice to the controller (CR 355.4 / 355.4.a / 449.2) - needs the target.location primitive and " +
    "the Move pipeline (contract 7.2 batch 5 Turn/Combat; no merged task number)"
);

test.todo(
  "Charm Move pipeline consequences: Contested on the destination (452), Move-triggered Showdown/Combat " +
    "(453-454) and the post-Move Cleanup (455)"
);
