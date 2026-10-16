import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/spirits-refuge.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-02d796287ee81a01d4db75cbc8913926d5faa0dda54e2bf07f4412ef09acf073";

const [playTrigger, deflectGrant] = program.abilities;
const [buffInstruction] = playTrigger.body;
const targetSpec = buffInstruction.targets[0];

// The reference kernel compares filter values literally, so the contract-level
// "controller" placeholder is resolved by the real Finalize/target pipeline, not by the
// kernel. Following the merged ogn-136-298 Pit Rookie golden, the execution scenarios lock
// the (already chosen) friendly unit through setTargets and run the card's real body.
const executionBody = playTrigger.body.map(({ targets, ...rest }) => rest);

test("ogn-063-298 Spirit's Refuge: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /809/);
  assert.equal(
    program.sourceText,
    "When you play this, buff a friendly unit. (If it doesn't have a buff, it gets a " +
      "+1 :rb_might: buff.)\nFriendly buffed units have [Deflect] if they didn't already. " +
      "(Opponents must pay :rb_rune_rainbow: to choose those units with a spell or ability.)"
  );
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("Spirit's Refuge structure: play-effect buff plus a buffed-unit Deflect grant", () => {
  assert.equal(program.abilities.length, 2);

  // “When you play this” — a Gear Play Effect (CR v1.5 383.4.a.1 / 383.4.a.2).
  assert.equal(playTrigger.kind, "triggered");
  assert.equal(playTrigger.optional, false);
  assert.equal(playTrigger.trigger.at, "card-played");
  // The Play Effect points at this card's own played event through the filter's card id
  // (the engine validator rejects the older { filter: { role: "self" } } spelling).
  assert.deepEqual(playTrigger.trigger.filter, {
    event: "card-played",
    object: { canonicalCardId: CANONICAL }
  });
  assert.equal(playTrigger.trigger.once, undefined);
  assert.equal(playTrigger.body.length, 1);
  assert.equal(buffInstruction.id, "spirits-refuge.buff-friendly-unit");
  assert.equal(buffInstruction.op, "effect.buff");
  assert.deepEqual(buffInstruction.args.mode, { kind: "constant", value: "buff" });
  assert.deepEqual(buffInstruction.args.target, {
    kind: "constant",
    value: "spirits-refuge.friendly-unit"
  });
  assert.equal(buffInstruction.linkedTo, undefined);

  // “buff a friendly unit”: one targeted unit under the controller's control.
  assert.equal(buffInstruction.targets.length, 1);
  assert.equal(targetSpec.id, "spirits-refuge.friendly-unit");
  assert.deepEqual(targetSpec.filter, { type: "unit", controller: "controller", zone: "board" });
  assert.equal(targetSpec.min, 1);
  assert.equal(targetSpec.max, 1);
  assert.equal(targetSpec.selection, "one");

  // “Friendly buffed units have [Deflect] if they didn't already.” — a keyword grant.
  assert.equal(deflectGrant.kind, "static");
  assert.equal(deflectGrant.effect.kind, "continuous.grant-keyword");
  assert.equal(deflectGrant.effect.keyword, "Deflect");
  assert.deepEqual(deflectGrant.effect.value, { kind: "constant", value: 1 });
  assert.deepEqual(deflectGrant.effect.filter, {
    zone: "board",
    type: "unit",
    controller: "controller",
    characteristics: { buffs: 1 }
  });
  assert.equal(deflectGrant.condition, undefined);
});

test("Spirit's Refuge golden: buffing a friendly unit places one Buff counter", () => {
  const kernel = world()
    .unit("spirits-refuge", { types: ["gear"], zone: "board", location: { type: "base", player: "A" } })
    .unit("ally", { zone: "board", location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  kernel.setTargets(targetSpec.id, [kernel.ref("ally")]);

  const outcome = runAbilityBody(executionBody, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.getObject("ally").buffs, 1);
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(outcome.results[0].result.linkedValues.buffedCount, 1);
  assert.deepEqual(outcome.results[0].result.linkedValues.buffed, [kernel.ref("ally")]);
});

test("Spirit's Refuge golden: a unit that already has a buff is not buffed again (CR 702.3.a)", () => {
  const kernel = world()
    .unit("ally", {
      zone: "board",
      buffs: 1,
      location: { type: "battlefield", id: "battlefield-1" }
    })
    .build();
  kernel.setTargets(targetSpec.id, [kernel.ref("ally")]);

  const outcome = runAbilityBody(executionBody, kernel);
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.equal(kernel.getObject("ally").buffs, 1);
});

test("Spirit's Refuge golden: a target that left the board is ignored, not rebuffed elsewhere", () => {
  const kernel = world()
    .unit("ally", { zone: "board", location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const stale = kernel.ref("ally");
  kernel.perform({ type: "move-zone", object: stale, to: "hand" });
  kernel.setTargets(targetSpec.id, [stale]);

  const outcome = runAbilityBody(executionBody, kernel);
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(outcome.results[0].result.status, "ignored");
  assert.equal(kernel.getObject("ally").buffs, 0);
});

test("Spirit's Refuge golden: the grant registers Deflect for the friendly unit with a Buff", () => {
  const base = world()
    .unit("host", { types: ["gear"], zone: "board", owner: "A", controller: "A", might: null })
    .unit("buffed-ally", { might: 2, buffs: 1, owner: "A", controller: "A" })
    .unit("plain-ally", { might: 2, buffs: 0, owner: "A", controller: "A" })
    .unit("enemy-buffed", { might: 2, buffs: 1, owner: "B", controller: "B" })
    .build();
  // The static effect's filter uses the contract-level "controller"
  // placeholder; the production query wrapper resolves controller/owner
  // (chain/engine.ts). Bind the production matcher so the declared filter runs
  // unchanged.
  const productionQuery = (filter) => base.objects.filter((object) => matchesObjectFilter(
    Object.fromEntries(Object.entries(filter).map(([key, value]) =>
      [key, (key === "controller" || key === "owner") && value === "controller" ? "A" : value])),
    object
  ));
  const kernel = bindResolveContext(base, {
    source: base.getObject("host"),
    sourceSnapshot: base.getObject("host"),
    query: productionQuery
  });
  const declared = deflectGrant.effect;
  const body = [{
    id: "spirits-refuge.grant-deflect",
    op: "continuous.grant-keyword",
    args: {
      keyword: { kind: "constant", value: declared.keyword },
      value: declared.value,
      objects: {
        kind: "constant",
        value: { kind: "query", filter: declared.filter }
      }
    }
  }];
  const outcome = runAbilityBody(body, kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["spirits-refuge.grant-deflect.granted.count"], 1);
  assert.deepEqual(
    outcome.linkedValues["spirits-refuge.grant-deflect.granted.objects"],
    [base.ref("buffed-ally")]
  );
  assert.equal(base.continuousEffects.length, 1);
  assert.equal(base.continuousEffects[0].effect.layer, "ability");
  assert.equal(base.continuousEffects[0].effect.effect.keyword, "Deflect");
  assert.equal(base.continuousEffects[0].effect.effect.keywordValue, 1);
  assert.deepEqual(base.continuousEffects[0].duration, { type: "permanent" });

  // The layer engine really grants the keyword to the buffed friendly unit
  // only (809.1: Deflect is an ability-layer keyword grant; 702.3 keeps one
  // Buff per unit so characteristics { buffs: 1 } is "buffed").
  const layers = createLayerEngine(base.objects, base.continuousEffects);
  assert.deepEqual(layers.evaluate(base.ref("buffed-ally")).keywords, [{ id: "Deflect", value: 1 }]);
  assert.deepEqual(layers.evaluate(base.ref("plain-ally")).keywords, []);
  assert.deepEqual(layers.evaluate(base.ref("enemy-buffed")).keywords, []);
  assert.deepEqual(layers.evaluate(base.ref("host")).keywords, []);
});

test("Spirit's Refuge golden: no friendly unit with a Buff makes the grant a skipped negation", () => {
  const base = world()
    .unit("host", { types: ["gear"], zone: "board", owner: "A", controller: "A", might: null })
    .unit("plain-ally", { might: 2, buffs: 0, owner: "A", controller: "A" })
    .build();
  const productionQuery = (filter) => base.objects.filter((object) => matchesObjectFilter(
    Object.fromEntries(Object.entries(filter).map(([key, value]) =>
      [key, (key === "controller" || key === "owner") && value === "controller" ? "A" : value])),
    object
  ));
  const kernel = bindResolveContext(base, {
    source: base.getObject("host"),
    sourceSnapshot: base.getObject("host"),
    query: productionQuery
  });
  const body = [{
    id: "spirits-refuge.grant-deflect",
    op: "continuous.grant-keyword",
    args: {
      keyword: { kind: "constant", value: "Deflect" },
      value: { kind: "constant", value: 1 },
      objects: {
        kind: "constant",
        value: { kind: "query", filter: deflectGrant.effect.filter }
      }
    }
  }];
  const outcome = runAbilityBody(body, kernel);
  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.equal(base.continuousEffects.length, 0);
});

test.todo(
  "Spirit's Refuge: binding the card's static continuous.grant-keyword ability into the layer registry " +
    "for a real play, expressing the printed 'if they didn't already' (809.2) as an evaluable layer " +
    "condition, and turning the granted Deflect into the payable target tax (809.1.c / RIFT-90) all " +
    "remain pending on the CardProgram static binding (RIFT-257) and the target-tax adapter."
);
