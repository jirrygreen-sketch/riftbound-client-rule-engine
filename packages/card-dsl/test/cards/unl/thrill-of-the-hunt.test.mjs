import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/thrill-of-the-hunt.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import banish from "../../../../engine-core/dist/effects/instructions/effect.banish.js";
import play from "../../../../engine-core/dist/effects/instructions/effect.play.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-4b33571613158dd1d158236b2c187a229657ed9ca2de150f5954357de9230ddb";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Banish a friendly unit, then its owner plays it to any battlefield, ignoring its cost.";

const [reactionKeyword, playAbility] = program.abilities;
const [banishFriendlyUnit, playToBattlefield] = playAbility.body;
const targetSpec = banishFriendlyUnit.targets[0];

// The reference kernel compares filter values literally, so the card layer's
// friendly placeholder is locked by the harness (production resolves it
// through the target pipeline, which the structural assertions cover).
const bodyWithoutTargetSpecs = playAbility.body.map(({ targets, ...rest }) => rest);

test("unl-184-219 Thrill of the Hunt: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-184-219 Thrill of the Hunt: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  // The ignore-cost rule (356.1.b/.b.1, floor 356.6), effect.play's finalized
  // plan requirement and the runtime Location selector gap are named.
  // RIFT-89 merged cost.modify + ignoreAllCosts, so the current gap is the
  // producer path that freezes the plan for effect.play (judgeReason point 1).
  assert.match(program.judgeReason, /356\.1\.b\.1/);
  assert.match(program.judgeReason, /356\.6/);
  assert.match(program.judgeReason, /FinalizedCostPlan/);
  assert.match(program.judgeReason, /ignoreAllCosts/);
  assert.match(program.judgeReason, /finalized plan/);
  assert.match(program.judgeReason, /355\.4/);
  assert.match(program.judgeReason, /RIFT-90/);
});

test("unl-184-219 Thrill of the Hunt: [Reaction] plus a linked banish-then-play pair", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(reactionKeyword, { kind: "keyword", keyword: "reaction" });
  assert.equal(reactionKeyword.value, undefined);
  assert.equal(playAbility.kind, "play");
  // Printed cost (2 Energy + 1 Power) is bound from the card identity at
  // Finalize, so the program declares no CostSpec.
  assert.equal(playAbility.cost, undefined);
  assert.deepEqual(
    playAbility.body.map((instruction) => instruction.id),
    ["thrill-of-the-hunt.banish-friendly-unit", "thrill-of-the-hunt.play-to-battlefield"]
  );

  // "Banish a friendly unit" — one Board unit controlled by this ability's
  // controller (355.7 / 355.9.a.1 / 355.9.b).
  assert.equal(banishFriendlyUnit.op, "effect.banish");
  assert.deepEqual(banishFriendlyUnit.args.objects, {
    kind: "constant",
    value: { target: "thrill-of-the-hunt.friendly-unit" }
  });
  assert.deepEqual(targetSpec, {
    id: "thrill-of-the-hunt.friendly-unit",
    filter: { type: "unit", controller: "self" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(banishFriendlyUnit.linkedTo, undefined);
});

test("unl-184-219 Thrill of the Hunt: the play half reads the receipt ref, the owner referent and the ignore-cost shape", () => {
  // 359.3.e.14: "then its owner plays it" references the banished card, so the
  // play instruction is linked and reads the receipt's fresh reference
  // (124 / 428.3) instead of reviving the old Board identity.
  assert.equal(playToBattlefield.op, "effect.play");
  assert.equal(playToBattlefield.linkedTo, "thrill-of-the-hunt.banish-friendly-unit");
  assert.deepEqual(playToBattlefield.args.object, {
    kind: "linked-value",
    instructionId: "thrill-of-the-hunt.banish-friendly-unit",
    key: "banishedObject"
  });
  // "its owner" is read from the chosen unit's last known information
  // (359.3.e.12–e.13), which is why the target spec is reused as the anchor.
  assert.deepEqual(playToBattlefield.args.player, {
    kind: "object-property",
    object: { target: "thrill-of-the-hunt.friendly-unit" },
    property: "owner"
  });
  // "to any battlefield" is a Finalize-time Location choice (355.4/355.4.a);
  // the merged IR has no runtime Location selector, so the marker is
  // descriptive and the interpreter rejects it instead of guessing.
  assert.deepEqual(playToBattlefield.args.location, {
    kind: "constant",
    value: { kind: "destination-selector", filter: { type: "battlefield" } }
  });
  // "ignoring its cost": base Energy and base Power zeroed (356.1.b.1) with
  // the 356.6 floor; the descriptor is explicitly not a finalized plan.
  assert.deepEqual(playToBattlefield.args.cost, {
    kind: "constant",
    value: {
      kind: "cost.modify",
      base: "printed",
      ignore: ["energy", "power"],
      minimum: 0,
      finalized: false
    }
  });
  assert.equal(playToBattlefield.targets, undefined);
});

test("unl-184-219 Thrill of the Hunt: the merged registry really registers both used primitives", () => {
  assert.equal(banish.op, "effect.banish");
  assert.equal(play.op, "effect.play");
});

test("unl-184-219 Thrill of the Hunt golden: the banished unit reaches Banishment and its receipt carries the new ref", () => {
  const kernel = world()
    .base("hunted", { owner: "A", types: ["unit"], might: 2 })
    .build();
  const original = kernel.ref("hunted");

  const run = runInstruction(
    banish,
    {
      objects: { kind: "constant", value: { target: targetSpec.id } },
      amount: { kind: "constant", value: 1 },
      linkKey: { kind: "constant", value: "banished" }
    },
    { world: kernel, targets: { [targetSpec.id]: [original] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.banished.count, 1);
  // 124 / 428.3: leaving the Board makes a new object identity; the receipt
  // carries it and the old reference is dead.
  assert.deepEqual(run.linked.banishedObject, { id: "hunted", zoneEntryId: 2 });
  assert.equal(kernel.object(original), null);
  assert.deepEqual(run.events.map((event) => event.action), ["banish"]);
  assert.equal(kernel.getObject("hunted").zone, "banishment");
  assert.equal(kernel.getObject("hunted").owner, "A");
});

test("unl-184-219 Thrill of the Hunt golden: the play half fails closed while the ignore-cost plan has no producer", () => {
  const kernel = world().base("hunted", { owner: "A", types: ["unit"], might: 2 }).build();
  kernel.setTargets(targetSpec.id, [kernel.ref("hunted")]);

  const outcome = resolveChainBody(bodyWithoutTargetSpecs, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map((result) => [result.id, result.result.status]), [
    ["thrill-of-the-hunt.banish-friendly-unit", "executed"],
    ["thrill-of-the-hunt.play-to-battlefield", "negated"]
  ]);
  // The unit stays in Banishment: it is never played at the printed cost, and
  // the descriptive destination is rejected rather than approximated.
  assert.equal(kernel.getObject("hunted").zone, "banishment");
  assert.equal(outcome.linkedValues["thrill-of-the-hunt.banish-friendly-unit.banishedObject"].zoneEntryId, 2);
  assert.deepEqual(outcome.events.map((event) => event.action), ["banish"]);
});

test("unl-184-219 Thrill of the Hunt golden: an unfinalized ignore-cost plan never plays at the printed cost", () => {
  // Guards against the wrong fix: effect.play must reject the descriptor
  // instead of charging the printed cost (2 energy + 1 power here).
  const kernel = world()
    .object("hunted", {
      zone: "banishment",
      types: ["unit"],
      owner: "A",
      controller: "A",
      energy: 2,
      power: ["Body"]
    })
    .build();
  const banished = kernel.zone("A", "banishment")[0];

  const run = runInstruction(
    play,
    {
      object: { kind: "constant", value: banished },
      player: { kind: "constant", value: "A" },
      location: { kind: "constant", value: { type: "battlefield", id: "bf-1" } },
      cost: playToBattlefield.args.cost
    },
    { world: kernel }
  );

  assert.deepEqual(run.result, { status: "negated", reason: "impossible", events: [] });
  assert.equal(kernel.getObject("hunted").zone, "banishment");
  assert.equal(run.events.length, 0);
});

test("unl-184-219 Thrill of the Hunt golden: a banish that cannot happen leaves the linked play ignored too (359.3.e.14.a)", () => {
  const kernel = world().base("hunted", { owner: "A", types: ["unit"], might: 2 }).build();
  const stale = kernel.ref("hunted");
  // The unit already left the Board after finalization.
  kernel.perform({ type: "return-to-hand", object: stale });
  kernel.setTargets(targetSpec.id, [stale]);

  const outcome = resolveChainBody(bodyWithoutTargetSpecs, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map((result) => result.result), [
    { status: "ignored", reason: "mistargeted" },
    { status: "ignored", reason: "linked-ignored" }
  ]);
  assert.equal(kernel.getObject("hunted").zone, "hand");
});

test.todo(
  "unl-184-219 Thrill of the Hunt: materialize the ignore-cost plan (base Energy and base Power costs set to zero, CR 356.1.b.1, floor 0 per 356.6, keeping 356.1.b.3 additional costs) — cost.modify with ignoreAllCosts (CR 356.5) is merged, but no merged path freezes the card's descriptive plan into a finalized FinalizedCostPlan that effect.play accepts"
);
test.todo(
  "unl-184-219 Thrill of the Hunt: offer \"to any battlefield\" as a runtime Location choice other than the unit's current location (CR 355.4/355.4.a/451.1; target.location is unmerged - RIFT-90/RIFT-91)"
);
test.todo(
  "unl-184-219 Thrill of the Hunt: enforce the printed [Reaction] Closed-State permission through the keyword registry and the chain's canAct (CR 813.1.c / 309.1.a) — the Reaction KeywordDef expands to continuous.timing, the layers rules query reads it and chain canAct consults it, but the match/turn flow never attaches the program lifecycle, so a production engine cannot consume the grant"
);
