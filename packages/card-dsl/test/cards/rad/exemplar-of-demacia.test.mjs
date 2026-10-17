
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/exemplar-of-demacia.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { matchesTriggerObject } from "../../../../engine-core/dist/events/pipeline-match.js";

const CANONICAL_ID =
  "card.hash-aeae869420081de1b84e1b857cd09233807ef065f1a55595f74684bdb08821eb";
const SOURCE_TEXT =
  "When you play a gear with [Deploy], you may exhaust me and pay :rb_rune_rainbow: to move a " +
  "friendly unit to that battlefield.";

const [ability] = program.abilities;
const [payInstruction, moveInstruction] = ability.body;

const gear = (keywords) => ({
  ref: { id: "gear", zoneEntryId: 1 },
  cardId: "card:gear",
  name: "gear",
  types: ["gear"],
  tags: [],
  keywords,
  owner: "A",
  controller: "A",
  zone: "board",
  location: { type: "battlefield", id: "bf-2" },
  might: null,
  energy: null,
  power: null,
  exhausted: false,
  damage: 0,
  stunned: false,
  buffs: 0,
  attachedTo: null,
  faceDown: false,
  isToken: false
});

test("rad-155-167 Exemplar of Demacia: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-155-167 Exemplar of Demacia: identity, status, judgeReason, and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Deploy/);
  assert.match(program.judgeReason, /cost\.pay/);
  assert.match(program.judgeReason, /RIFT-261/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("rad-155-167 Exemplar of Demacia: card-played trigger for a gear with [Deploy] you played", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // CR 383.4.a / timing point "card-played": the played object is the new gear.
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    object: {
      type: "gear",
      controller: "self",
      // CR 830.3 allows checking whether a Gear has Deploy. The merged filter
      // vocabulary has no keywords member, so this stays a declared marker
      // (see judgeReason) and is never treated as evaluated truth.
      characteristics: { deploy: true }
    }
  });
  assert.equal(ability.trigger.condition, undefined);
  // CR 383.3.a / 403.1: the leading "you may" is the triggered ability's own
  // Finalize decision, so it is carried by optional, not by a body choice node.
  assert.equal(ability.optional, true);
});

test("rad-155-167 Exemplar of Demacia: the declared [Deploy] filter cannot gate the trigger (830.3)", () => {
  // Writing keywords: [Deploy] into a trigger filter is silently ignored by the
  // merged matcher (unknown members are skipped), so it would match every played
  // Gear. This pins the real behaviour instead of trusting the marker.
  const withDeploy = gear([{ id: "Deploy" }]);
  const withoutDeploy = gear([]);
  assert.equal(matchesTriggerObject({ type: "gear", keywords: ["Deploy"] }, withDeploy, "A"), true);
  assert.equal(
    matchesTriggerObject({ type: "gear", keywords: ["Deploy"] }, withoutDeploy, "A"),
    true,
    "the keywords member is not evaluated, so a plain Gear matches too"
  );
  // A characteristics-based attempt is not a keyword read either: it compares
  // the snapshot property verbatim, and the snapshot has no deploy field.
  assert.equal(
    matchesTriggerObject({ type: "gear", characteristics: { deploy: true } }, withDeploy, "A"),
    false
  );
});

test("rad-155-167 Exemplar of Demacia: cost within instructions, then a linked move", () => {
  assert.deepEqual(ability.body.map(instruction => instruction.id), [
    "exemplar-of-demacia.pay",
    "exemplar-of-demacia.move-unit"
  ]);

  // CR 383.3.b / 383.3.b.1: "exhaust me and pay [A]" follows the leading "you
  // may", so it is the triggered ability's base cost and is paid at Finalize.
  assert.equal(payInstruction.op, "cost.pay");
  assert.equal(payInstruction.linkedTo, undefined);
  // [A] stays the descriptive rainbow marker: the closed six-domain Domain set
  // cannot represent Universal Power (CR 163.2.b / 135.2.e.5).
  assert.deepEqual(payInstruction.args.power, { kind: "constant", value: ["rainbow"] });
  assert.deepEqual(payInstruction.args.payments, {
    kind: "constant",
    value: [{ kind: "exhaust", object: "self" }]
  });

  // CR 383.3.b "[do X] to [do Y]": the move only happens when the cost was paid.
  assert.equal(moveInstruction.op, "effect.move");
  assert.equal(moveInstruction.linkedTo, "exemplar-of-demacia.pay");
  assert.equal(moveInstruction.condition, undefined);
  assert.deepEqual(moveInstruction.args.objects, {
    kind: "constant",
    value: { target: "exemplar-of-demacia.friendly-unit" }
  });
  assert.deepEqual(moveInstruction.args.amount, { kind: "constant", value: 1 });
  // "that battlefield" needs the triggering object's location; the merged
  // ObjectSelector vocabulary cannot name it, so the destination stays a
  // descriptive marker (never a real battlefield id).
  assert.deepEqual(moveInstruction.args.to, {
    kind: "constant",
    value: { type: "battlefield", id: "that-battlefield" }
  });

  // CR 355.10 / 355.9.a.1: the moved friendly unit is the only target.
  assert.deepEqual(moveInstruction.targets, [
    {
      id: "exemplar-of-demacia.friendly-unit",
      filter: { type: "unit", controller: "controller" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(moveInstruction.picks, undefined);
});

test("rad-155-167 Exemplar of Demacia: cost.pay is not registered, so nothing is approximated", () => {
  // cost.pay has no merged primitive file (RIFT-261). The merged registry is
  // the evidence that the leading cost cannot be paid yet.
  assert.equal(instructionDefinitionsById.has("cost.pay"), false);
});

test("rad-155-167 Exemplar of Demacia golden: the declared move shape relocates a unit to a literal battlefield", () => {
  // effect.move's `to` accepts only a literal LocationRef / controller-base / a
  // choice of literal locations (its own destination() validator), so a
  // target-supplied location cannot be used for "that battlefield". This golden
  // runs the card's own objects/amount shape with the literal destination to
  // prove the move half executes once the destination is bound.
  const kernel = world()
    .unit("ally", { might: 2, location: { type: "base", player: "A" } })
    .unit("gear", { types: ["gear"], location: { type: "battlefield", id: "bf-2" } })
    .build();
  const scoped = kernel.clone({ source: kernel.ref("gear"), sourceSnapshot: kernel.getObject("gear") });
  const run = runInstruction(
    move,
    {
      objects: moveInstruction.args.objects,
      to: { kind: "constant", value: { type: "battlefield", id: "bf-2" } },
      amount: moveInstruction.args.amount
    },
    { world: scoped, targets: { "exemplar-of-demacia.friendly-unit": [kernel.ref("ally")] } }
  );

  assert.equal(run.result.status, "executed");
  // runInstruction executes against the supplied world (the scoped clone).
  assert.deepEqual(scoped.getObject("ally").location, { type: "battlefield", id: "bf-2" });
  assert.equal(run.linked.moved.count, 1);
});

test("rad-155-167 Exemplar of Demacia: effect.move rejects a target-supplied destination today", () => {
  // "that battlefield" would have to come from the triggered object's location,
  // but the merged destination() validator only takes literal LocationRefs; a
  // target descriptor is rejected when the instruction resolves.
  const kernel = world().unit("ally", { might: 2, location: { type: "base", player: "A" } }).build();
  assert.throws(
    () => runInstruction(
      move,
      {
        objects: { kind: "constant", value: { target: "unit" } },
        to: { kind: "constant", value: { kind: "target", id: "bf" } },
        amount: { kind: "constant", value: 1 }
      },
      { world: kernel, targets: { unit: [kernel.ref("ally")], bf: [kernel.ref("ally")] } }
    ),
    /effect.move to must be a location, controller-base, or location choice/
  );
});

test.todo(
  "rad-155-167 Exemplar of Demacia: filter the card-played event for a gear that has the " +
    "Deploy keyword (CR 830.1.a / 830.3; keyword-aware filters) — RIFT-257"
);
test.todo(
  "rad-155-167 Exemplar of Demacia: pay the base cost (Exhaust this legend plus 1 Power of " +
    "any domain) during Finalize and remove the trigger when it cannot be paid " +
    "(CR 383.3.b.1 / 415.4 / 163.2.b; cost.pay and Universal Power) — RIFT-261"
);
test.todo(
  "rad-155-167 Exemplar of Demacia: move the friendly unit to the triggering gear's " +
    "battlefield (CR 421 / 449; needs the triggering object's location bound as a destination) — RIFT-257"
);

