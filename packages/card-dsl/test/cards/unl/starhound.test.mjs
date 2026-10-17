import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/starhound.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import zone from "../../../../engine-core/dist/effects/instructions/effect.zone.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-71de133e390434f5d40d561542412b99992d3cba7c2705f3c6e156af8fa61a0c";
const SOURCE_TEXT =
  "When you play me, return a Bird, Cat, Dog, or Poro from your trash to your hand.";
const TARGET_ID = "starhound.card-in-trash";

const [ability] = program.abilities;
const [returnToHand] = ability.body;
const targetSpec = returnToHand.targets[0];

/** Run the declared effect.zone half with a Finalize-locked target. */
function runReturn(kernel, cardRef) {
  return runInstruction(
    zone,
    {
      target: returnToHand.args.target.value,
      to: returnToHand.args.to,
      amount: returnToHand.args.amount
    },
    { world: kernel, targets: { [TARGET_ID]: cardRef === undefined ? [] : [cardRef] } }
  );
}

test("unl-167-219 Starhound: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-167-219 Starhound: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /tags/);
  assert.match(program.judgeReason, /133\.8/);
  assert.match(program.judgeReason, /析取|disjunctive/);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-167-219 Starhound: one mandatory card-played self trigger with a single effect.zone instruction", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(ability.optional, false);

  assert.equal(ability.body.length, 1);
  assert.equal(returnToHand.id, "starhound.return-to-hand");
  // 448.2: a card changing zones is not a Move; the merged primitive routes a
  // hand destination to the card's owner (108.7.a).
  assert.equal(returnToHand.op, "effect.zone");
  assert.deepEqual(returnToHand.args.target, { kind: "constant", value: TARGET_ID });
  assert.deepEqual(returnToHand.args.to, { kind: "constant", value: "hand" });
  assert.deepEqual(returnToHand.args.amount, { kind: "constant", value: 1 });
  assert.equal(returnToHand.linkedTo, undefined);
  assert.equal(returnToHand.picks, undefined);
  assert.equal(returnToHand.condition, undefined);
});

test("unl-167-219 Starhound: 'a Bird, Cat, Dog, or Poro from your trash' is one target in the controller's trash", () => {
  // 355.9.a / 355.10.a: the Trash is a Public Zone, so naming a card there is a
  // choice and therefore a target (the rulebook's own "Recycle a unit from your
  // trash" example). 108.2.d / 108.2.a: each player has their own Trash.
  assert.equal(returnToHand.targets.length, 1);
  assert.equal(targetSpec.id, TARGET_ID);
  assert.equal(targetSpec.filter.zone, "trash");
  assert.equal(targetSpec.filter.owner, "self");
  // 133.8: the four tags are the printed disjunction; ObjectFilter.tags is an
  // AND over every tag, so this is the recorded shape rather than a narrowed
  // single-tag filter (see judgeReason).
  assert.deepEqual(targetSpec.filter.tagsAny, ["Bird", "Cat", "Dog", "Poro"]);
  assert.equal(targetSpec.min, 1);
  assert.equal(targetSpec.max, 1);
  assert.equal(targetSpec.selection, "one");
});

test("unl-167-219 Starhound golden: the locked trash card returns to its owner's hand (448.2 / 108.7.a)", () => {
  const kernel = world()
    .card("dead-dog", { types: ["unit"], tags: ["Dog"], owner: "A", zone: "trash" })
    .player("A")
    .build();
  const run = runReturn(kernel, kernel.ref("dead-dog"));

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("dead-dog").zone, "hand");
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["dead-dog"]);
  assert.deepEqual(run.events.map(event => event.action), ["return-to-hand"]);
  assert.equal(run.linked.moved, 1);
  assert.deepEqual(run.linked.movedIds, ["dead-dog"]);
  assert.equal(run.linked.destination, "hand");
});

test("unl-167-219 Starhound golden: a Bird in the trash returns the same way (no tag is special-cased)", () => {
  const kernel = world()
    .card("dead-bird", { types: ["unit"], tags: ["Bird"], owner: "A", zone: "trash" })
    .build();
  const run = runReturn(kernel, kernel.ref("dead-bird"));

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("dead-bird").zone, "hand");
});

test("unl-167-219 Starhound golden: a card that left the trash makes the return ignored (359.3.e.6)", () => {
  const kernel = world()
    .card("fleeing-poro", { types: ["unit"], tags: ["Poro"], owner: "A", zone: "trash" })
    .build();
  const stale = kernel.ref("fleeing-poro");
  assert.equal(kernel.perform({ type: "banish", object: stale }).status, "done");

  const run = runReturn(kernel, stale);

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.getObject("fleeing-poro").zone, "banishment");
  assert.deepEqual(run.events, []);
});

test("unl-167-219 Starhound golden: an empty trash yields nothing to return", () => {
  const kernel = world().player("A").build();
  const run = runReturn(kernel, undefined);

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(run.events, []);
  assert.deepEqual(kernel.zone("A", "hand"), []);
});

test.todo(
  "unl-167-219 Starhound: a disjunctive tag filter (\"a Bird, Cat, Dog, or Poro\", 133.8) for the TargetSpec — " +
    "ObjectFilter.tags is an AND over every listed tag, so the four-way choice cannot be expressed yet (RIFT-357)"
);
