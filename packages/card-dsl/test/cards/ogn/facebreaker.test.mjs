import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/facebreaker.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { queryObjects } from "../../../../engine-core/dist/effects/interpreter/selectors.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

import { buildHiddenCostPlan, payHiddenCostPlan } from "../../../../engine-core/dist/cost/kinds/hidden.js";

const CARD_ID = "card.hash-87a99b58ae6328e24ded8a032bff52588b3676f3c2eec58aafc5bafaa7a78aa0";
const [hidden, action, play] = program.abilities;
const [stunFriendly, stunEnemy] = play.body;
const friendlySpec = stunFriendly.targets[0];
const enemySpec = stunEnemy.targets[0];

/** A board with a friendly unit and an enemy unit at the same battlefield. */
function facebreakerWorld({ enemyLocation, enemyStunned = false } = {}) {
  return world()
    .unit("friendly-unit", {
      owner: "A",
      controller: "A",
      location: { type: "battlefield", id: "battlefield-1" }
    })
    .unit("enemy-unit", {
      owner: "B",
      controller: "B",
      location: enemyLocation ?? { type: "battlefield", id: "battlefield-1" },
      stunned: enemyStunned
    })
    .build();
}

/**
 * Execute the card's own body with the Finalize-locked targets supplied to the
 * kernel (the pit-rookie convention). The reference kernel filters by exact
 * JSON values, so it cannot re-run the richer card filters on locked targets;
 * locking them exercises the merged effect.stun primitive per selected unit.
 */
function runBody(kernel, { lockEnemy = true, body = play.body } = {}) {
  const instructions = body.map(({ targets, ...rest }) => rest);
  kernel.setTargets(friendlySpec.id, [kernel.ref("friendly-unit")]);
  if (lockEnemy) kernel.setTargets(enemySpec.id, [kernel.ref("enemy-unit")]);
  return runAbilityBody(instructions, kernel, undefined, { host: kernel.ref("friendly-unit") });
}

test("Facebreaker program is valid EffectIR v2 data", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Facebreaker identity and judge-required status match the printing", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.judgeReason.includes("cost.hidden"), true);
  assert.equal(program.judgeReason.includes("sameLocationAs"), true);
  assert.equal(
    program.sourceText,
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
      "[Action] (Play on your turn or in showdowns.)\n" +
      "Stun a friendly unit and an enemy unit at the same battlefield. (They don't deal combat damage this turn.)"
  );
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("Facebreaker structure: Hidden + Action, two stuns, the second anchored to the first", () => {
  assert.deepEqual(hidden, { kind: "keyword", keyword: "hidden" });
  assert.deepEqual(action, { kind: "keyword", keyword: "action" });
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 }
  });
  assert.equal(play.body.length, 2);

  // "Stun a friendly unit" (355.5: "Stun a unit at a battlefield" is a Choice),
  // one unit you control at a battlefield.
  assert.equal(stunFriendly.op, "effect.stun");
  assert.equal(stunFriendly.linkedTo, undefined);
  assert.deepEqual(stunFriendly.args.target, { kind: "constant", value: "facebreaker.friendly-unit" });
  assert.equal(friendlySpec.id, "facebreaker.friendly-unit");
  assert.deepEqual(friendlySpec.filter, {
    types: "unit",
    controller: "controller",
    location: { type: "battlefield" }
  });
  assert.equal(friendlySpec.selection, "one");

  // "and an enemy unit at the same battlefield": the second stun is its own
  // target, pinned to the first unit's location by the sameLocationAs anchor.
  assert.equal(stunEnemy.op, "effect.stun");
  assert.equal(stunEnemy.linkedTo, undefined);
  assert.deepEqual(stunEnemy.args.target, { kind: "constant", value: "facebreaker.enemy-unit" });
  assert.equal(enemySpec.id, "facebreaker.enemy-unit");
  assert.deepEqual(enemySpec.filter, {
    types: "unit",
    controller: "opponent",
    sameLocationAs: { target: "facebreaker.friendly-unit" }
  });
  assert.equal(enemySpec.selection, "one");
  // The anchor is a selector, never a runtime ObjectRef (README §3).
  assert.equal("id" in enemySpec.filter.sameLocationAs, false);
});

test("Facebreaker golden: both units are stunned and neither takes damage (424.1)", () => {
  const kernel = facebreakerWorld();
  const outcome = runBody(kernel);

  assert.equal(kernel.getObject("friendly-unit").stunned, true);
  assert.equal(kernel.getObject("enemy-unit").stunned, true);
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["facebreaker.stun-friendly-unit", "executed"],
    ["facebreaker.stun-enemy-unit", "executed"]
  ]);
  // Stun is a status change, not damage: both units keep 0 damage (424.1.a,
  // 124.2 statuses vs. 418 damage).
  assert.equal(kernel.getObject("friendly-unit").damage, 0);
  assert.equal(kernel.getObject("enemy-unit").damage, 0);
  assert.deepEqual(outcome.events.map(event => event.action), ["stun", "stun"]);
});

test("Facebreaker golden: an already-stunned enemy stays stunned without a second action (424.1.a.1)", () => {
  const kernel = facebreakerWorld({ enemyStunned: true });
  const outcome = runBody(kernel);

  assert.equal(kernel.getObject("enemy-unit").stunned, true);
  assert.equal(outcome.results[1].result.status, "executed");
  // 424.1.a.1: a Stunned Unit cannot be Stunned again, so only the friendly
  // unit produces an actual action.
  assert.deepEqual(outcome.events.map(event => event.action), ["stun"]);
  assert.equal(outcome.results[1].result.linkedValues["stunned"].count, 0);
  assert.equal(outcome.results[1].result.linkedValues["stunned"].alreadyStunned, 1);
});

test("Facebreaker golden: an enemy that left the battlefield makes only the enemy stun ignored", () => {
  const kernel = facebreakerWorld();
  const stale = kernel.ref("enemy-unit");
  kernel.perform({ type: "return-to-hand", object: stale });
  kernel.setTargets(friendlySpec.id, [kernel.ref("friendly-unit")]);
  kernel.setTargets(enemySpec.id, [stale]);
  const instructions = play.body.map(({ targets, ...rest }) => rest);
  const outcome = runAbilityBody(instructions, kernel, undefined, { host: kernel.ref("friendly-unit") });

  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status, entry.result.reason ?? ""]), [
    ["facebreaker.stun-friendly-unit", "executed", ""],
    ["facebreaker.stun-enemy-unit", "ignored", "mistargeted"]
  ]);
  assert.equal(kernel.getObject("friendly-unit").stunned, true);
  assert.equal(kernel.getObject("enemy-unit").zone, "hand");
  assert.equal(kernel.getObject("enemy-unit").stunned, false);
});

test("Facebreaker anchor: the enemy spec matches only a unit at the first target's location", () => {
  // The second spec's sameLocationAs anchor is resolved by the merged
  // interpreter selector against the first spec's still-legal selection, so
  // "at the same battlefield" is expressed without hard-coding a battlefield
  // id (contract 3.2 anchors; CR 355.5).
  const filter = enemySpec.filter;
  const sameField = world()
    .unit("friendly-unit", { owner: "A", controller: "A", location: { type: "battlefield", id: "battlefield-1" } })
    .unit("enemy-here", { owner: "B", controller: "B", location: { type: "battlefield", id: "battlefield-1" } })
    .unit("enemy-elsewhere", { owner: "B", controller: "B", location: { type: "battlefield", id: "battlefield-2" } })
    .build();
  // chain/engine.ts resolves the static controller/owner spellings before it
  // calls the production matcher: 'self' becomes the ability controller and
  // 'opponent' excludes that player's objects (then matches against 'any').
  const chainQuery = (kernel, controller) => value => {
    const normalized = { ...value };
    for (const key of ["controller", "owner"]) if (normalized[key] === "self") normalized[key] = controller;
    return kernel.listObjects().filter(object => {
      for (const key of ["controller", "owner"]) {
        if (normalized[key] === "opponent" && object[key] === controller) return false;
      }
      return matchesObjectFilter({
        ...normalized,
        ...(normalized.controller === "opponent" ? { controller: "any" } : {}),
        ...(normalized.owner === "opponent" ? { owner: "any" } : {})
      }, object);
    });
  };
  const environment = kernel => ({
    context: kernel,
    host: kernel.ref("friendly-unit"),
    query: chainQuery(kernel, "A"),
    linked: () => undefined,
    canLookBack: () => false,
    isIgnored: () => false
  });
  sameField.setTargets(friendlySpec.id, [sameField.ref("friendly-unit")]);
  assert.deepEqual(
    queryObjects(filter, environment(sameField)).map(object => object.ref.id),
    ["enemy-here"]
  );

  const onlyElsewhere = world()
    .unit("friendly-unit", { owner: "A", controller: "A", location: { type: "battlefield", id: "battlefield-1" } })
    .unit("enemy-elsewhere", { owner: "B", controller: "B", location: { type: "battlefield", id: "battlefield-2" } })
    .unit("enemy-base", { owner: "B", controller: "B", location: { type: "base", player: "B" } })
    .build();
  onlyElsewhere.setTargets(friendlySpec.id, [onlyElsewhere.ref("friendly-unit")]);
  assert.deepEqual(queryObjects(filter, environment(onlyElsewhere)), []);
});

test.todo("Facebreaker: Hide/facedown lifecycle, next-turn Reaction and Hidden battlefield restrictions (CR 811.1.b–d)");
test.todo("Facebreaker: bind sameLocationAs across the two Finalize targets (CR 355.9.b)");

test("Hidden cost component: hide pays one any-domain Power; later play waives base but retains additional costs", () => {
  const base = world().player("A", { energy: 3, power: ["Mind"] })
    .hand("hidden-spell", { cardId: CARD_ID, types: ["spell"], energy: 2, power: null }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("hidden-spell") });
  const hide = buildHiddenCostPlan(kernel, { id: "hide", mode: "hide" });
  assert.equal(hide.total.energy, 0);
  assert.equal(hide.total.power[0].amount, 1);
  const hiding = payHiddenCostPlan(kernel, hide);
  assert.deepEqual(hiding.actions[0].action.plan.power, ["Mind"]);
  assert.equal(kernel.player("A").energy, 3);
  const play = buildHiddenCostPlan(kernel, {
    id: "hidden-play", mode: "play",
    mandatoryAdditional: [{ id: "additional", cost: { energy: { kind: "constant", value: 1 } } }]
  });
  assert.equal(play.printed.energy, 2);
  assert.equal(play.printed.power, null);
  assert.equal(play.total.energy, 1);
  assert.deepEqual(play.total.power, []);
  const playing = payHiddenCostPlan(kernel, play);
  assert.equal(playing.paid, true);
  assert.equal(kernel.player("A").energy, 2);
});
