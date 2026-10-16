import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/bonds-of-strength.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { finalizeTargetPlan, resolveTargetPlan } from "../../../../engine-core/dist/target/target-plan.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-13ba5efe94e7668b6570b551c230fecd5395f082448d8a86f0ba8b2f23b78626";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "[Repeat] :rb_energy_2: (You may pay the additional cost to repeat this spell's effect.)\n" +
  "Give two friendly units each +1 :rb_might: this turn.";

const [reaction, play] = program.abilities;
const [grantMight] = play.body;
const unitSpec = grantMight.targets[0];

/**
 * The merged target system reads the static "self" controller spelling through
 * the chain's normalization (chain/engine.ts turns it into the ability
 * controller); the reference kernel compares raw values, so the fixture pins
 * the acting seat here. The card's own spec is asserted separately below.
 */
const requirement = {
  id: unitSpec.id,
  filter: { ...unitSpec.filter, controller: "A" },
  min: unitSpec.min,
  max: unitSpec.max,
  selection: unitSpec.selection
};

test("sfd-151-221 Bonds of Strength: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-151-221 Bonds of Strength: judgeReason names both gaps and their tasks", () => {
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /317\.2\.c/);
  assert.match(program.judgeReason, /703/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /RIFT-86/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("sfd-151-221 Bonds of Strength: [Reaction] keyword, the [Repeat] cost and the Might grant", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(reaction, { kind: "keyword", keyword: "reaction" });
  assert.equal(reaction.value, undefined);
  assert.equal(play.kind, "play");
  // Printed base cost 2 energy (356.1.c); [Repeat] :rb_energy_2: (820.1.c) is
  // declared in the merged sfd/frigid-touch shape without a collector.
  assert.deepEqual(play.cost, {
    kind: "additional-cost",
    keyword: "repeat",
    energy: { kind: "literal", value: 2 }
  });
  assert.equal(play.body.length, 1);

  // 143.2.a / 317.2.c: the +1 Might lasts for this turn (all "this turn"
  // effects expire together in cleanup). The op is the missing card-facing
  // continuous.might instruction, never a Buff counter (703).
  assert.equal(grantMight.id, "bonds-of-strength.grant-might");
  assert.equal(grantMight.op, "continuous.might");
  assert.equal(grantMight.linkedTo, undefined);
  assert.deepEqual(grantMight.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(grantMight.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(grantMight.args.target, {
    kind: "constant",
    value: "bonds-of-strength.units"
  });
});

test("sfd-151-221 Bonds of Strength: one fixed two-unit friendly target group (355.9.b)", () => {
  assert.equal(grantMight.targets.length, 1);
  // "two friendly units": a fixed pair, so min 2 / max 2 rather than "up to"
  // (355.13 would allow zero), the merged ogn/back-to-back shape.
  assert.deepEqual(unitSpec, {
    id: "bonds-of-strength.units",
    filter: { type: "unit", zone: "board", controller: "self" },
    min: 2,
    max: 2,
    selection: "any"
  });
});

test("sfd-151-221 Bonds of Strength golden: the merged target system locks exactly two friendly units", () => {
  const kernel = world()
    .unit("first-unit", { owner: "A", controller: "A" })
    .unit("second-unit", { owner: "A", controller: "A" })
    .unit("third-unit", { owner: "A", controller: "A" })
    .unit("enemy-unit", { owner: "B", controller: "B" })
    .build();
  kernel.setAnswers({
    ["target:" + unitSpec.id]: [kernel.ref("first-unit"), kernel.ref("third-unit")]
  });

  const plan = finalizeTargetPlan(kernel, requirement);
  assert.equal(plan.selected.length, 2);
  assert.deepEqual(plan.selected.map((ref) => ref.id), ["first-unit", "third-unit"]);
  assert.equal(resolveTargetPlan(kernel, plan).status, "resolved");
});

test("sfd-151-221 Bonds of Strength golden: fewer than two friendly units cannot finalize (355.8)", () => {
  const kernel = world()
    .unit("only-unit", { owner: "A", controller: "A" })
    .unit("enemy-unit", { owner: "B", controller: "B" })
    .build();

  // 355.8: valid choices must be made for all targets before the spell goes on
  // the chain, and the printed pair is fixed, so one friendly unit is not
  // enough — the merged target system rejects the finalize instead of playing
  // for less.
  assert.throws(() => finalizeTargetPlan(kernel, requirement), /required target count/);
});

test("sfd-151-221 Bonds of Strength golden: a mistargeted unit group ignores the whole instruction", () => {
  // 359.3.e.6-e.8 / contract 3.4: when the locked friendly pair is stale the
  // instruction is ignored before its op is ever dispatched, so an unavailable
  // group can never produce a partial Might grant.
  const kernel = world()
    .unit("first-unit", { owner: "A", controller: "A", might: 2 })
    .unit("second-unit", { owner: "A", controller: "A", might: 2 })
    .build();
  const stale = kernel.ref("second-unit");
  kernel.perform({ type: "kill", object: stale });
  const eventCount = kernel.events.length;
  kernel.setTargets(unitSpec.id, [kernel.ref("first-unit"), stale]);

  const outcome = runAbilityBody(play.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.getObject("first-unit").might, 2);
  assert.equal(kernel.getObject("first-unit").buffs, 0);
  assert.equal(kernel.events.length, eventCount);
});

test.todo(
  "sfd-151-221 Bonds of Strength: 'Give two friendly units each +1 :rb_might: this turn' needs the card-facing " +
    "continuous.might instruction that feeds the merged layers engine with an end-of-turn duration " +
    "(143.2.a / 317.2.c; RIFT-91 owns the evaluation and expiry side)"
);

test.todo(
  "sfd-151-221 Bonds of Strength: [Repeat] :rb_energy_2: — collecting the optional additional cost at Finalize " +
    "and executing the effect one extra time per paid instance with re-made choices " +
    "(820.1.b/820.1.d/820.2.a) needs the Repeat keyword expansion (RIFT-86) and the cost plan (RIFT-89)"
);

test.todo(
  "sfd-151-221 Bonds of Strength: the printed [Reaction] Closed-State permission and the chain admission " +
    "(813.1.c, contract 3.5 canAct) need a CardProgram -> ChainDraft play adapter — RIFT-84/RIFT-85"
);
