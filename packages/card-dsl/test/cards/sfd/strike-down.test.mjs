import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import detach from "../../../../engine-core/dist/effects/instructions/effect.detach.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

import strikeDown from "../../../dist/cards/sfd/strike-down.js";
import { finalizeOrderedPickPlans } from "../../../../engine-core/dist/chain/picks/plan.js";
import { translateInstructionTargets, translateObjectFilter } from "../../../../engine-core/dist/programs/filters.js";

const [play] = strikeDown.abilities;
const [damageInstruction, detachInstruction] = play.body;

/**
 * chain/engine.ts normalizes controller/owner "self"/"opponent" before it calls
 * the production matcher (layers/filter.ts); the reference kernel compares
 * filter values literally, so the body goldens bind the same normalization the
 * chain applies instead of weakening the card's own filters.
 */
const chainQuery = (kernel, controller) => (value) => {
  const normalized = { ...value };
  for (const key of ["controller", "owner"]) {
    if (normalized[key] === "self") normalized[key] = controller;
  }
  return kernel.query({}).filter((object) => {
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

const chainContext = (kernel, controller) => new Proxy(kernel, {
  get(target, key) {
    if (key === "query") return chainQuery(target, controller);
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  }
});

test("Strike Down program is structurally valid and judge-required", () => {
  const result = validateCardProgram(strikeDown);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(strikeDown.status, "judge-required");
  assert.match(strikeDown.judgeReason, /pick/i);
  assert.match(strikeDown.judgeReason, /object-attribute/);
  assert.match(strikeDown.judgeReason, /ObjectRef/);
  assert.match(strikeDown.judgeReason, /finalizeOrderedPickPlans/);
  assert.match(strikeDown.judgeReason, /355\.10/);
  assert.match(strikeDown.judgeReason, /equipped/);
  assert.equal(
    strikeDown.canonicalCardId,
    "card.hash-f7e9f4f53ed55ffc9e6b1d38d72324ad29bb9ebf5f25c356bcd7f723aa08b177"
  );
  assert.match(strikeDown.sourceText, /deals damage equal to its Might/);
});

test("Strike Down ability structure: no speed keyword, pick + target + linked detach", () => {
  // This printing's ability line has no [Action]/[Reaction] keyword, so the
  // program holds exactly one play ability with default spell timing (159.2).
  assert.equal(strikeDown.abilities.length, 1);
  assert.equal(play.kind, "play");
  assert.deepEqual(
    play.body.map((instruction) => [instruction.id, instruction.op]),
    [
      ["damage", "effect.damage"],
      ["detach", "effect.detach"]
    ]
  );

  // "Choose an equipped friendly unit" — a pick, NOT a target (355.10), so it
  // must not trigger became-target effects.
  assert.equal(damageInstruction.picks.length, 1);
  assert.equal(damageInstruction.picks[0].id, "picked-unit");
  assert.equal(damageInstruction.picks[0].selection, "one");
  assert.equal(damageInstruction.picks[0].filter.type, "unit");
  assert.equal(damageInstruction.picks[0].filter.controller, "you");
  assert.equal(damageInstruction.picks[0].filter.equipped, true);

  // "It deals damage ... to an enemy unit": the enemy unit is the only target.
  assert.equal(damageInstruction.targets.length, 1);
  assert.equal(damageInstruction.targets[0].id, "enemy-unit");
  assert.equal(damageInstruction.targets[0].filter.controller, "opponent");

  // "Then detach an Equipment from it": linked to the damage instruction so a
  // host that left or lost its Equipment (359.3.e.12) also ignores this one,
  // and the detached Equipment is picked (not targeted).
  assert.equal(detachInstruction.linkedTo, "damage");
  assert.equal(detachInstruction.targets, undefined);
  assert.equal(detachInstruction.picks.length, 1);
  assert.equal(detachInstruction.picks[0].filter.type, "equipment");
  assert.deepEqual(detachInstruction.picks[0].filter.attachedTo, { pick: "picked-unit" });
  assert.deepEqual(detachInstruction.args.pick, { kind: "literal", value: "detached-equipment" });
  assert.deepEqual(damageInstruction.args.amount, {
    kind: "object-attribute",
    object: { pick: "picked-unit" },
    attribute: "might"
  });
  assert.deepEqual(damageInstruction.args.source, {
    kind: "object-attribute",
    object: { pick: "picked-unit" },
    attribute: "ref"
  });
});

test("Strike Down golden: detach removes the picked Equipment from its host", () => {
  const kernel = world().unit("attacker", { owner: "A", might: 3 }).build();
  const attackerRef = kernel.ref("attacker");
  const swordRef = kernel.addObject(
    {
      ...kernel.getObject("attacker"),
      ref: { id: "sword", zoneEntryId: 1 },
      cardId: "card:sfd-103",
      name: "Sword",
      types: ["equipment"],
      tags: ["Equipment"],
      zone: "board",
      attachedTo: attackerRef
    },
    "board"
  );

  const run = runInstruction(detach, { pick: "detached-equipment" }, {
    world: kernel,
    picks: { "detached-equipment": [swordRef] }
  });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.detached, 1);
  assert.equal(kernel.getObject("sword").attachedTo, null);
});

test("Strike Down golden: the picked unit deals damage equal to its Might through the production adapter", () => {
  // CR 418.6.b.3: "It" is the chosen unit and the amount is its current Might.
  // The program's own amount/source expressions are executed by the merged
  // interpreter + effect.damage (object-attribute over { pick: ... }).
  const kernel = world()
    .unit("attacker", { owner: "A", might: 3 })
    .unit("enemy", { owner: "B", controller: "B", might: 5 })
    .build();
  kernel.setPicks("picked-unit", [kernel.ref("attacker")]);
  kernel.setTargets("enemy-unit", [kernel.ref("enemy")]);

  const outcome = resolveChainBody([damageInstruction], chainContext(kernel, "A"));

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results[0].result.linkedValues.dealtTo, [
    { target: kernel.ref("enemy"), amount: 3 }
  ]);
  assert.equal(kernel.getObject("enemy").damage, 3);
  assert.deepEqual(outcome.events.map((event) => event.action), ["damage"]);
});

test("Strike Down golden: the full printed body resolves damage and then detaches the Equipment", () => {
  // Both instructions run through the production chain adapter in one body: the
  // damage reads the picked unit's Might, and the linked detach removes the
  // picked Equipment from that same unit (436.1/436.3).
  const kernel = world()
    .unit("attacker", { owner: "A", might: 3 })
    .unit("enemy", { owner: "B", controller: "B", might: 5 })
    .build();
  const attackerRef = kernel.ref("attacker");
  const swordRef = kernel.addObject(
    {
      ...kernel.getObject("attacker"),
      ref: { id: "sword", zoneEntryId: 1 },
      cardId: "card:sfd-103",
      name: "Sword",
      types: ["equipment"],
      tags: ["Equipment"],
      zone: "board",
      attachedTo: attackerRef
    },
    "board"
  );
  kernel.setPicks("picked-unit", [attackerRef]);
  kernel.setPicks("detached-equipment", [swordRef]);
  kernel.setTargets("enemy-unit", [kernel.ref("enemy")]);

  const outcome = resolveChainBody(play.body, chainContext(kernel, "A"));

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      ["damage", "executed"],
      ["detach", "executed"]
    ]
  );
  assert.equal(kernel.getObject("enemy").damage, 3);
  assert.equal(kernel.getObject("sword").attachedTo, null);
  assert.deepEqual(outcome.events.map((event) => event.action), ["damage", "detach"]);
});

test("Strike Down golden: a stale picked unit ignores the damage instead of guessing a source", () => {
  const kernel = world()
    .unit("attacker", { owner: "A", might: 3 })
    .unit("enemy", { owner: "B", controller: "B", might: 5 })
    .build();
  const stale = kernel.ref("attacker");
  kernel.perform({ type: "kill", object: stale });
  kernel.setPicks("picked-unit", [stale]);
  kernel.setTargets("enemy-unit", [kernel.ref("enemy")]);

  const outcome = resolveChainBody([damageInstruction], chainContext(kernel, "A"));

  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.getObject("enemy").damage, 0);
  // The damage instruction produced no event of its own: the only recorded event
  // is the earlier kill that made the picked unit stale.
  assert.deepEqual(outcome.events, []);
  assert.deepEqual(kernel.events.map((event) => event.action), ["kill"]);
});

test.todo(
  "Strike Down full play: production Finalize must fill the non-target pick for an equipped friendly unit and the " +
    "linked detach pick; the current ObjectFilter and pick lifecycle do not provide that complete selection path"
);

test("Strike Down: the production pick lifecycle locks no plan for either filter-driven pick", () => {
  // Live evidence for judgeReason (1): finalizeOrderedPickPlans only locks picks
  // that declare zoneSlice or linked. Both printed picks are filter-driven, so
  // Finalize produces no bound ObjectRefs for them and the Body cannot run in a
  // production play.
  const kernel = world().unit("attacker", { owner: "A", might: 3 }).build();
  assert.deepEqual(finalizeOrderedPickPlans(kernel, play.body), []);
  for (const instruction of play.body) {
    for (const pick of instruction.picks ?? []) {
      assert.equal(pick.zoneSlice, undefined, `${pick.id} must not pretend to be an ordered slice`);
      assert.equal(pick.linked, undefined, `${pick.id} must not pretend to be a linked source`);
      assert.ok(pick.filter, `${pick.id} is a filter-driven pick`);
    }
  }
});

test("Strike Down: the printed equipped restriction has no supported filter field", () => {
  // Live evidence for judgeReason (2): the production translator rejects the
  // `equipped` predicate, and dropping it would accept any friendly unit, so the
  // 355.9.b targeting restriction cannot be expressed.
  assert.throws(
    () => translateObjectFilter({ type: "unit", controller: "you", equipped: true }),
    /Unsupported filter field equipped/
  );
  // The pick's own filter is never translated at all, so no production query is
  // built from it: the pick restriction stays descriptive data.
  const [damage] = translateInstructionTargets(play.body);
  assert.equal(damage.picks[0].filter.equipped, true);
  assert.equal(damage.picks[0].zoneSlice, undefined);
  assert.throws(
    () => translateObjectFilter(damage.picks[0].filter),
    /Unsupported filter field equipped/
  );
  // The fields the merged filter does support say nothing about attachments.
  const accepted = translateObjectFilter({ type: "unit", controller: "you" });
  assert.equal(accepted.equipped, undefined);
  assert.equal(accepted.attachedTo, undefined);
});
