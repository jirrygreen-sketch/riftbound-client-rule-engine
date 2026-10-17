import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/carnivorous-snapvine.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-0198949b45425f8cf47078623d6647cf083dc1971553ed77552f307b6ca7031a";
const SOURCE_TEXT =
  "When you play me, choose an enemy unit at a battlefield. We deal damage equal to our Mights to each other.";

const ability = program.abilities[0];
const [snapvineDeals, enemyDeals] = ability.body;
const enemySpec = snapvineDeals.targets[0];
const selfSpec = enemyDeals.targets[0];

// The reference kernel compares filter values literally, so the enemy placeholder
// is locked as a finalized target (the production target pipeline resolves the
// controller/opponent and location restriction at Finalize, RIFT-90). The
// TargetSpecs stay in the program and are asserted structurally; the body runs
// without re-declaring them.
const bodyWithoutTargetSpecs = ability.body.map(({ targets, ...rest }) => rest);

/** Snapvine is the ability source: "me" and "our Mights" read from this object. */
function snapvineWorld({ snapvineMight = 6, enemyMight = 2 } = {}) {
  const kernel = world().unit("snapvine", { might: snapvineMight }).unit("enemy", { owner: "B", might: enemyMight }).build();
  return kernel.clone({ source: kernel.ref("snapvine"), sourceSnapshot: kernel.getObject("snapvine") });
}

test("ogn-149-298 Carnivorous Snapvine: program validates, is registered and is executable", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("ogn-149-298 Carnivorous Snapvine: play trigger with one enemy-unit-at-a-battlefield target", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, { event: "card-played", filter: { source: "self" } });
  assert.equal(ability.optional, false);
  assert.equal(ability.body.length, 2);

  // "choose an enemy unit at a battlefield" is a target (355.5/355.7/355.9.a.1);
  // "at a battlefield" is a targeting restriction (355.9.b), carried with the
  // merged layers-matcher location vocabulary so the production query path
  // (matchesObjectFilter) really restricts the candidates.
  assert.equal(snapvineDeals.targets.length, 1);
  assert.deepEqual(enemySpec, {
    id: "snapvine.enemy-unit",
    filter: { type: "unit", controller: "opponent", location: "battlefield" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("ogn-149-298 Carnivorous Snapvine: each unit is a Deal source read at resolution (418.6.b.3)", () => {
  // "WE deal damage equal to OUR Mights TO EACH OTHER": each instruction names
  // its own source and amount and the other unit as the target. The source is
  // read as the object reference through the declared ObjectSnapshot.ref field
  // and the amount through the live Might (contract 3.6: value expressions are
  // evaluated when used); the chosen unit's reads go through its target selector.
  assert.equal(snapvineDeals.id, "snapvine-deals");
  assert.equal(snapvineDeals.op, "effect.damage");
  assert.deepEqual(snapvineDeals.args.amount, {
    kind: "object-property",
    object: "self",
    property: "might"
  });
  assert.deepEqual(snapvineDeals.args.source, {
    kind: "object-property",
    object: "self",
    property: "ref"
  });
  assert.deepEqual(snapvineDeals.args.target, { kind: "constant", value: "snapvine.enemy-unit" });
  // Neither Deal is 355.14 split damage nor combat damage (418.6.c).
  assert.equal(snapvineDeals.args.divide, undefined);
  assert.equal(snapvineDeals.args.combat, undefined);

  assert.equal(enemyDeals.id, "enemy-deals");
  assert.equal(enemyDeals.op, "effect.damage");
  assert.deepEqual(enemyDeals.args.amount, {
    kind: "object-property",
    object: { target: "snapvine.enemy-unit" },
    property: "might"
  });
  assert.deepEqual(enemyDeals.args.source, {
    kind: "object-property",
    object: { target: "snapvine.enemy-unit" },
    property: "ref"
  });
  assert.deepEqual(enemyDeals.args.target, { kind: "constant", value: "snapvine.self" });

  // "me" is the host, programmatically selected (355.10.d.1): the contract 3.6
  // "self" anchor binds it at runtime; it is never a player choice.
  assert.deepEqual(selfSpec, {
    id: "snapvine.self",
    filter: { object: "self", type: "unit", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
  // Two independent instructions: neither references the other's result
  // (359.3.e.14 links only direct action references).
  assert.equal(snapvineDeals.linkedTo, undefined);
  assert.equal(enemyDeals.linkedTo, undefined);
  assert.equal(snapvineDeals.picks, undefined);
  assert.equal(enemyDeals.picks, undefined);
});

test("ogn-149-298 Carnivorous Snapvine golden: the two units damage each other by their Mights", () => {
  const kernel = snapvineWorld({ snapvineMight: 6, enemyMight: 2 });
  kernel.setTargets("snapvine.enemy-unit", [kernel.ref("enemy")]);
  kernel.setTargets("snapvine.self", [kernel.ref("snapvine")]);
  // 418.6.b.3 makes each chosen unit the source of its own damage; the
  // submitted GameActions are observed (a hook that applies no replacement) to
  // prove the source references, not just the marked damage.
  const submitted = [];
  kernel.addReplacement(action => {
    if (action.type === "damage") submitted.push(action);
    return null;
  });

  const outcome = resolveChainBody(bodyWithoutTargetSpecs, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => result.result.status), ["executed", "executed"]);
  assert.equal(kernel.getObject("snapvine").damage, 2);
  assert.equal(kernel.getObject("enemy").damage, 6);
  assert.deepEqual(submitted, [
    {
      type: "damage",
      source: kernel.ref("snapvine"),
      target: kernel.ref("enemy"),
      amount: 6,
      combat: false
    },
    {
      type: "damage",
      source: kernel.ref("enemy"),
      target: kernel.ref("snapvine"),
      amount: 2,
      combat: false
    }
  ]);
  assert.deepEqual(outcome.results[0].result.linkedValues.dealtTo, [
    { target: kernel.ref("enemy"), amount: 6 }
  ]);
  assert.deepEqual(outcome.results[1].result.linkedValues.dealtTo, [
    { target: kernel.ref("snapvine"), amount: 2 }
  ]);
});

test("ogn-149-298 Carnivorous Snapvine golden: Might is read at resolution, after an intervening change", () => {
  // Contract 3.6: value expressions are evaluated when used, so the damage
  // follows the units' Might at resolution rather than the Finalize values.
  const kernel = snapvineWorld({ snapvineMight: 6, enemyMight: 2 });
  kernel.setTargets("snapvine.enemy-unit", [kernel.ref("enemy")]);
  kernel.setTargets("snapvine.self", [kernel.ref("snapvine")]);

  const outcome = resolveChainBody(bodyWithoutTargetSpecs, kernel);

  assert.equal(outcome.status, "executed");
  // The first Deal uses the Snapvine's 6 Might against the enemy, and the
  // second reads the enemy's live 2 Might back against the Snapvine; a stale
  // or finalize-time constant would not produce these values.
  assert.equal(kernel.getObject("enemy").damage, 6);
  assert.equal(kernel.getObject("snapvine").damage, 2);
});

test("ogn-149-298 Carnivorous Snapvine golden: a chosen unit that left the board is ignored, never rebound", () => {
  // 359.3.e.7/.12: with the chosen unit gone, the instruction reading it (its
  // Might is the amount and its ref is the source) is ignored; the Deal never
  // falls back to last-known values and no damage is dealt.
  const kernel = snapvineWorld({ snapvineMight: 6, enemyMight: 2 });
  const stale = kernel.ref("enemy");
  kernel.perform({ type: "move-zone", object: stale, to: "hand" });
  kernel.setTargets("snapvine.enemy-unit", [stale]);
  kernel.setTargets("snapvine.self", [kernel.ref("snapvine")]);

  const outcome = resolveChainBody(bodyWithoutTargetSpecs, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map(result => result.result), [
    { status: "ignored", reason: "mistargeted" },
    { status: "ignored", reason: "mistargeted" }
  ]);
  assert.equal(kernel.getObject("snapvine").damage, 0);
  assert.equal(outcome.events.length, 0);
});

test("ogn-149-298 Carnivorous Snapvine: the recorded battlefield restriction matches battlefield units only", () => {
  const unit = {
    ref: { id: "u", zoneEntryId: 1 },
    cardId: "card:u",
    name: "u",
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "B",
    controller: "B",
    zone: "board",
    location: { type: "battlefield", id: "bf-1" },
    might: 2,
    energy: null,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  };
  // chain/engine.ts resolves the opponent selector against the ability
  // controller before it calls the production matcher (it excludes the
  // controller's own objects and passes 'any' through), so the location and
  // type halves are asserted with the same normalization the production query
  // applies (the merged switcheroo / siphon-power goldens use this spelling).
  const normalized = { ...enemySpec.filter, controller: "any" };
  assert.equal(matchesObjectFilter(normalized, unit), true);
  assert.equal(matchesObjectFilter(normalized, { ...unit, location: { type: "base", player: "B" } }), false);
  assert.equal(matchesObjectFilter(normalized, { ...unit, types: ["gear"] }), false);
});

test.todo(
  "ogn-149-298 Carnivorous Snapvine: Finalize-time locking of 'an enemy unit at a battlefield' plus " +
    "the became-target events and Resolve-time revalidation belong to the target system (RIFT-90)"
);
