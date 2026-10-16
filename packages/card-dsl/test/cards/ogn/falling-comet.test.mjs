import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/falling-comet.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-6d7a9531293e32e434c7fe99c6af5db443cfa11aa7c070f842cb759910097458";
const SOURCE_TEXT = "[Action] (Play on your turn or in showdowns.)\nDeal 6 to a unit at a battlefield.";

const [actionKeyword, play] = program.abilities;
const [dealSix] = play.body;
const targetSpec = dealSix.targets[0];
// The reference kernel compares filter values literally, so the card layer's
// location-type spelling is resolved by the production filter matcher
// (layers/filter.ts), not by the fixture. The golden therefore locks the
// Finalize target and drives the card's own instruction through the merged
// primitive (the same shape the merged effect.damage consumes at Resolve).
const lockedArgs = { amount: dealSix.args.amount, target: targetSpec.id };

test("ogn-085-298 Falling Comet: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-085-298 Falling Comet identity, ruleset, status and printed text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ogn-085-298 Falling Comet structure: [Action] keyword plus one battlefield-restricted unit target", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(actionKeyword, { kind: "keyword", keyword: "action" });
  assert.equal(actionKeyword.value, undefined);

  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.equal(play.body.length, 1);
  assert.equal(dealSix.id, "falling-comet.deal-6");
  assert.equal(dealSix.op, "effect.damage");
  assert.deepEqual(dealSix.args, {
    amount: { kind: "constant", value: 6 },
    target: { kind: "constant", value: "falling-comet.unit" }
  });
  assert.equal(dealSix.linkedTo, undefined);
  assert.equal(dealSix.picks, undefined);
  assert.equal(dealSix.condition, undefined);

  // "a unit at a battlefield": one unit, restricted to a battlefield location
  // (355.9.b/355.10.b). The restriction is a location-TYPE test, not a pin to
  // one named battlefield, so it lives in the filter key the merged matcher
  // evaluates.
  assert.deepEqual(targetSpec, {
    id: "falling-comet.unit",
    filter: { type: "unit", location: "battlefield" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(targetSpec.location, undefined);
});

test("ogn-085-298 Falling Comet: the declared location restriction matches battlefields only", () => {
  const snapshot = (location) => ({
    ref: { id: "unit", zoneEntryId: 1 },
    cardId: "card:unit",
    name: "unit",
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    location,
    might: 3,
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

  // The merged matcher is the one the chain's query path uses
  // (layers/filter.ts read by chain/engine.ts).
  assert.equal(matchesObjectFilter(targetSpec.filter, snapshot({ type: "battlefield", id: "bf-1" })), true);
  assert.equal(matchesObjectFilter(targetSpec.filter, snapshot({ type: "base", player: "A" })), false);
  assert.equal(matchesObjectFilter(targetSpec.filter, snapshot(null)), false);
});

test("ogn-085-298 Falling Comet golden: deals 6 to the locked battlefield unit from the spell itself", () => {
  const kernel = world()
    .object("falling-comet", { zone: "chain", types: ["spell"], owner: "A", controller: "A" })
    .unit("battlefield-unit", { owner: "B", might: 7 })
    .build();
  const locked = kernel.ref("battlefield-unit");

  const run = runInstruction(damage, lockedArgs, {
    world: kernel,
    targets: { [targetSpec.id]: [locked] }
  });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.dealt, 6);
  assert.equal(run.linked.dealtCount, 1);
  assert.deepEqual(run.events.map(event => event.action), ["damage"]);
  // 418.6.a: with no stated source, the resolving spell is the source; the
  // damage is marked, not a kill (the unit has 7 Might).
  assert.equal(kernel.getObject("battlefield-unit").damage, 6);
  assert.equal(kernel.getObject("battlefield-unit").zone, "board");
});

test("ogn-085-298 Falling Comet golden: a target that left the Board is dropped at resolution (359.3.e)", () => {
  const kernel = world().unit("moved-unit", { owner: "B", might: 7 }).build();
  const stale = kernel.ref("moved-unit");
  kernel.perform({ type: "return-to-hand", object: stale });

  const run = runInstruction(damage, lockedArgs, {
    world: kernel,
    targets: { [targetSpec.id]: [stale] }
  });

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
  assert.equal(kernel.getObject("moved-unit").damage, 0);
});

test("ogn-085-298 Falling Comet golden: enough damage marks lethal on a 6-Might unit (143.2.b)", () => {
  const kernel = world().unit("small-unit", { owner: "B", might: 6 }).build();

  const run = runInstruction(damage, lockedArgs, {
    world: kernel,
    targets: { [targetSpec.id]: [kernel.ref("small-unit")] }
  });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.dealt, 6);
  // Damage is only marked here; the kill check is the kernel's own state-based
  // action (143.2.b), so the card does not fake a kill.
  assert.equal(kernel.getObject("small-unit").damage, 6);
  assert.equal(kernel.getObject("small-unit").zone, "board");
});

test.todo(
  "Falling Comet: [Action] admission (play during a Showdown on any player's turn, 806.1.b) belongs to " +
    "the chain's canAct check plus the continuous.timing consumer (contract 3.5 / RIFT-91)."
);

test.todo(
  "Falling Comet: Finalize-time target locking with the battlefield restriction re-verified at Resolve " +
    "(355.8/355.15, 359.3.e) belongs to the target system and chain batch (RIFT-90/RIFT-120)."
);
