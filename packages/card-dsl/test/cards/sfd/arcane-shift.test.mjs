import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/arcane-shift.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import banish from "../../../../engine-core/dist/effects/instructions/effect.banish.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import play from "../../../../engine-core/dist/effects/instructions/effect.play.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
// Card bodies run through the chain's own interpreter adapter — the production
// entry point that re-wraps Expr arguments for the registered primitives.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-ff9a6c1b5cc8b6c38f2be0c96b63bf7e77ad4fb2c14de333e9f0a2b2ae17ae52";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\n" +
  "Banish a friendly unit, then its owner plays it, ignoring its cost. " +
  "Deal 3 to an enemy unit at a battlefield. Banish this.";

const [actionKeyword, playAbility] = program.abilities;
const [banishFriendlyUnit, ownerPlaysIt, dealThree, banishThis] = playAbility.body;
const friendlySpec = banishFriendlyUnit.targets[0];
const enemySpec = dealThree.targets[0];

/** Mirrors chain/engine.ts's query normalization of "self"/"opponent". */
function chainKernel(kernel) {
  return new Proxy(kernel, {
    get(target, key) {
      if (key === "query") {
        return (filter) => {
          const normalized = { ...filter };
          const kernelFilter = { ...normalized };
          const opponents = [];
          for (const playerKey of ["controller", "owner"]) {
            if (normalized[playerKey] === "self") {
              kernelFilter[playerKey] = target.controller;
            } else if (normalized[playerKey] === "opponent") {
              // The production matcher (layers/filter.ts) understands the
              // "opponent" selector; the reference kernel compares literally, so
              // the key is dropped here and applied as a filter below.
              delete kernelFilter[playerKey];
              opponents.push(playerKey);
            }
          }
          return target
            .query(kernelFilter)
            .filter((object) => opponents.every((playerKey) => object[playerKey] !== target.controller));
        };
      }
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

/**
 * The card's own body with the resolved references the chain supplies. The
 * reference kernel compares filter values literally, so the TargetSpecs are
 * supplied through ctx.targets() the same way the merged goldens do; the specs
 * themselves are asserted structurally above.
 */
function scenario() {
  const locked = world()
    .object("arcane-shift", { owner: "A", controller: "A", zone: "chain", types: ["spell"] })
    .base("friendly-unit", { owner: "A", controller: "A", types: ["unit"], might: 2 })
    .unit("enemy-unit", {
      owner: "B",
      controller: "B",
      types: ["unit"],
      might: 3,
      location: { type: "battlefield", id: "battlefield-1" }
    })
    .build();
  const kernel = locked.clone({ sourceSnapshot: locked.getObject("arcane-shift") });
  kernel.setTargets(friendlySpec.id, [kernel.ref("friendly-unit")]);
  kernel.setTargets(enemySpec.id, [kernel.ref("enemy-unit")]);
  return { kernel, chain: chainKernel(kernel) };
}

// The reference kernel resolves filters literally, so the card's TargetSpecs are
// locked through ctx.targets() exactly as the chain finalizes them.
const executionBody = playAbility.body.map(({ targets, ...instruction }) => instruction);

test("sfd-200-221 Arcane Shift: program passes validateCardProgram and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-200-221 Arcane Shift: judgeReason names the ignore-cost rule and the missing producer", () => {
  assert.match(program.judgeReason, /356\.1\.b\.1/);
  assert.match(program.judgeReason, /356\.1\.b/);
  assert.match(program.judgeReason, /FinalizedCostPlan/);
  assert.match(program.judgeReason, /RIFT-89/);
  // The supported halves must be described as supported, not as blocked.
  assert.match(program.judgeReason, /428\.1/);
  assert.match(program.judgeReason, /359\.3\.e\.14/);
});

test("sfd-200-221 Arcane Shift structure: [Action] plus banish, owner-play, damage and self-banish", () => {
  assert.equal(program.abilities.length, 2);
  // 806: the keyword is a pure permission and carries no value.
  assert.deepEqual(actionKeyword, { kind: "keyword", keyword: "action" });
  assert.equal(actionKeyword.value, undefined);

  assert.equal(playAbility.kind, "play");
  assert.equal(playAbility.cost, undefined);
  assert.deepEqual(playAbility.body.map((instruction) => [instruction.id, instruction.op]), [
    ["arcane-shift.banish-friendly-unit", "effect.banish"],
    ["arcane-shift.owner-plays-it", "effect.play"],
    ["arcane-shift.deal-3", "effect.damage"],
    ["arcane-shift.banish-this", "effect.banish"]
  ]);

  // "Banish a friendly unit": one Board unit controlled by the ability's
  // controller (355.7/355.9.a.1/355.9.b).
  assert.deepEqual(banishFriendlyUnit.args, {
    objects: { kind: "constant", value: { target: "arcane-shift.friendly-unit" } },
    amount: { kind: "constant", value: 1 },
    linkKey: { kind: "constant", value: "banishedUnit" }
  });
  assert.deepEqual(friendlySpec, {
    id: "arcane-shift.friendly-unit",
    filter: { type: "unit", controller: "self" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(banishFriendlyUnit.linkedTo, undefined);

  // "then its owner plays it, ignoring its cost": the 359.3.e.14 result
  // reference reads the fresh post-banish reference and the owner from the
  // receipt (124); the cost descriptor records 356.1.b.1's both-cost ignore.
  assert.equal(ownerPlaysIt.op, "effect.play");
  assert.equal(ownerPlaysIt.linkedTo, "arcane-shift.banish-friendly-unit");
  assert.deepEqual(ownerPlaysIt.args.object, {
    kind: "linked-value",
    instructionId: "arcane-shift.banish-friendly-unit",
    key: "banishedUnitObject"
  });
  assert.deepEqual(ownerPlaysIt.args.player, {
    kind: "object-property",
    object: { linked: "arcane-shift.banish-friendly-unit" },
    property: "owner"
  });
  assert.deepEqual(ownerPlaysIt.args.cost.value, {
    kind: "cost.modify",
    base: "printed",
    ignore: ["energy", "power"],
    minimum: 0,
    finalized: false
  });
  assert.equal(ownerPlaysIt.targets, undefined);

  // "Deal 3 to an enemy unit at a battlefield": one opponent-controlled Board
  // unit at a battlefield; "at a battlefield" is a Location restriction
  // (355.10.b), not a second target, and not the TargetSpec-level location pin.
  assert.deepEqual(dealThree.args, {
    amount: { kind: "constant", value: 3 },
    target: { kind: "constant", value: "arcane-shift.enemy-unit" }
  });
  assert.deepEqual(enemySpec, {
    id: "arcane-shift.enemy-unit",
    filter: { type: "unit", controller: "opponent", location: "battlefield" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(dealThree.linkedTo, undefined);

  // "Banish this.": the resolving spell itself through the contract 3.6 symbolic
  // selector, never a fixed ObjectRef.
  assert.deepEqual(banishThis.args, {
    objects: { kind: "constant", value: "self" },
    amount: { kind: "constant", value: 1 },
    linkKey: { kind: "constant", value: "selfBanished" }
  });
  assert.equal(banishThis.targets, undefined);

  // Every declared op and keyword really is merged.
  assert.equal(instructionDefinitionsById.get("effect.banish"), banish);
  assert.equal(instructionDefinitionsById.get("effect.play"), play);
  assert.equal(instructionDefinitionsById.get("effect.damage"), damage);
  assert.equal(keywordDefinitionsById.has("Action"), true);
});

test("sfd-200-221 Arcane Shift golden: the banished unit leaves the Board and the receipt carries the new ref", () => {
  const kernel = world().base("friendly-unit", { owner: "A", controller: "A", types: ["unit"], might: 2 }).build();
  const original = kernel.ref("friendly-unit");
  const run = runInstruction(
    banish,
    banishFriendlyUnit.args,
    { world: kernel, targets: { [friendlySpec.id]: [original] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.banishedUnit.count, 1);
  // 124: the card left its zone, so the receipt's reference is the new
  // zone-entry identity, never a revived old one.
  assert.deepEqual(run.linked.banishedUnitObject, { id: "friendly-unit", zoneEntryId: 2 });
  assert.deepEqual(run.events.map((event) => event.action), ["banish"]);
  assert.equal(kernel.getObject("friendly-unit").zone, "banishment");
  assert.equal(kernel.object(original), null);
});

test("sfd-200-221 Arcane Shift golden: the whole card body resolves its independent clauses", () => {
  const { kernel, chain } = scenario();
  const outcome = resolveChainBody(executionBody, chain);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      // Banish resolves; the play half is negated because its cost argument is
      // not a finalized plan (judgeReason) — it is never played at the printed
      // cost and never faked through a substitute action.
      ["arcane-shift.banish-friendly-unit", "executed"],
      ["arcane-shift.owner-plays-it", "negated"],
      // The damage and the spell's own banish are separate sentences: they still
      // resolve (359.3.e.14.a only links the result reference to the banish).
      ["arcane-shift.deal-3", "executed"],
      ["arcane-shift.banish-this", "executed"]
    ]
  );
  assert.deepEqual(outcome.results[1].result, { status: "negated", reason: "impossible", events: [] });
  assert.equal(kernel.getObject("friendly-unit").zone, "banishment");
  assert.equal(kernel.getObject("enemy-unit").damage, 3);
  assert.equal(kernel.getObject("arcane-shift").zone, "banishment");
  assert.deepEqual(outcome.results[3].result.events.map((event) => event.action), ["banish"]);
});

test("sfd-200-221 Arcane Shift golden: an unfinalized ignore-cost plan never plays at the printed cost", () => {
  // Guards against the wrong fix: effect.play must reject the descriptor rather
  // than charging the printed cost of the banished unit.
  const kernel = world()
    .object("friendly-unit", {
      zone: "banishment",
      owner: "A",
      controller: "A",
      types: ["unit"],
      energy: 5,
      power: ["Mind"]
    })
    .build();
  const run = runInstruction(
    play,
    {
      object: { kind: "constant", value: kernel.zone("A", "banishment")[0] },
      player: { kind: "constant", value: "A" },
      cost: ownerPlaysIt.args.cost
    },
    { world: kernel }
  );

  assert.deepEqual(run.result, { status: "negated", reason: "impossible", events: [] });
  assert.equal(kernel.getObject("friendly-unit").zone, "banishment");
  assert.equal(run.events.length, 0);
});

test("sfd-200-221 Arcane Shift golden: a stale friendly unit leaves the linked play ignored (359.3.e)", () => {
  const { kernel, chain } = scenario();
  const stale = kernel.ref("friendly-unit");
  // The unit already left the Board after finalization.
  kernel.perform({ type: "return-to-hand", object: stale });
  kernel.setTargets(friendlySpec.id, [stale]);
  kernel.setTargets(enemySpec.id, [kernel.ref("enemy-unit")]);

  const outcome = resolveChainBody(executionBody, chain);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(
    outcome.results.slice(0, 2).map((entry) => entry.result),
    [
      { status: "ignored", reason: "mistargeted" },
      { status: "ignored", reason: "linked-ignored" }
    ]
  );
  // The rest of the card is not part of the banish result reference and still
  // resolves (359.3.e.11): the damage lands and the spell banishes itself.
  assert.equal(kernel.getObject("enemy-unit").damage, 3);
  assert.equal(kernel.getObject("arcane-shift").zone, "banishment");
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["friendly-unit"]);
});

test("sfd-200-221 Arcane Shift: the 'at a battlefield' restriction matches battlefields only", () => {
  // The restriction is a location-TYPE test evaluated by the merged matcher the
  // chain's query path uses (layers/filter.ts read by chain/engine.ts), so a unit
  // at a battlefield qualifies and a unit at its Base does not. Re-verifying the
  // locked target against that filter at Resolve is the production TargetPlan's
  // job (RIFT-90), which the reference kernel does not model.
  const snapshot = (location) => ({
    ref: { id: "unit", zoneEntryId: 1 },
    cardId: "card:unit",
    name: "unit",
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "B",
    controller: "B",
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

  // The location half of the filter runs through the merged matcher (which takes
  // concrete player selectors, hence the controller key is dropped here).
  const { controller: _opponentController, ...locationOnly } = enemySpec.filter;
  assert.equal(matchesObjectFilter(locationOnly, snapshot({ type: "battlefield", id: "battlefield-1" })), true);
  assert.equal(matchesObjectFilter(locationOnly, snapshot({ type: "base", player: "B" })), false);
  assert.equal(matchesObjectFilter(locationOnly, snapshot(null)), false);
  // The battlefield itself is not the target: 355.10.b keeps "at a battlefield"
  // as a restriction on the unit rather than a second target.
  assert.equal(dealThree.targets.length, 1);

  // The "opponent" placeholder runs through the chain's own query normalization:
  // only the defending unit matches, never the caster's own unit. The location
  // half is exercised above, because the reference kernel has no location-name
  // matcher of its own.
  const kernel = world()
    .unit("own-unit", { owner: "A", controller: "A", location: { type: "battlefield", id: "battlefield-1" } })
    .unit("their-unit", { owner: "B", controller: "B", location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  assert.deepEqual(
    chainKernel(kernel)
      .query({ type: "unit", controller: enemySpec.filter.controller })
      .map((object) => object.ref.id),
    ["their-unit"]
  );
});

test.todo(
  "sfd-200-221 Arcane Shift: materialize the ignore-cost plan (base Energy and base Power set to zero per " +
    "CR 356.1.b/356.1.b.1, floor 0 per 356.6, without rewriting 356.1.b.3 additional costs) and play the " +
    "banished card as its owner's Limited Action (420.3/420.3.a) into that player's Base — needs the " +
    "cost.modify ignore component and its finalized-plan producer (RIFT-89)"
);

test.todo(
  "sfd-200-221 Arcane Shift: [Action] admission (806.1.b) plus Finalize-time target locking, the Pending-item " +
    "exclusion for the enemy unit and the became-target notifications belong to the chain and target batches " +
    "(RIFT-84/RIFT-90/RIFT-120)"
);
