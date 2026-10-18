import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/spirits-refuge.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import grantKeyword from "../../../../engine-core/dist/effects/instructions/continuous.grant-keyword.js";
import { KeywordGrantLayerEngine } from "../../../../engine-core/dist/programs/keyword-grants.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { createTargetTaxAdapter } from "../../../../engine-core/dist/target/tax/index.js";
import { prepareCostPayment } from "../../../../engine-core/dist/cost/payment.js";
import { DUEL_DOMAINS } from "../../../../engine-core/dist/cost/resources.js";

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
  assert.match(program.judgeReason, /target\.tax/);
  assert.match(program.judgeReason, /已有 Deflect|否定关键词/);
  // The default path still needs the already-merged adapters.
  assert.match(program.judgeReason, /target\.tax has no layer mapping/);
  assert.match(program.judgeReason, /createTargetTaxAdapter/);
  assert.match(program.judgeReason, /KeywordGrantLayerEngine/);
  assert.match(program.judgeReason, /Energy mandatoryAdditional/);
  assert.match(program.judgeReason, /809\.1\.c\.1/);
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

test("Spirit's Refuge: the production static binder rejects Deflect's target.tax expansion (current gap)", () => {
  // effects/keywords/Deflect.ts 只声明 static target.tax；生产 static binder 的 layerFor
  // 没有该 kind 的映射。这里用 executable 形态的同形状程序走真实 attachLifecycle，
  // 证明该缺口当前存在（不是猜测）。
  const forged = {
    canonicalCardId: "card.hash-spirits-refuge-probe",
    rulesetVersion: "core-1.5",
    status: "executable",
    sourceText: "probe",
    abilities: [{ kind: "static", effect: { kind: "target.tax", value: { kind: "constant", value: 1 } } }]
  };
  const state = fixture({ cards: [{ id: "probe", cardId: forged.canonicalCardId, types: ["gear"] }] });
  const errors = [];
  const binding = createProgramBinding({ cardPrograms: [forged] });
  binding.attachLifecycle(state.engine, (error) => errors.push(String(error && error.message)));
  state.engine.commit({
    type: "move-zone",
    object: state.kernel.ref("probe"),
    to: "board",
    location: { type: "base", player: "A" }
  });
  assert.deepEqual(errors, ["Static ability kind target.tax has no layer mapping"]);
  assert.deepEqual(state.engine.layers.registry.list(), []);
});

test("Spirit's Refuge golden: granting Deflect to a unit that already has it sums (809.2), it does not skip", () => {
  // 「if they didn't already」要求的语义是“已有则不再授予”；已合入的授予按 809.2 求和，
  // 所以直接授予会得到与印刷文本相反的数值。这是当前缺口，不是本卡可执行的证明。
  for (const [existing, expected] of [[null, 1], [1, 2], [2, 3]]) {
    const base = world()
      .unit("host", { types: ["gear"], zone: "board", owner: "A", controller: "A", might: null })
      .unit("buffed-ally", {
        might: 2,
        buffs: 1,
        owner: "A",
        controller: "A",
        ...(existing === null ? {} : { keywords: [{ id: "Deflect", value: existing }] })
      })
      .build();
    const context = bindResolveContext(base, {
      source: base.getObject("host"),
      sourceSnapshot: base.getObject("host")
    });
    const run = runInstruction(grantKeyword, {
      keyword: "Deflect",
      value: 1,
      objects: { kind: "target", id: "buffed-ally" }
    }, { world: context, targets: { "buffed-ally": [base.ref("buffed-ally")] } });

    assert.equal(run.result.status, "executed");
    const layers = createLayerEngine(base.objects, base.continuousEffects);
    assert.deepEqual(layers.evaluate(base.ref("buffed-ally")).keywords, [
      { id: "Deflect", value: expected }
    ]);
  }
});

test("Spirit's Refuge golden: the granted Deflect really reaches the ability layer for buffed friendly units only", () => {
  // 已合入部分：grant-keyword + Buff 特征过滤真的把 Deflect 授予有 buff 的友方单位。
  const base = world()
    .unit("host", { types: ["gear"], zone: "board", owner: "A", controller: "A", might: null })
    .unit("buffed-ally", { might: 2, buffs: 1, owner: "A", controller: "A" })
    .unit("plain-ally", { might: 2, buffs: 0, owner: "A", controller: "A" })
    .build();
  const productionQuery = (filter) => base.objects.filter((object) => matchesObjectFilter(
    Object.fromEntries(Object.entries(filter).map(([key, value]) =>
      [key, (key === "controller" || key === "owner") && value === "controller" ? "A" : value])),
    object
  ));
  const context = bindResolveContext(base, {
    source: base.getObject("host"),
    sourceSnapshot: base.getObject("host"),
    query: productionQuery
  });
  // The card's declared static effect is a grant over the written filter; the
  // body form below is the instruction the layer binder consumes for it.
  const run = runAbilityBody([{
    id: "spirits-refuge.grant-deflect",
    op: "continuous.grant-keyword",
    args: {
      keyword: { kind: "constant", value: deflectGrant.effect.keyword },
      value: deflectGrant.effect.value,
      objects: { kind: "constant", value: { kind: "query", filter: deflectGrant.effect.filter } }
    }
  }], context);

  assert.equal(run.results[0].result.status, "executed");
  assert.deepEqual(run.results[0].result.linkedValues.granted, {
    count: 1,
    objects: [base.ref("buffed-ally")]
  });
  const layers = createLayerEngine(base.objects, base.continuousEffects);
  assert.deepEqual(layers.evaluate(base.ref("buffed-ally")).keywords, [{ id: "Deflect", value: 1 }]);
  assert.deepEqual(layers.evaluate(base.ref("plain-ally")).keywords, []);
});

test.todo(
  "Spirit's Refuge: an evaluable 'if they didn't already' keyword predicate (809.2), a layer mapping / " +
    "default-chain integration of KeywordGrantLayerEngine and createTargetTaxAdapter for target.tax " +
    "and the 809.1.c.1 any-domain Power payment instead of Energy mandatoryAdditional"
);

test("Spirit's Refuge: the merged adapters price the card's granted Deflect as any-domain Power", () => {
  // This verifies the static grant + tax adapters, not their default-chain integration.
  // Each domain has a fresh initial world; no resources are changed by hand after execution.
  for (const domain of DUEL_DOMAINS) {
    const state = bindRefuge({ domain });
    const layers = new KeywordGrantLayerEngine(state.kernel.objects, {
      registry: state.engine.layers.registry,
      context: source => bindResolveContext(state.kernel, { source, controller: source.controller })
    });
    assert.deepEqual(layers.evaluate(state.kernel.ref("buffed-ally")).keywords, [{ id: "Deflect", value: 1 }]);
    for (const id of ["plain-ally", "enemy-buffed", "refuge"]) {
      assert.deepEqual(layers.evaluate(state.kernel.ref(id)).keywords, []);
    }
    const [expanded] = layers.keywordAbilities(state.kernel.ref("buffed-ally"));
    assert.equal(expanded.effect.kind, "target.tax");
    assert.deepEqual(expanded.effect.value, { kind: "constant", value: 1 });
    const context = bindResolveContext(state.kernel, {
      source: state.kernel.getObject("opposing-spell"), controller: "B",
      object: ref => layers.evaluate(ref),
      query: filter => layers.evaluateAll().filter(object => matchesObjectFilter(filter, object))
    });
    const adapter = createTargetTaxAdapter(context, {
      id: "refuge-opposing-spell", cost: { kind: "printed" }
    }, { kind: "spell" });
    const selected = adapter.finalizeTargetPlan({
      id: "buffed-ally", filter: { objectId: "buffed-ally", zone: "board" }, min: 1, max: 1
    }, { selected: [state.kernel.ref("buffed-ally")] });
    assert.deepEqual(selected.selected, [state.kernel.ref("buffed-ally")]);
    assert.equal(adapter.costPlan.total.energy, 2);
    assert.deepEqual(adapter.costPlan.total.power, [{ allowedDomains: DUEL_DOMAINS, amount: 1 }]);
    assert.deepEqual(prepareCostPayment(context, adapter.costPlan).actions[0].action.plan, {
      finalized: true, energy: 2, power: [domain]
    });
  }
});

test("Spirit's Refuge TODO: an already-Deflect unit keeps its original value under this static grant", {
  todo: "CR 809.3 and printed 'if they didn't already': missing per-candidate keyword predicate"
}, () => {
  const state = bindRefuge({ existing: [{ id: "Deflect", value: 2 }] });
  const layers = new KeywordGrantLayerEngine(state.kernel.objects, {
    registry: state.engine.layers.registry,
    context: source => bindResolveContext(state.kernel, { source, controller: source.controller })
  });
  assert.deepEqual(layers.evaluate(state.kernel.ref("buffed-ally")).keywords, [{ id: "Deflect", value: 2 }]);
});

function bindRefuge({ domain = "Mind", existing = [] } = {}) {
  const kernel = world().player("B", { energy: 7, power: [domain] })
    .base("refuge", { cardId: CANONICAL, types: ["gear"], might: null })
    .unit("buffed-ally", { buffs: 1, keywords: existing })
    .unit("plain-ally", { buffs: 0 })
    .unit("enemy-buffed", { owner: "B", controller: "B", buffs: 1 })
    .hand("opposing-spell", { owner: "B", types: ["spell"], energy: 2, power: [] }).build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects, perform: action => kernel.perform(action), choose: request => kernel.choose(request),
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint })
  });
  const engine = new ChainEngine({ host, turnOrder: ["A", "B"], turnPlayer: "A", cleanup: current => {
    current.layers.setObjects(kernel.objects);
    const lethal = current.layers.evaluateAll().filter(object => object.zone === "board" &&
      object.types.includes("unit") && object.might !== null && (object.might <= 0 || object.damage >= object.might));
    for (const object of lethal) current.commit({ type: "kill", object: object.ref });
    return lethal.length > 0;
  } });
  createEngineStaticBinder(engine).bindStatic(deflectGrant, kernel.getObject("refuge"));
  return { kernel, engine };
}
