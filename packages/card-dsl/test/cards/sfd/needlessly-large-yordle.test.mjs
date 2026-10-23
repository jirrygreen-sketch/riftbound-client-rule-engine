// Golden test for Needlessly Large Yordle (sfd-055-221).
//
// Execution evidence (the printed 10 energy / 3 Calm payment, the real
// Shield 5 and Tank keyword expansion and the fail-closed static binds) lives
// in the RIFT-698 parameterized template golden:
// test/cards/templates/keyword-keyword-static-698.test.mjs.
// This file keeps validation, identity, verbatim text, declared status and the
// key structure of the printed abilities.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/needlessly-large-yordle.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";
import { createEngineStaticBinder, staticCostSources } from "../../../../engine-core/dist/programs/statics.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { createActionPipelineHost, bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { finalizeCostPlan } from "../../../../engine-core/dist/cost/discounts/index.js";
import { CostPlanError } from "../../../../engine-core/dist/cost/plan-types.js";
import { DuelBaseCombatBlockedError, createTrustedDuelBaseCombatFacts, planDuelBaseCombatDamage, validateDuelBaseCombatAllocation } from "../../../../engine-core/dist/combat/base-combat-allocation.js";

const CARD_ID = "card.hash-fd21f689bd36e48ea3071e7d21c1fa68fd1527e85ca97ffd9052664f6aaba7de";
const SOURCE_TEXT =
  "[Shield 5] (+5 :rb_might: while I'm a defender.)\n" +
  "[Tank] (I must be assigned combat damage first.)\n" +
  "I cost :rb_energy_2::rb_rune_calm: less for each point you scored from holding this turn.";

const [shieldAbility, tankAbility, discount] = program.abilities;

test("sfd-055-221 Needlessly Large Yordle: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-055-221 Needlessly Large Yordle: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Shield/);
  assert.match(program.judgeReason, /Tank/);
  assert.match(program.judgeReason, /designation/);
  assert.match(program.judgeReason, /Hold/);
  assert.doesNotMatch(program.judgeReason, /RIFT-\d+/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-055-221 Needlessly Large Yordle: Shield 5 and Tank keyword declarations (814 / 815)", () => {
  assert.equal(program.abilities.length, 3);
  // 814.1.b/814.1.b.2: X is the printed Shield Value, here 5.
  assert.deepEqual(shieldAbility, { kind: "keyword", keyword: "shield", value: 5 });
  // 815: Tank carries no value.
  assert.deepEqual(tankAbility, { kind: "keyword", keyword: "tank" });
});

test("sfd-055-221 Needlessly Large Yordle: the cost reduction is per holding point, in both resources (356.1/356.4)", () => {
  assert.equal(discount.kind, "static");
  assert.equal(discount.condition, undefined);
  assert.equal(discount.effect.kind, "continuous.cost-modification");
  assert.equal(discount.effect.appliesTo, "self");
  assert.deepEqual(discount.effect.reductions, [
    { resource: "energy", amount: -2, per: "point-scored-from-holding-this-turn" },
    { resource: "power", domain: "Calm", amount: -1, per: "point-scored-from-holding-this-turn" }
  ]);
});

/**
 * The three measured gaps asserted in judgeReason. Each one is probed through
 * the merged production surfaces (static binder, layer engine, combat
 * allocation seam) so the reason describes the current engine rather than a
 * historical one.
 */
function bindStatics(combatRole) {
  const kernel = world()
    .player("A", { energy: 20, power: ["Calm", "Calm", "Calm"] })
    .hand("yordle", {
      cardId: CARD_ID,
      types: ["unit"],
      energy: 10,
      power: ["Calm", "Calm", "Calm"],
      might: 5,
      combatRole
    })
    .build();
  const source = kernel.getObject("yordle");
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => {
      kernel.restore(checkpoint.state);
      kernel.copyLinkedFrom(checkpoint.links);
    },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: () => { throw new Error("Unexpected choice"); },
    context: (snapshot, controller, timingPoint) =>
      bindResolveContext(kernel, { source: snapshot, controller, timingPoint })
  });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"],
    turnPlayer: "A",
    phase: "main",
    host,
    cleanup: () => false
  });
  const binder = createEngineStaticBinder(engine);
  const bound = [];
  // expandProgram.abilities = declared abilities + keyword expansions; the
  // card's own continuous.cost-modification static is declared, while
  // continuous.might/continuous.combat come from the Shield/Tank expansions.
  for (const ability of expandProgram(program, source).abilities) {
    if (ability.kind !== "static") continue;
    bound.push(ability.effect.kind);
    try {
      binder.bindStatic(ability, source);
    } catch (error) {
      bound.push("BIND-REJECTED:" + String(error.message).slice(0, 60));
    }
  }
  engine.layers.setObjects(kernel.objects);
  return { engine, kernel, source, bound };
}

test("sfd-055-221 Needlessly Large Yordle golden: Shield 5 applies for a real Defender designation", () => {
  // 814.1.c/814.1.d: the production expression evaluator maps the Shield
  // expansion's designation to combatRole. Run all three observable branches
  // through the real ChainEngine, static binder and layer registry.
  const measured = {};
  for (const role of ["defender", "attacker", null]) {
    const { engine, kernel } = bindStatics(role);
    const layered = engine.layers.evaluate(kernel.ref("yordle"));
    measured[String(role)] = { might: layered.might, buffs: layered.buffs };
  }
  assert.deepEqual(measured, {
    defender: { might: 10, buffs: 0 },
    attacker: { might: 5, buffs: 0 },
    null: { might: 5, buffs: 0 }
  });
});

test("sfd-055-221 Needlessly Large Yordle gap 2: Tank has no assignment-priority consumer", () => {
  // 815.1.b/815.1.c.1/.c.2: the damage-assignment seam only accepts a
  // keyword-priority proof of 'proven-none'. There is no merged consumer that
  // can prove or apply Tank's lethal-first requirement, so a source/effect
  // service that reports Tank priority is rejected at the trusted seam.
  const state = {
    stateVersion: 7,
    board: {
      playerIds: ["A", "B"],
      battlefields: [{ locationId: "bf-1", controllerPlayerId: null, contested: true,
        contestingPlayerId: "A", showdown: "active", combat: "active", occupancy: ["attacker-unit", "tank-unit"] }],
      units: [
        { objectId: "attacker-unit", controllerPlayerId: "A", locationId: "bf-1" },
        { objectId: "tank-unit", controllerPlayerId: "B", locationId: "bf-1" }
      ]
    },
    unitMeta: { "attacker-unit": { damageMarks: [] }, "tank-unit": { damageMarks: [] } }
  };
  const facts = createTrustedDuelBaseCombatFacts(7, "bf-1", {
    currentMight: () => 3,
    proveBasicCombat: () => ({
      currentMight: "validated",
      assignmentModifier: "proven-none",
      preventionReplacement: "proven-none",
      // 815.1.b: Tank is precisely an assignment-priority requirement. The
      // closed proof vocabulary has no representable value for it.
      keywordPriority: "first"
    })
  });
  assert.throws(
    () => planDuelBaseCombatDamage(state, "bf-1", facts),
    (error) => error instanceof DuelBaseCombatBlockedError &&
      error.code === "source-effect-proof-incomplete"
  );
  // The read-only attestation surface exists but carries no priority input.
  assert.equal(typeof validateDuelBaseCombatAllocation, "function");
});

test("sfd-055-221 Needlessly Large Yordle gap 3: the Hold-point declaration binds but Finalize rejects its unsupported reduction expression", () => {
  // 356.1/356.4: the discount must be collected as -2 Energy and -1 Calm Power
  // per point scored from holding this turn. The production binder now exposes
  // the card static through staticCostSources, but the per-point reduction
  // shape has no executable CostPlan form and remains fail-closed.
  const { engine, kernel, source, bound } = bindStatics(null);
  assert.deepEqual(bound, ["continuous.cost-modification", "continuous.might", "continuous.combat"]);
  const sources = staticCostSources(engine);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].source.id, "yordle");
  assert.deepEqual(sources[0].ability.effect.reductions, discount.effect.reductions);
  const context = kernel.clone({ sourceSnapshot: source, controller: "A", timingPoint: "finalize" });
  assert.throws(
    () => finalizeCostPlan(context, { id: "yordle-cost", cost: { kind: "printed" } }, { statics: sources }),
    error => error instanceof CostPlanError && error.reason === "judge-required" &&
      /Unsupported cost reduction entry/.test(error.message)
  );
});

test.todo(
  "sfd-055-221 Needlessly Large Yordle: [Shield 5] needs the Defender designation as a readable " +
    "characteristic so the expanded continuous.might gate can be evaluated (814.1.d/814.1.d.1)"
);
test.todo(
  "sfd-055-221 Needlessly Large Yordle: [Tank]'s damage-assignment priority (815.1.b/815.1.c.1/.c.2) needs " +
    "the continuous.combat consumer; combat/base-combat-allocation.ts still accepts only keywordPriority: 'proven-none'"
);
test.todo(
  "sfd-055-221 Needlessly Large Yordle: the discount must be collected at Finalize as -2 Energy and -1 Calm " +
    "Power per point scored from holding this turn (356.1/356.4) via a card-static cost binding and a " +
    "history count of this turn's hold points"
);
